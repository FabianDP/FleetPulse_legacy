const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { telemetryEventSchema, eventRejectionReason } = require('../dist/validators/event.validator');
const repository = require('../dist/repositories/event.repository');
const service = require('../dist/services/event.service');
const { pool } = require('../dist/config/database');
const { app } = require('../dist/app');

const event = {
  eventId: 'E-test', vehicleId: 'VEH-test', observedAt: '2026-10-18T10:05:00Z',
  latitude: 14.612, longitude: -90.538, speedKph: 80, ignitionOn: true
};

test('validación: motivos, tipos, rangos, identificadores y fechas', () => {
  for (const [changes, reason] of [
    [{ latitude: 91 }, 'INVALID_LATITUDE'],
    [{ longitude: -181 }, 'INVALID_LONGITUDE'],
    [{ speedKph: -1 }, 'INVALID_SPEED'],
    [{ speedKph: '80' }, 'INVALID_SPEED'],
    [{ speedKph: Infinity }, 'INVALID_SPEED'],
    [{ latitude: NaN }, 'INVALID_LATITUDE'],
    [{ ignitionOn: 'true' }, 'INVALID_IGNITION'],
    [{ eventId: '' }, 'INVALID_EVENT_ID'],
    [{ observedAt: '2026-10-18T10:05:00' }, 'INVALID_OBSERVED_AT'],
    [{ observedAt: '2026-02-30T10:05:00Z' }, 'INVALID_OBSERVED_AT']
  ]) {
    const parsed = telemetryEventSchema.safeParse({ ...event, ...changes });
    assert.equal(parsed.success, false);
    assert.equal(eventRejectionReason(parsed.error), reason);
  }
  const parsed = telemetryEventSchema.parse({ ...event, eventId: ' E-test ', vehicleId: 'x'.repeat(200), extra: true });
  assert.equal(parsed.eventId, ' E-test ');
  assert.equal(parsed.vehicleId.length, 200);
  for (const observedAt of ['2026-10-18T05:05:00-05:00', '2026-10-18T10:05:00.123456Z']) {
    assert.equal(telemetryEventSchema.safeParse({ ...event, observedAt }).success, true);
  }
});

test('validación del fixture oficial conserva índices y motivos', async () => {
  const events = fs.readFileSync(path.join(__dirname, '../../fixtures/events.jsonl'), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  const expected = JSON.parse(fs.readFileSync(path.join(__dirname, '../../fixtures/expected_detailed.json'), 'utf8'));
  const rejected = events.flatMap((raw, index) => {
    const parsed = telemetryEventSchema.safeParse(raw);
    return parsed.success ? [] : [{ index, eventId: raw.eventId, reason: eventRejectionReason(parsed.error) }];
  });
  assert.deepEqual(rejected, expected.rejections_at_input_indexes_zero_based);
});

function fakeTransaction(t) {
  const commands = [];
  let released = false;
  t.mock.method(pool, 'connect', async () => ({
    query: async (sql) => { commands.push(sql); return { rows: [], rowCount: 0 }; },
    release: () => { released = true; }
  }));
  return { commands, released: () => released };
}

test('lote parcial: aceptación, duplicado y conflicto sin efectos adicionales', async (t) => {
  const tx = fakeTransaction(t);
  let inserts = 0;
  t.mock.method(repository, 'insertEvent', async () => ++inserts === 1);
  t.mock.method(repository, 'findEventById', async () => ({ ...event, sameObservedAt: true }));
  const update = t.mock.method(repository, 'updateVehicleState', async () => true);
  const alert = t.mock.method(repository, 'createOverspeedAlert', async () => false);
  const result = await service.ingestBatch([
    event, { ...event }, { ...event, speedKph: 125 }, { ...event, latitude: 91 }
  ]);
  assert.deepEqual(result, {
    accepted: 1, duplicates: 1, rejected: 2,
    errors: [
      { index: 2, eventId: event.eventId, reason: 'EVENT_ID_CONFLICT' },
      { index: 3, eventId: event.eventId, reason: 'INVALID_LATITUDE' }
    ]
  });
  assert.equal(update.mock.callCount(), 1);
  assert.equal(alert.mock.callCount(), 1);
  assert.deepEqual(tx.commands, ['BEGIN', 'COMMIT', 'BEGIN', 'COMMIT', 'BEGIN', 'COMMIT']);
  assert.equal(tx.released(), true);
});

test('fecha distinta según PostgreSQL produce conflicto aunque coincida el milisegundo', async (t) => {
  fakeTransaction(t);
  t.mock.method(repository, 'insertEvent', async () => false);
  t.mock.method(repository, 'findEventById', async () => ({ ...event, sameObservedAt: false }));
  const result = await service.ingestBatch([{ ...event, observedAt: '2026-10-18T10:05:00.000001Z' }]);
  assert.equal(result.errors[0].reason, 'EVENT_ID_CONFLICT');
});

test('conflictos por cambios de payload y continuación después de un inválido', async (t) => {
  fakeTransaction(t);
  t.mock.method(repository, 'insertEvent', async () => false);
  t.mock.method(repository, 'findEventById', async () => ({ ...event, sameObservedAt: true }));
  const update = t.mock.method(repository, 'updateVehicleState', async () => true);
  const alert = t.mock.method(repository, 'createOverspeedAlert', async () => true);
  const changes = [
    { vehicleId: 'OTHER' }, { latitude: 15 }, { longitude: -91 },
    { speedKph: 81 }, { ignitionOn: false }
  ];
  const result = await service.ingestBatch([
    null, ...changes.map(change => ({ ...event, ...change })), event
  ]);
  assert.equal(result.duplicates, 1);
  assert.equal(result.rejected, 6);
  assert.equal(result.errors[0].reason, 'INVALID_EVENT');
  assert.deepEqual(result.errors.slice(1).map(error => [error.index, error.reason]),
    changes.map((_, index) => [index + 1, 'EVENT_ID_CONFLICT']));
  assert.equal(update.mock.callCount(), 0);
  assert.equal(alert.mock.callCount(), 0);
});

test('fallo de persistencia provoca rollback y libera conexión', async (t) => {
  const tx = fakeTransaction(t);
  t.mock.method(repository, 'insertEvent', async () => true);
  t.mock.method(repository, 'updateVehicleState', async () => { throw new Error('database failure'); });
  await assert.rejects(service.ingestBatch([event]), /database failure/);
  assert.deepEqual(tx.commands, ['BEGIN', 'ROLLBACK']);
  assert.equal(tx.released(), true);
});

test('80 km/h no inserta alerta; 81 sí usa consulta parametrizada', async () => {
  const calls = [];
  const client = { query: async (...args) => { calls.push(args); return { rowCount: 1 }; } };
  assert.equal(await repository.createOverspeedAlert(client, event), false);
  assert.equal(calls.length, 0);
  assert.equal(await repository.createOverspeedAlert(client, { ...event, speedKph: 81 }), true);
  assert.deepEqual(calls[0][1], [event.eventId, event.vehicleId]);
});

test('comparación temporal del repositorio se delega a PostgreSQL con parámetros', async () => {
  const client = { query: async (sql, values) => {
    assert.match(sql, /observed_at = \$2::timestamptz/);
    assert.deepEqual(values, [event.eventId, event.observedAt]);
    return { rows: [{ sameObservedAt: true }] };
  } };
  assert.deepEqual(await repository.findEventById(client, event.eventId, event.observedAt), { sameObservedAt: true });
});

test('HTTP: autenticación, parser, CORS y errores centralizados', async (t) => {
  const previousKey = process.env.API_KEY;
  process.env.API_KEY = 'local-test-key';
  const ingest = t.mock.method(service, 'ingestBatch', async () => ({ accepted: 1, duplicates: 0, rejected: 0, errors: [] }));
  const server = app.listen(0, '127.0.0.1');
  t.after(async () => {
    if (previousKey === undefined) delete process.env.API_KEY;
    else process.env.API_KEY = previousKey;
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/api/events/batch`;
  async function post(body, key = 'local-test-key') {
    const headers = { 'Content-Type': 'application/json', Origin: 'http://localhost:4200' };
    if (key !== null) headers['X-API-Key'] = key;
    const response = await fetch(url, { method: 'POST', headers, body });
    const json = await response.json();
    assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:4200');
    return { status: response.status, json };
  }
  const body = JSON.stringify({ events: [event] });
  assert.deepEqual(await post(body, null), { status: 401, json: { error: 'API_KEY_REQUIRED' } });
  assert.deepEqual(await post(body, 'wrong'), { status: 403, json: { error: 'INVALID_API_KEY' } });
  assert.equal(ingest.mock.callCount(), 0);
  assert.equal((await post(body)).status, 200);
  assert.deepEqual(ingest.mock.calls[0].arguments[0], [event]);
  for (const invalid of [{ events: [] }, { events: Array(1001).fill(event) }, { events: 'invalid' }]) {
    assert.deepEqual(await post(JSON.stringify(invalid)), { status: 400, json: { error: 'INVALID_BATCH' } });
  }
  assert.deepEqual(await post('{broken-json'), { status: 400, json: { error: 'INVALID_JSON' } });
  assert.deepEqual(await post(JSON.stringify({ padding: 'x'.repeat(1024 * 1024) })), {
    status: 413, json: { error: 'PAYLOAD_TOO_LARGE' }
  });
  ingest.mock.mockImplementation(async () => { throw new Error('private database details'); });
  assert.deepEqual(await post(body), { status: 500, json: { error: 'INTERNAL_SERVER_ERROR' } });
  delete process.env.API_KEY;
  assert.deepEqual(await post(body), { status: 503, json: { error: 'AUTH_NOT_CONFIGURED' } });
});
