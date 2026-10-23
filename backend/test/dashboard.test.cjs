const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once, EventEmitter } = require('node:events');
const { app } = require('../dist/app');
const { pool } = require('../dist/config/database');
const queries = require('../dist/repositories/dashboard.repository');
const events = require('../dist/repositories/event.repository');
const { ingestBatch } = require('../dist/services/event.service');
const { StreamService, streamService } = require('../dist/services/stream.service');
const { localDashboardOnly } = require('../dist/middlewares/local-dashboard.middleware');

const event = { eventId: 'E-test', vehicleId: 'VEH-test', observedAt: '2026-10-18T10:05:00Z',
  latitude: 10, longitude: -70, speedKph: 81, ignitionOn: true };

async function listen(t) {
  const server = app.listen(0, '127.0.0.1');
  t.after(async () => {
    streamService.closeAll();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}/api`;
}

test('repositorio: filtros parametrizados, búsqueda literal y orden SQL determinista', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, values) => { calls.push({ sql, values }); return { rows: [event] }; });
  const search = "%' OR 1=1 --";
  assert.deepEqual(await queries.selectVehicles({ search, status: 'MOVING' }), [event]);
  assert.deepEqual(calls[0].values, [search, null, 'MOVING']);
  assert.ok(!calls[0].sql.includes(search));
  assert.match(calls[0].sql, /strpos\(lower\(vehicle_id\), lower\(\$1\)\)/);
  assert.match(calls[0].sql, /ORDER BY vehicle_id ASC/);
  await queries.selectVehicleHistory('VEH-test');
  assert.deepEqual(calls[1].values, ['VEH-test']);
  assert.match(calls[1].sql, /ORDER BY observed_at ASC, event_id ASC/);
  await queries.selectAlerts({ vehicleId: 'VEH-test', type: 'OVERSPEED' });
  assert.deepEqual(calls[2].values, ['VEH-test', 'OVERSPEED']);
  assert.match(calls[2].sql, /JOIN alerts/);
  assert.match(calls[2].sql, /ORDER BY observed_at DESC, event_id ASC/);
});

test('HTTP consultas: respuestas, filtros, desconocidos y parámetros inválidos', async (t) => {
  const base = await listen(t);
  const vehicles = t.mock.method(queries, 'selectVehicles', async () => [{ ...event, status: 'MOVING' }]);
  const history = t.mock.method(queries, 'selectVehicleHistory', async id => id === 'missing' ? [] : [event]);
  const alerts = t.mock.method(queries, 'selectAlerts', async () => [{ ...event, type: 'OVERSPEED', id: '1' }]);
  let response = await fetch(`${base}/vehicles?search=VEH&status=MOVING&vehicleId=VEH-test`);
  assert.equal(response.status, 200);
  assert.equal((await response.json())[0].status, 'MOVING');
  assert.deepEqual(vehicles.mock.calls[0].arguments[0], { search: 'VEH', status: 'MOVING', vehicleId: 'VEH-test' });
  response = await fetch(`${base}/vehicles/VEH-test/events`);
  assert.deepEqual(await response.json(), [event]);
  assert.equal(history.mock.calls[0].arguments[0], 'VEH-test');
  response = await fetch(`${base}/vehicles/missing/events`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), []);
  response = await fetch(`${base}/alerts?vehicleId=VEH-test&type=OVERSPEED`);
  assert.equal((await response.json())[0].type, 'OVERSPEED');
  assert.deepEqual(alerts.mock.calls[0].arguments[0], { vehicleId: 'VEH-test', type: 'OVERSPEED' });
  for (const route of ['/vehicles?status=INVALID', '/vehicles?search=', '/vehicles?vehicleId=A&vehicleId=B',
    '/alerts?type=INVALID', '/alerts?unexpected=1', '/vehicles/V/events?sort=desc', '/stream?apiKey=secret']) {
    response = await fetch(base + route);
    assert.equal(response.status, 400, route);
    assert.deepEqual(await response.json(), { error: 'INVALID_QUERY' });
  }
  response = await fetch(`${base}/vehicles/%ZZ/events`);
  assert.equal(response.status, 400);
  vehicles.mock.mockImplementation(async () => { throw new Error('private details'); });
  response = await fetch(`${base}/vehicles`);
  assert.deepEqual(await response.json(), { error: 'INTERNAL_SERVER_ERROR' });
});

test('dashboard local: rechaza IP remota y origen externo sin pedir API key', () => {
  for (const [address, origin, permitted] of [
    ['127.0.0.1', undefined, true], ['::1', 'http://localhost:4200', true],
    ['192.0.2.1', undefined, false], ['127.0.0.1', 'https://external.example', false]
  ]) {
    let passed = false;
    const res = { status(code) { assert.equal(code, 403); return this; }, json(body) { assert.equal(body.error, 'LOCAL_DASHBOARD_ONLY'); } };
    localDashboardOnly({ socket: { remoteAddress: address }, get: () => origin }, res, () => { passed = true; });
    assert.equal(passed, permitted);
  }
});

test('SSE HTTP: dos clientes, CORS, mensaje completo y limpieza al abortar', async (t) => {
  const base = await listen(t);
  const controllers = [new AbortController(), new AbortController()];
  t.after(() => controllers.forEach(controller => controller.abort()));
  const readers = [];
  for (const controller of controllers) {
    const response = await fetch(`${base}/stream`, { signal: controller.signal, headers: { Origin: 'http://localhost:4200' } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:4200');
    const reader = response.body.getReader();
    assert.match(new TextDecoder().decode((await reader.read()).value), /: connected/);
    readers.push(reader);
  }
  assert.equal(streamService.clientCount, 2);
  const message = { type: 'vehicle.updated', eventId: event.eventId, vehicleId: event.vehicleId,
    observedAt: event.observedAt, data: { ...event, status: 'MOVING' } };
  streamService.publish(message);
  for (const reader of readers) {
    const frame = new TextDecoder().decode((await reader.read()).value);
    assert.match(frame, /event: vehicle.updated/);
    assert.deepEqual(JSON.parse(frame.split('data: ')[1].trim()), message);
  }
  controllers.forEach(controller => controller.abort());
  for (let attempt = 0; attempt < 100 && streamService.clientCount !== 0; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(streamService.clientCount, 0);
  const denied = await fetch(`${base}/stream`, { headers: { Origin: 'https://external.example' } });
  assert.equal(denied.status, 403);
});

test('SSE heartbeat, cleanup y desconexión de clientes lentos', async () => {
  const stream = new StreamService(5);
  const req = new EventEmitter();
  const res = new EventEmitter();
  const frames = [];
  Object.assign(res, {
    status() { return this; }, set() { return this; }, flushHeaders() {},
    write(frame) { frames.push(frame); return true; }, destroy() {}
  });
  stream.connect(req, res);
  try {
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.ok(frames.includes(': heartbeat\n\n'));
    res.write = () => false;
    stream.publish({ type: 'alert.created', ...event, data: event });
    assert.equal(stream.clientCount, 0);
    assert.equal(res.listenerCount('close'), 0);
    assert.equal(req.listenerCount('aborted'), 0);
  } finally { stream.closeAll(); }
});

test('ingesta: emisiones después de COMMIT, tardíos, duplicados, conflictos y rollback', async (t) => {
  const commands = [];
  let failCommit = false;
  t.mock.method(pool, 'connect', async () => ({
    query: async sql => { commands.push(sql); if (sql === 'COMMIT' && failCommit) throw new Error('commit failed'); },
    release() {}
  }));
  const inserted = t.mock.method(events, 'insertEvent', async () => true);
  const state = t.mock.method(events, 'updateVehicleState', async () => true);
  const alert = t.mock.method(events, 'createOverspeedAlert', async () => true);
  const existing = t.mock.method(events, 'findEventById', async () => ({ ...event, sameObservedAt: true }));
  const published = [];
  t.mock.method(streamService, 'publish', message => {
    assert.equal(commands.at(-1), 'COMMIT');
    published.push(message);
  });
  assert.equal((await ingestBatch([event])).accepted, 1);
  assert.deepEqual(published.map(message => message.type), ['vehicle.updated', 'alert.created']);
  assert.equal(published[0].data.status, 'MOVING');
  published.length = 0;
  state.mock.mockImplementation(async () => false);
  await ingestBatch([event]);
  assert.deepEqual(published.map(message => message.type), ['alert.created']);
  published.length = 0;
  alert.mock.mockImplementation(async () => false);
  await ingestBatch([event]);
  assert.equal(published.length, 0);
  state.mock.mockImplementation(async () => true);
  await ingestBatch([{ ...event, speedKph: 80 }]);
  assert.deepEqual(published.map(message => message.type), ['vehicle.updated']);
  published.length = 0;
  inserted.mock.mockImplementation(async () => false);
  assert.equal((await ingestBatch([event, null])).duplicates, 1);
  existing.mock.mockImplementation(async () => ({ ...event, speedKph: 0, sameObservedAt: true }));
  assert.equal((await ingestBatch([event])).errors[0].reason, 'EVENT_ID_CONFLICT');
  assert.equal(published.length, 0);
  inserted.mock.mockImplementation(async () => true);
  alert.mock.mockImplementation(async () => { throw new Error('alert failed'); });
  await assert.rejects(ingestBatch([event]), /alert failed/);
  assert.equal(commands.at(-1), 'ROLLBACK');
  assert.equal(published.length, 0);
  alert.mock.mockImplementation(async () => true);
  failCommit = true;
  await assert.rejects(ingestBatch([event]), /commit failed/);
  assert.equal(commands.at(-1), 'ROLLBACK');
  assert.equal(published.length, 0);
});
