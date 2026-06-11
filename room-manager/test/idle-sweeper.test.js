const test = require('node:test');
const assert = require('node:assert');
const { createStore } = require('../lib/state');
const { createSweeper } = require('../lib/idle-sweeper');

function fakeDockerClient() {
  const calls = [];
  return {
    calls,
    async stopContainer(name) { calls.push(['stop', name]); },
    async recreateContainer(name) { calls.push(['recreate', name]); },
  };
}

test('sweep stops a running room with no connections past the stop threshold', async () => {
  const store = createStore();
  store.init(['room0'], 0);
  const dockerClient = fakeDockerClient();
  const sweeper = createSweeper({
    roomsConfig: { room0: { containers: ['room0'] } },
    store, dockerClient,
    stopIdleMs: 1000, resetIdleMs: 60000,
  });

  await sweeper.sweep(2000);

  assert.deepStrictEqual(dockerClient.calls, [['stop', 'room0']]);
  assert.strictEqual(store.get('room0').state, 'stopped');
});

test('sweep does not stop a running room with active connections', async () => {
  const store = createStore();
  store.init(['room0'], 0);
  store.addConnection('room0', 0);
  const dockerClient = fakeDockerClient();
  const sweeper = createSweeper({
    roomsConfig: { room0: { containers: ['room0'] } },
    store, dockerClient,
    stopIdleMs: 1000, resetIdleMs: 60000,
  });

  await sweeper.sweep(2000);

  assert.deepStrictEqual(dockerClient.calls, []);
  assert.strictEqual(store.get('room0').state, 'running');
});

test('sweep recreates and re-stops a stopped room past the reset threshold, and touches lastActivity', async () => {
  const store = createStore();
  store.init(['room4'], 0);
  store.setState('room4', 'stopped');
  const dockerClient = fakeDockerClient();
  const sweeper = createSweeper({
    roomsConfig: { room4: { containers: ['room4', 'locked-server'] } },
    store, dockerClient,
    stopIdleMs: 1000, resetIdleMs: 5000,
  });

  await sweeper.sweep(6000);

  assert.deepStrictEqual(dockerClient.calls, [
    ['recreate', 'room4'],
    ['recreate', 'locked-server'],
    ['stop', 'room4'],
    ['stop', 'locked-server'],
  ]);
  assert.strictEqual(store.get('room4').state, 'stopped');
  assert.strictEqual(store.get('room4').lastActivity, 6000);
});

test('sweep ignores rooms that are neither idle-for-stop nor idle-for-reset', async () => {
  const store = createStore();
  store.init(['room0'], 0);
  const dockerClient = fakeDockerClient();
  const sweeper = createSweeper({
    roomsConfig: { room0: { containers: ['room0'] } },
    store, dockerClient,
    stopIdleMs: 1000, resetIdleMs: 5000,
  });

  await sweeper.sweep(500);

  assert.deepStrictEqual(dockerClient.calls, []);
  assert.strictEqual(store.get('room0').state, 'running');
});
