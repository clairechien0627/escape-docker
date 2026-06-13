const test = require('node:test');
const assert = require('node:assert');
const { createRunManager } = require('../lib/run-manager');

const SCENARIO = {
  id: 'room2',
  container: 'room2',
  exploit_script: 'exploits/room2.sh',
};

function fakeDb() {
  const runs = [];
  return {
    runs,
    insert(run) { runs.push(run); return run; },
    get(id) { return runs.find((r) => r.id === id); },
  };
}

function fakeRoomManagerClient(overrides = {}) {
  const calls = [];
  return {
    calls,
    async reset(roomId) {
      calls.push(roomId);
      if (overrides.failOnCall && calls.length === overrides.failOnCall) {
        throw new Error('room-manager unreachable');
      }
    },
  };
}

const STEP = { type: 'step', index: 1, name: 'recon', exit_code: 0, duration_ms: 5, output: 'ok' };
const RESULT = { type: 'result', scenario_id: 'room2', status: 'success', steps: 1, duration_ms: 10, final_privilege: 'root', flag_found: 'EscapeDocker{test}' };

function fakeRunExploit({ steps = [STEP], result = RESULT } = {}) {
  const calls = [];
  return {
    calls,
    run: async (scriptPath, { onStep } = {}) => {
      calls.push(scriptPath);
      for (const step of steps) onStep(step);
      return { exitCode: 0, timedOut: false, result, stderr: '' };
    },
  };
}

function build(overrides = {}) {
  const scenarioById = new Map([['room2', SCENARIO]]);
  const db = overrides.db || fakeDb();
  const roomManagerClient = overrides.roomManagerClient || fakeRoomManagerClient();
  const fakeExploit = overrides.fakeExploit || fakeRunExploit();
  const runManager = createRunManager({
    scenarioById,
    db,
    runExploit: fakeExploit.run,
    roomManagerClient,
    labDir: '/app/lab',
  });
  return { runManager, db, roomManagerClient, fakeExploit };
}

test('startRun returns immediately with status "starting" and an id', () => {
  const { runManager } = build();

  const run = runManager.startRun('room2');

  assert.strictEqual(run.status, 'starting');
  assert.match(run.id, /^room2-\d+$/);
  assert.deepStrictEqual(run.steps, []);
});

test('startRun returns null for unknown scenario', () => {
  const { runManager } = build();
  assert.strictEqual(runManager.startRun('does-not-exist'), null);
});

test('startRun emits status/step/result in order and persists the finished run to db', async () => {
  const { runManager, db, roomManagerClient } = build();

  const run = runManager.startRun('room2');
  const events = [];
  run.emitter.on('status', (e) => events.push(e));
  run.emitter.on('step', (e) => events.push(e));
  run.emitter.on('result', (e) => events.push(e));

  await new Promise((resolve) => run.emitter.once('result', resolve));

  assert.deepStrictEqual(events.map((e) => e.type), ['status', 'step', 'result']);
  assert.strictEqual(events[0].status, 'running');
  assert.deepStrictEqual(events[1], STEP);
  assert.strictEqual(events[2].status, 'success');
  assert.strictEqual(events[2].flag_found, 'EscapeDocker{test}');

  // reset called before and after the exploit run
  assert.deepStrictEqual(roomManagerClient.calls, ['room2', 'room2']);

  // run object reflects final state and was persisted
  assert.strictEqual(run.status, 'success');
  assert.deepStrictEqual(run.steps, [STEP]);
  assert.strictEqual(db.runs.length, 1);
  assert.strictEqual(db.runs[0].id, run.id);
  assert.strictEqual(db.runs[0].status, 'success');
});

test('startRun emits "error" and sets status "error" when the pre-run room-manager reset fails', async () => {
  const roomManagerClient = fakeRoomManagerClient({ failOnCall: 1 });
  const { runManager, db, fakeExploit } = build({ roomManagerClient });

  const run = runManager.startRun('room2');
  const err = await new Promise((resolve) => run.emitter.once('error', resolve));

  assert.strictEqual(err.type, 'error');
  assert.match(err.error, /room-manager unreachable/);
  assert.strictEqual(run.status, 'error');
  assert.deepStrictEqual(fakeExploit.calls, []);
  assert.strictEqual(db.runs.length, 0);
});

test('notifyAlert broadcasts "alert" only to runs that are still starting/running', async () => {
  const { runManager } = build();

  const run = runManager.startRun('room2');
  const alerts = [];
  run.emitter.on('alert', (a) => alerts.push(a));

  runManager.notifyAlert({ received_at: 'now', alert: { rule: 'during-run' } });

  await new Promise((resolve) => run.emitter.once('result', resolve));

  runManager.notifyAlert({ received_at: 'later', alert: { rule: 'after-run' } });

  assert.strictEqual(alerts.length, 1);
  assert.strictEqual(alerts[0].type, 'alert');
  assert.strictEqual(alerts[0].alert.rule, 'during-run');
});

test('get returns the run object and undefined for unknown ids', () => {
  const { runManager } = build();
  const run = runManager.startRun('room2');

  assert.strictEqual(runManager.get(run.id), run);
  assert.strictEqual(runManager.get('does-not-exist'), undefined);
});
