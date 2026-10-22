const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { createReplayHttpClient, ReplayTransportError } = require('../dist/services/replay-http-client');
const { ReplayService, loadReplayFixture } = require('../dist/services/replay.service');
const { app } = require('../dist/app');
const { pool } = require('../dist/config/database');
const repository = require('../dist/repositories/event.repository');
const { streamService } = require('../dist/services/stream.service');

const key = 'synthetic-replay-test-key';
const event = { eventId: 'E-http', vehicleId: 'VEH-http', observedAt: '2026-10-18T10:05:00Z',
  latitude: 10, longitude: -70, speedKph: 81, ignitionOn: true };
const accepted = { accepted: 1, duplicates: 0, rejected: 0, errors: [] };

function environment(t, values) {
  const previous = Object.fromEntries(Object.keys(values).map(name => [name, process.env[name]]));
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  t.after(() => { for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  } });
}

async function listen(t, handler = app) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  return server;
}

async function until(engine, predicate) {
  for (let i = 0; i < 1000; i++) {
    const progress = await engine.status();
    if (predicate(progress)) return progress;
    await delay(10);
  }
  throw new Error('Replay did not reach expected state');
}

function json(res, body, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

test('transporte predeterminado: HTTP real, ruta fija, X-API-Key y cuerpo de un evento', async (t) => {
  const calls = [];
  const server = await listen(t, (req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => { calls.push({ method: req.method, url: req.url, key: req.headers['x-api-key'], body: JSON.parse(body) }); json(res, accepted); });
  });
  environment(t, { API_KEY: key, PORT: String(server.address().port) });
  const engine = new ReplayService(async () => [event]); // No injected ingest function.
  t.after(() => engine.stop());
  await engine.start(100);
  const progress = await until(engine, p => p.state === 'completed');
  assert.deepEqual(calls, [{ method: 'POST', url: '/api/events/batch', key, body: { events: [event] } }]);
  assert.equal(progress.accepted, 1);
  assert.ok(!JSON.stringify(progress).includes(key));
});

test('configuración: clave/puerto inválidos no envían peticiones', async (t) => {
  environment(t, { API_KEY: undefined });
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not call'); });
  await assert.rejects(createReplayHttpClient({ port: 3000 })([event]), { code: 'REPLAY_HTTP_CONFIG_ERROR' });
  process.env.API_KEY = key;
  for (const port of [0, -1, 65536, NaN]) {
    await assert.rejects(createReplayHttpClient({ port })([event]), { code: 'REPLAY_HTTP_CONFIG_ERROR' });
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('errores HTTP y redirecciones: no se reintentan ni se propagan cuerpos/cabeceras', async (t) => {
  environment(t, { API_KEY: key });
  let status = 401, calls = 0, redirected = 0;
  const destination = await listen(t, (_req, res) => { redirected++; json(res, accepted); });
  const server = await listen(t, (_req, res) => {
    calls++;
    res.setHeader('Location', `http://127.0.0.1:${destination.address().port}/leak`);
    json(res, { error: key, headers: { 'X-API-Key': key } }, status);
  });
  const client = createReplayHttpClient({ port: server.address().port });
  for (status of [401, 403, 400, 413, 500, 503, 307]) {
    await assert.rejects(client([event]), error => {
      assert.ok(error instanceof ReplayTransportError);
      assert.equal(error.code, [401, 403].includes(status) ? 'REPLAY_HTTP_AUTH_ERROR' : 'REPLAY_HTTP_ERROR');
      assert.ok(!String(error.stack).includes(key));
      assert.equal(error.cause, undefined);
      return true;
    });
  }
  assert.equal(calls, 7);
  assert.equal(redirected, 0);
});

test('respuestas: rechaza JSON/esquema/contadores incoherentes y no refleja campos arbitrarios', async (t) => {
  environment(t, { API_KEY: key });
  let body;
  const server = await listen(t, (_req, res) => json(res, body));
  const client = createReplayHttpClient({ port: server.address().port });
  for (body of [null, {}, { ...accepted, accepted: -1 }, { ...accepted, duplicates: 1 },
    { ...accepted, accepted: 0, rejected: 1 },
    { accepted: 0, duplicates: 0, rejected: 1, errors: [{ index: 1, reason: 'INVALID_SPEED' }] },
    { accepted: 0, duplicates: 0, rejected: 1, errors: [{ index: 0, reason: key }] }]) {
    await assert.rejects(client([event]), { code: 'REPLAY_HTTP_INVALID_RESPONSE' });
  }
  body = { accepted: 0, duplicates: 0, rejected: 1, secret: key,
    errors: [{ index: 0, reason: 'INVALID_SPEED', eventId: key, details: key }] };
  const result = await client([event]);
  assert.deepEqual(result.errors, [{ index: 0, reason: 'INVALID_SPEED', eventId: event.eventId }]);
  assert.ok(!JSON.stringify(result).includes(key));
  const malformed = await listen(t, (_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{broken'); });
  await assert.rejects(createReplayHttpClient({ port: malformed.address().port })([event]), { code: 'REPLAY_HTTP_INVALID_RESPONSE' });
  const html = await listen(t, (_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(key); });
  await assert.rejects(createReplayHttpClient({ port: html.address().port })([event]), { code: 'REPLAY_HTTP_INVALID_RESPONSE' });
});

test('timeout incluye cuerpo incompleto y libera stop sin avance ni reintentos', async (t) => {
  environment(t, { API_KEY: key });
  let calls = 0;
  let entered;
  const received = new Promise(resolve => { entered = resolve; });
  const server = await listen(t, (_req, res) => {
    calls++; res.writeHead(200, { 'Content-Type': 'application/json' }); res.flushHeaders(); res.write('{');
    entered();
  });
  const client = createReplayHttpClient({ port: server.address().port, timeoutMs: 100 });
  const engine = new ReplayService(async () => [event, event], client);
  t.after(() => engine.stop());
  await engine.start(100);
  await received;
  await engine.stop(); // Waits for the pending HTTP step, which is bounded by timeout.
  const progress = await engine.status();
  assert.equal(progress.state, 'error');
  assert.equal(progress.processed, 0);
  assert.equal(progress.accepted, 0);
  assert.equal(progress.errors[0].reason, 'REPLAY_HTTP_TIMEOUT');
  await delay(150);
  assert.equal(calls, 1);
  await engine.stop();
});

test('conexión cerrada: fallo seguro y sin avance', async (t) => {
  environment(t, { API_KEY: key });
  const server = await listen(t);
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  await assert.rejects(createReplayHttpClient({ port })([event]), { code: 'REPLAY_HTTP_UNAVAILABLE' });
});

test('HTTP real: pausa espera respuesta; reanudar, reiniciar y stop conservan la secuencia', async (t) => {
  environment(t, { API_KEY: key });
  const calls = [];
  let release, entered;
  const inFlight = new Promise(resolve => { entered = resolve; });
  const server = await listen(t, (req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      calls.push(JSON.parse(body).events[0].eventId);
      if (calls.length === 1) { release = () => json(res, accepted); entered(); }
      else json(res, accepted);
    });
  });
  const engine = new ReplayService(async () => [event, { ...event, eventId: 'second' }],
    createReplayHttpClient({ port: server.address().port }));
  t.after(() => engine.stop());
  await engine.start(100);
  await inFlight;
  let paused = false;
  const pause = engine.pause().then(p => { paused = true; return p; });
  await delay(150);
  assert.equal(paused, false);
  assert.deepEqual(calls, [event.eventId]);
  release();
  assert.equal((await pause).processed, 1);
  await delay(150);
  assert.equal(calls.length, 1);
  await engine.resume();
  await until(engine, p => p.state === 'completed');
  assert.deepEqual(calls, [event.eventId, 'second']);
  assert.equal((await engine.restart()).processed, 0);
  await engine.start(); await until(engine, p => p.processed >= 1);
  await engine.stop();
  const stoppedCalls = calls.length;
  await delay(150);
  assert.equal(calls.length, stoppedCalls);
  assert.equal(calls[2], event.eventId);
});

test('endpoint protegido: replay por HTTP con ingesta real, dos fixtures y SSE sin duplicados', { timeout: 20000 }, async (t) => {
  const server = await listen(t);
  environment(t, { API_KEY: key, PORT: String(server.address().port) });
  const requests = [];
  server.prependListener('request', req => {
    if (req.url !== '/api/events/batch') return;
    assert.equal(req.method, 'POST');
    assert.equal(req.headers['x-api-key'], key);
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => requests.push(JSON.parse(body).events[0]));
  });
  const stored = new Map(), commands = [];
  t.mock.method(pool, 'connect', async () => ({ query: async sql => { commands.push(sql); }, release() {} }));
  t.mock.method(repository, 'insertEvent', async (_client, value) => {
    if (stored.has(value.eventId)) return false; stored.set(value.eventId, value); return true;
  });
  t.mock.method(repository, 'findEventById', async (_client, id, at) => ({ ...stored.get(id), sameObservedAt: Date.parse(stored.get(id).observedAt) === Date.parse(at) }));
  t.mock.method(repository, 'updateVehicleState', async () => true);
  t.mock.method(repository, 'createOverspeedAlert', async (_client, value) => value.speedKph > 80);
  const publish = t.mock.method(streamService, 'publish', () => { assert.equal(commands.at(-1), 'COMMIT'); });
  const fixture = await loadReplayFixture();
  const oracle = JSON.parse(fs.readFileSync(path.join(__dirname, '../../fixtures/expected_detailed.json'), 'utf8'));
  const engine = new ReplayService();
  t.after(() => engine.stop());
  await engine.start(100);
  const first = await until(engine, p => p.state === 'completed');
  assert.deepEqual([first.accepted, first.duplicates, first.rejected], [20, 2, 2]);
  assert.deepEqual(first.errors, oracle.rejections_at_input_indexes_zero_based);
  assert.deepEqual(requests, fixture);
  assert.equal(stored.size, 20);
  assert.equal(publish.mock.calls.filter(call => call.arguments[0].type === 'alert.created').length, 4);
  const emissions = publish.mock.callCount();
  await engine.restart(); await engine.start();
  const second = await until(engine, p => p.state === 'completed');
  assert.deepEqual([second.accepted, second.duplicates, second.rejected], [0, 22, 2]);
  assert.deepEqual(requests, [...fixture, ...fixture]);
  assert.equal(publish.mock.callCount(), emissions);
  assert.ok(!JSON.stringify(second).includes(key));
});

test('middleware real: 401/403; rollback por HTTP no publica SSE ni incrementa contadores', async (t) => {
  environment(t, { API_KEY: key });
  const server = await listen(t);
  const url = `http://127.0.0.1:${server.address().port}/api/events/batch`;
  for (const [apiKey, status] of [[undefined, 401], ['wrong', 403]]) {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['X-API-Key'] = apiKey;
    assert.equal((await fetch(url, { method: 'POST', headers, body: JSON.stringify({ events: [event] }) })).status, status);
  }
  const commands = [];
  t.mock.method(pool, 'connect', async () => ({ query: async sql => { commands.push(sql); }, release() {} }));
  t.mock.method(repository, 'insertEvent', async () => true);
  t.mock.method(repository, 'updateVehicleState', async () => { throw new Error(key); });
  const publish = t.mock.method(streamService, 'publish', () => {});
  const engine = new ReplayService(async () => [event], createReplayHttpClient({ port: server.address().port }));
  t.after(() => engine.stop());
  await engine.start(100);
  const failed = await until(engine, p => p.state === 'error');
  assert.deepEqual(commands, ['BEGIN', 'ROLLBACK']);
  assert.equal(publish.mock.callCount(), 0);
  assert.equal(failed.processed, 0);
  assert.equal(failed.errors[0].reason, 'REPLAY_HTTP_ERROR');
  assert.ok(!JSON.stringify(failed).includes(key));
});
