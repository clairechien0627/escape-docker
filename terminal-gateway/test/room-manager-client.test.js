const test = require('node:test');
const assert = require('node:assert');

test('ensureRoom posts to /rooms/:id/ensure and resolves on 2xx', async (t) => {
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push([url, options.method]);
    return { ok: true, json: async () => ({ state: 'running' }) };
  };
  t.after(() => { delete global.fetch; });

  const { ensureRoom } = require('../room-manager-client');
  const result = await ensureRoom('room0');

  assert.deepStrictEqual(calls, [['http://room-manager:4000/rooms/room0/ensure', 'POST']]);
  assert.deepStrictEqual(result, { state: 'running' });
});

test('ensureRoom throws with the server error message on non-2xx', async (t) => {
  global.fetch = async () => ({
    ok: false,
    status: 504,
    json: async () => ({ error: 'room failed to start in time' }),
  });
  t.after(() => { delete global.fetch; });

  const { ensureRoom } = require('../room-manager-client');
  await assert.rejects(() => ensureRoom('room0'), /room failed to start in time/);
});

test('heartbeat and release swallow network errors', async (t) => {
  global.fetch = async () => { throw new Error('connection refused'); };
  t.after(() => { delete global.fetch; });

  const { heartbeat, release } = require('../room-manager-client');
  await heartbeat('room0');
  await release('room0');
  // no throw == pass
});
