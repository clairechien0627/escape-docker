const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { createStore } = require('../lib/state');
const { createApp } = require('../lib/app');

const ROOMS_CONFIG = {
  room0: { containers: ['room0'] },
  room4: { containers: ['room4', 'locked-server'] },
};

function fakeDockerClient(overrides = {}) {
  const calls = [];
  return {
    calls,
    async startContainer(name) { calls.push(['start', name]); },
    async stopContainer(name) { calls.push(['stop', name]); },
    async recreateContainer(name) { calls.push(['recreate', name]); },
    async waitUntilReady(name) { calls.push(['waitUntilReady', name]); return true; },
    ...overrides,
  };
}

function buildApp(overrides = {}) {
  const store = createStore();
  store.init(Object.keys(ROOMS_CONFIG), 0);
  const dockerClient = fakeDockerClient(overrides.dockerOverrides);
  const app = createApp({
    roomsConfig: ROOMS_CONFIG,
    store,
    dockerClient,
    adminToken: 'test-admin-token',
    ensureTimeoutMs: 1000,
  });
  return { app, store, dockerClient };
}

test('GET /status returns all room states', async () => {
  const { app } = buildApp();

  const res = await request(app).get('/status');

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.room0.state, 'running');
  assert.strictEqual(res.body.room4.state, 'running');
});

test('POST /rooms/:id/ensure on a running room does not start containers', async () => {
  const { app, dockerClient } = buildApp();

  const res = await request(app).post('/rooms/room0/ensure');

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.state, 'running');
  assert.deepStrictEqual(dockerClient.calls, []);
});

test('POST /rooms/:id/ensure on a stopped room starts and waits for all linked containers', async () => {
  const { app, store, dockerClient } = buildApp();
  store.setState('room4', 'stopped');

  const res = await request(app).post('/rooms/room4/ensure');

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.state, 'running');
  assert.deepStrictEqual(dockerClient.calls, [
    ['start', 'room4'],
    ['start', 'locked-server'],
    ['waitUntilReady', 'room4'],
  ]);
  assert.strictEqual(store.get('room4').state, 'running');
});

test('POST /rooms/:id/ensure returns 504 and marks stopped if readiness times out', async () => {
  const { app, store } = buildApp({ dockerOverrides: { async waitUntilReady() { return false; } } });
  store.setState('room0', 'stopped');

  const res = await request(app).post('/rooms/room0/ensure');

  assert.strictEqual(res.status, 504);
  assert.strictEqual(store.get('room0').state, 'stopped');
  assert.strictEqual(store.get('room0').connections, 0);
});

test('POST /rooms/:id/ensure returns 500 and rolls back connection count if a docker call throws', async () => {
  const { app, store } = buildApp({ dockerOverrides: { async startContainer() { throw new Error('docker daemon unreachable'); } } });
  store.setState('room0', 'stopped');

  const res = await request(app).post('/rooms/room0/ensure');

  assert.strictEqual(res.status, 500);
  assert.strictEqual(store.get('room0').state, 'stopped');
  assert.strictEqual(store.get('room0').connections, 0);
});

test('POST /rooms/:id/ensure on unknown room returns 404', async () => {
  const { app } = buildApp();

  const res = await request(app).post('/rooms/does-not-exist/ensure');

  assert.strictEqual(res.status, 404);
});

test('POST /rooms/:id/heartbeat updates lastActivity', async () => {
  const { app, store } = buildApp();

  const res = await request(app).post('/rooms/room0/heartbeat');

  assert.strictEqual(res.status, 200);
  assert.ok(store.get('room0').lastActivity > 0);
});

test('POST /rooms/:id/release decrements connections', async () => {
  const { app, store } = buildApp();
  store.addConnection('room0', 0);

  const res = await request(app).post('/rooms/room0/release');

  assert.strictEqual(res.status, 200);
  assert.strictEqual(store.get('room0').connections, 0);
});

test('POST /rooms/:id/reset without admin token returns 401', async () => {
  const { app, dockerClient } = buildApp();

  const res = await request(app).post('/rooms/room0/reset');

  assert.strictEqual(res.status, 401);
  assert.deepStrictEqual(dockerClient.calls, []);
});

test('POST /rooms/:id/reset with valid admin token recreates linked containers', async () => {
  const { app, store, dockerClient } = buildApp();

  const res = await request(app)
    .post('/rooms/room4/reset')
    .set('X-Admin-Token', 'test-admin-token');

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.state, 'running');
  assert.deepStrictEqual(dockerClient.calls, [
    ['recreate', 'room4'],
    ['recreate', 'locked-server'],
    ['waitUntilReady', 'room4'],
  ]);
  assert.strictEqual(store.get('room4').state, 'running');
});
