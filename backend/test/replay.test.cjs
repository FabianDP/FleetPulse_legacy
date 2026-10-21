const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { ReplayService, replayService, loadReplayFixture } = require('../dist/services/replay.service');
const { app } = require('../dist/app');
const { pool } = require('../dist/config/database');
const repository = require('../dist/repositories/event.repository');
const { ingestBatch } = require('../dist/services/event.service');
const { streamService } = require('../dist/services/stream.service');

const result = (accepted = 1, duplicates = 0) => ({ accepted, duplicates, rejected: 0, errors: [] });

function clock(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  return async (engine, ms = 100) => {
    t.mock.timers.tick(ms);
    return engine.status();
  };
}

test('fixture: lee las 24 líneas en orden, incluido el evento tardío', async () => {
  const events = await loadReplayFixture();
  assert.equal(events.length, 24);
  assert.equal(events[0].eventId, 'E-001-01');
  assert.equal(events[16].eventId, 'E-001-00');
  assert.equal(events[23].eventId, 'E-001-02');
});

test('motor: orden, pausa, reanudación, reinicio e idempotencia delegada', async (t) => {
  const advance = clock(t);
  const seen = new Set();
  const calls = [];
  const engine = new ReplayService(async () => ['first', 'late', 'first'], async ([event]) => {
    calls.push(event);
    if (seen.has(event)) return result(0, 1);
    seen.add(event);
    return result();
  });
  t.after(() => engine.stop());
  assert.equal((await engine.status()).intervalMs, 750);
  await engine.start(100);
  assert.equal((await advance(engine)).processed, 1);
  await engine.pause();
  assert.equal((await advance(engine, 10000)).processed, 1);
  await engine.resume();
  await advance(engine);
  const first = await advance(engine);
  assert.deepEqual(calls, ['first', 'late', 'first']);
  assert.equal(first.state, 'completed');
  assert.equal(first.accepted, 2);
  assert.equal(first.duplicates, 1);
  const reset = await engine.restart();
  assert.equal(reset.processed, 0);
  assert.equal(reset.state, 'idle');
  assert.equal(seen.size, 2); // No storage deletion.
  await engine.start();
  await advance(engine); await advance(engine);
  const second = await advance(engine);
  assert.equal(second.accepted, 0);
  assert.equal(second.duplicates, 3);
});

test('motor: validaciones rechazadas continúan; fallo técnico pausa y permite reintento', async (t) => {
  const advance = clock(t);
  let failed = false;
  const engine = new ReplayService(async () => [0, 1, 2], async ([event]) => {
    if (event === 1) return { accepted: 0, duplicates: 0, rejected: 1,
      errors: [{ index: 0, eventId: 'bad', reason: 'INVALID_SPEED' }] };
    if (event === 2 && !failed) { failed = true; throw new Error('private database details'); }
    return result();
  });
  t.after(() => engine.stop());
  await engine.start(100);
  await advance(engine); await advance(engine);
  const failure = await advance(engine);
  assert.equal(failure.state, 'error');
  assert.equal(failure.processed, 2);
  assert.deepEqual(failure.errors, [
    { index: 1, eventId: 'bad', reason: 'INVALID_SPEED' }, { index: 2, reason: 'INGESTION_FAILED' }
  ]);
  assert.equal((await advance(engine, 10000)).processed, 2);
  await engine.resume();
  const completed = await advance(engine);
  assert.equal(completed.processed, 3);
  assert.equal(completed.accepted, 2);
  assert.equal(completed.rejected, 1);
});

test('motor: starts simultáneos, reinicio invalida timer anterior e intervalos inválidos', async (t) => {
  const advance = clock(t);
  let calls = 0;
  const engine = new ReplayService(async () => [1, 2], async () => { calls++; return result(); });
  t.after(() => engine.stop());
  const starts = await Promise.allSettled([engine.start(100), engine.start(100)]);
  assert.equal(starts.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(starts.find(item => item.status === 'rejected').reason.status, 409);
  await engine.restart();
  await advance(engine, 10000);
  assert.equal(calls, 0);
  await assert.rejects(engine.start(0), { status: 400 });
  await engine.start(100);
  await advance(engine);
  assert.equal(calls, 1);
});

test('motor: pausa espera el evento en vuelo; no permite ingestas solapadas', async (t) => {
  const advance = clock(t);
  let finish;
  let calls = 0;
  const pending = new Promise(resolve => { finish = resolve; });
  const engine = new ReplayService(async () => [1, 2], async () => { calls++; await pending; return result(); });
  t.after(() => engine.stop());
  await engine.start(100);
  t.mock.timers.tick(100);
  await new Promise(setImmediate);
  let paused = false;
  const pause = engine.pause().then(progress => { paused = true; return progress; });
  t.mock.timers.tick(10000);
  assert.equal(calls, 1);
  assert.equal(paused, false);
  finish();
  assert.equal((await pause).processed, 1);
  assert.equal((await advance(engine, 10000)).state, 'paused');
  assert.equal(calls, 1);
});

test('motor: fixture inaccesible no expone rutas ni detalles internos', async () => {
  const engine = new ReplayService(async () => { throw new Error('private path'); });
  await assert.rejects(engine.start(), { status: 503, message: 'REPLAY_FIXTURE_UNAVAILABLE' });
});

test('replays oficiales con ingesta real y repositorio simulado: 20/2/2, 0/22/2 y sin SSE nuevos', async (t) => {
  const advance = clock(t);
  const stored = new Map();
  t.mock.method(pool, 'connect', async () => ({ query: async () => ({ rows: [], rowCount: 0 }), release() {} }));
  t.mock.method(repository, 'insertEvent', async (_client, event) => {
    if (stored.has(event.eventId)) return false;
    stored.set(event.eventId, event);
    return true;
  });
  t.mock.method(repository, 'findEventById', async (_client, id, observedAt) => ({
    ...stored.get(id), sameObservedAt: Date.parse(stored.get(id).observedAt) === Date.parse(observedAt)
  }));
  t.mock.method(repository, 'updateVehicleState', async () => true);
  t.mock.method(repository, 'createOverspeedAlert', async (_client, event) => event.speedKph > 80);
  const publish = t.mock.method(streamService, 'publish', () => {});
  const engine = new ReplayService(loadReplayFixture, ingestBatch);
  t.after(() => engine.stop());
  await engine.start(100);
  for (let index = 0; index < 24; index++) await advance(engine);
  const first = await engine.status();
  assert.deepEqual([first.processed, first.accepted, first.duplicates, first.rejected], [24, 20, 2, 2]);
  assert.equal(stored.size, 20);
  assert.equal(publish.mock.calls.filter(call => call.arguments[0].type === 'alert.created').length, 4);
  assert.deepEqual(first.errors.map(error => error.index), [21, 22]);
  const previousEmissions = publish.mock.callCount();
  await engine.restart();
  await engine.start();
  for (let index = 0; index < 24; index++) await advance(engine);
  const second = await engine.status();
  assert.deepEqual([second.processed, second.accepted, second.duplicates, second.rejected], [24, 0, 22, 2]);
  assert.equal(stored.size, 20);
  assert.equal(publish.mock.callCount(), previousEmissions);
});

test('HTTP replay: autorización por sesión, cookie HttpOnly y comandos simultáneos', async (t) => {
  const previous = { enabled: process.env.REPLAY_ENABLED, password: process.env.REPLAY_PASSWORD };
  const engine = new ReplayService(async () => [1, 2], async () => result());
  for (const action of ['status', 'start', 'pause', 'resume', 'restart']) {
    t.mock.method(replayService, action, (...args) => engine[action](...args));
  }
  const server = app.listen(0, '127.0.0.1');
  t.after(async () => {
    await engine.stop();
    if (previous.enabled === undefined) delete process.env.REPLAY_ENABLED;
    else process.env.REPLAY_ENABLED = previous.enabled;
    if (previous.password === undefined) delete process.env.REPLAY_PASSWORD;
    else process.env.REPLAY_PASSWORD = previous.password;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/api/replay`;
  delete process.env.REPLAY_ENABLED;
  assert.equal((await fetch(url)).status, 503);
  process.env.REPLAY_ENABLED = 'true';
  process.env.REPLAY_PASSWORD = 'only-a-local-test-password';
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(`${url}/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
  assert.equal((await fetch(`${url}/login`)).status, 401);
  assert.equal((await fetch(`${url}/login`, { headers: { Authorization: 'Basic ' + Buffer.from('replay:wrong').toString('base64') } })).status, 403);
  const login = await fetch(`${url}/login`, { redirect: 'manual', headers: {
    Authorization: 'Basic ' + Buffer.from('replay:only-a-local-test-password').toString('base64')
  } });
  assert.equal(login.status, 303);
  const cookie = login.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);
  assert.match(cookie, /Path=\/api\/replay/i);
  const headers = { Cookie: cookie.split(';')[0], 'Content-Type': 'application/json', Origin: 'http://localhost:4200' };
  assert.equal((await fetch(url, { headers: { Cookie: 'fleetpulse_replay=fake' } })).status, 401);
  assert.equal((await fetch(url, { headers: { ...headers, Origin: 'https://external.example' } })).status, 403);
  const status = await fetch(url, { headers });
  assert.equal(status.status, 200);
  assert.equal(status.headers.get('access-control-allow-credentials'), 'true');
  assert.equal((await status.json()).total, 2);
  const post = (action, body = {}) => fetch(`${url}/${action}`, { method: 'POST', headers, body: JSON.stringify(body) });
  assert.equal((await post('start', { intervalMs: 0 })).status, 400);
  const concurrent = await Promise.all([post('start', { intervalMs: 60000 }), post('start', { intervalMs: 60000 })]);
  assert.deepEqual(concurrent.map(response => response.status).sort(), [200, 409]);
  assert.equal((await post('pause')).status, 200);
  assert.equal((await post('resume')).status, 200);
  const restart = await post('restart');
  assert.equal((await restart.json()).processed, 0);
  assert.equal((await post('start', { intervalMs: 60000 })).status, 200);
  const now = Date.now();
  t.mock.method(Date, 'now', () => now + 5 * 60 * 60 * 1000);
  assert.equal((await fetch(url, { headers })).status, 401);
  await engine.stop();
});
