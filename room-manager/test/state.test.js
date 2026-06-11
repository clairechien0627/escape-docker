const test = require('node:test');
const assert = require('node:assert');
const { createStore } = require('../lib/state');

test('init seeds rooms as running with zero connections', () => {
  const store = createStore();
  store.init(['room0', 'room1'], 1000);

  assert.deepStrictEqual(store.get('room0'), { state: 'running', lastActivity: 1000, connections: 0 });
  assert.deepStrictEqual(store.get('room1'), { state: 'running', lastActivity: 1000, connections: 0 });
});

test('addConnection increments connections and bumps lastActivity', () => {
  const store = createStore();
  store.init(['room0'], 1000);

  store.addConnection('room0', 2000);

  assert.strictEqual(store.get('room0').connections, 1);
  assert.strictEqual(store.get('room0').lastActivity, 2000);
});

test('removeConnection decrements but never goes below zero', () => {
  const store = createStore();
  store.init(['room0'], 1000);

  store.removeConnection('room0', 2000);

  assert.strictEqual(store.get('room0').connections, 0);
  assert.strictEqual(store.get('room0').lastActivity, 2000);
});

test('touch updates lastActivity only', () => {
  const store = createStore();
  store.init(['room0'], 1000);

  store.touch('room0', 5000);

  assert.strictEqual(store.get('room0').lastActivity, 5000);
  assert.strictEqual(store.get('room0').state, 'running');
});

test('setState changes state', () => {
  const store = createStore();
  store.init(['room0'], 1000);

  store.setState('room0', 'stopped');

  assert.strictEqual(store.get('room0').state, 'stopped');
});

test('getAll returns a snapshot keyed by room id', () => {
  const store = createStore();
  store.init(['room0', 'room1'], 1000);

  const all = store.getAll();

  assert.deepStrictEqual(Object.keys(all).sort(), ['room0', 'room1']);
  assert.strictEqual(all.room0.state, 'running');
});

test('isIdleForStop is true for running, no-connection rooms past the threshold', () => {
  const store = createStore();
  store.init(['room0'], 0);

  assert.strictEqual(store.isIdleForStop('room0', 1000, 500), false);
  assert.strictEqual(store.isIdleForStop('room0', 1000, 1500), true);

  store.addConnection('room0', 1500);
  assert.strictEqual(store.isIdleForStop('room0', 1000, 5000), false);
});

test('isIdleForReset is true only for stopped rooms past the threshold', () => {
  const store = createStore();
  store.init(['room0'], 0);

  assert.strictEqual(store.isIdleForReset('room0', 1000, 5000), false);

  store.setState('room0', 'stopped');
  assert.strictEqual(store.isIdleForReset('room0', 1000, 500), false);
  assert.strictEqual(store.isIdleForReset('room0', 1000, 1500), true);
});
