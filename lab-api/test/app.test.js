const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const request = require('supertest');
const { createApp } = require('../lib/app');
const { createRunManager } = require('../lib/run-manager');

const SCENARIOS = [
  {
    id: 'room2',
    title: 'Sudo 腳本引數注入提權',
    vuln_type: 'sudo-misconfiguration',
    container: 'room2',
    exploit_script: 'exploits/room2.sh',
    expected_outcome: '透過 sudo 提權讀到 FLAG',
    falco_rule_refs: ['sudo_exec_backup_script'],
    exploit_steps: ['sudo -l', 'cat backup.sh', 'sudo backup.sh /secret/flag.txt', 'cat /tmp/out'],
  },
  {
    id: 'room3',
    title: 'Process Dump',
    vuln_type: 'proc-introspection',
    container: 'room3',
    exploit_script: 'exploits/room3.sh',
    expected_outcome: '...',
    falco_rule_refs: [],
    exploit_steps: ['...'],
  },
];

const STEP = { type: 'step', index: 1, name: 'recon', exit_code: 0, duration_ms: 5, output: 'ok' };
const RESULT = { type: 'result', scenario_id: 'room2', status: 'success', steps: 1, duration_ms: 10, final_privilege: 'root', flag_found: 'EscapeDocker{test}' };

function fakeDb() {
  const runs = [];
  return {
    runs,
    insert(run) { runs.push(run); return run; },
    list({ scenarioId } = {}) {
      let out = runs;
      if (scenarioId) out = out.filter((r) => r.scenario_id === scenarioId);
      return out.slice().reverse();
    },
    get(id) { return runs.find((r) => r.id === id); },
  };
}

function fakeRoomManagerClient(overrides = {}) {
  const calls = [];
  return {
    calls,
    async reset(roomId) {
      calls.push(roomId);
      if (overrides.failOn && overrides.failOn === roomId && calls.length === overrides.failOnCall) {
        throw new Error('room-manager unreachable');
      }
    },
  };
}

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

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

// 由於 fake runExploit 通常同步完成，POST /api/lab/runs 回應時 run 可能已經
// 結束（'result' 事件已在我們掛上 listener 前發出）。先檢查 run.result，
// 避免對「已經發生過」的事件 .once() 造成測試卡死。
function waitForResult(run) {
  if (run.result) return Promise.resolve(run.result);
  return new Promise((resolve) => run.emitter.once('result', resolve));
}

function buildApp(overrides = {}) {
  const db = overrides.db || fakeDb();
  const roomManagerClient = overrides.roomManagerClient || fakeRoomManagerClient();
  const fakeExploit = overrides.fakeExploit || fakeRunExploit();
  const scenarioById = new Map(SCENARIOS.map((s) => [s.id, s]));

  const runManager = overrides.runManager || createRunManager({
    scenarioById,
    db,
    runExploit: fakeExploit.run,
    roomManagerClient,
    labDir: '/app/lab',
  });

  const app = createApp({
    scenarios: SCENARIOS,
    db,
    adminToken: 'test-admin-token',
    runManager,
  });

  return { app, db, roomManagerClient, fakeExploit, runManager };
}

test('GET /api/lab/scenarios returns summaries without exploit_steps', async () => {
  const { app } = buildApp();

  const res = await request(app).get('/api/lab/scenarios');

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.length, 2);
  assert.strictEqual(res.body[0].id, 'room2');
  assert.strictEqual(res.body[0].exploit_steps, undefined);
});

test('GET /api/lab/scenarios/:id returns full scenario', async () => {
  const { app } = buildApp();

  const res = await request(app).get('/api/lab/scenarios/room2');

  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body.exploit_steps, SCENARIOS[0].exploit_steps);
});

test('GET /api/lab/scenarios/:id returns 404 for unknown scenario', async () => {
  const { app } = buildApp();

  const res = await request(app).get('/api/lab/scenarios/does-not-exist');

  assert.strictEqual(res.status, 404);
});

test('POST /api/lab/runs without admin token returns 401', async () => {
  const { app, roomManagerClient, fakeExploit } = buildApp();

  const res = await request(app).post('/api/lab/runs').send({ scenario_id: 'room2' });

  assert.strictEqual(res.status, 401);
  assert.deepStrictEqual(roomManagerClient.calls, []);
  assert.deepStrictEqual(fakeExploit.calls, []);
});

test('POST /api/lab/runs with unknown scenario_id returns 404', async () => {
  const { app } = buildApp();

  const res = await request(app)
    .post('/api/lab/runs')
    .set('x-admin-token', 'test-admin-token')
    .send({ scenario_id: 'does-not-exist' });

  assert.strictEqual(res.status, 404);
});

test('POST /api/lab/runs returns 202 immediately and the run finishes asynchronously', async () => {
  const { app, db, roomManagerClient, fakeExploit, runManager } = buildApp();

  const res = await request(app)
    .post('/api/lab/runs')
    .set('x-admin-token', 'test-admin-token')
    .send({ scenario_id: 'room2' });

  assert.strictEqual(res.status, 202);
  assert.strictEqual(res.body.scenario_id, 'room2');
  assert.ok(['starting', 'running'].includes(res.body.status));
  assert.strictEqual(res.body.emitter, undefined);

  const run = runManager.get(res.body.id);
  await waitForResult(run);

  assert.deepStrictEqual(roomManagerClient.calls, ['room2', 'room2']);
  assert.deepStrictEqual(fakeExploit.calls, [path.join('/app/lab', 'exploits/room2.sh')]);
  assert.strictEqual(db.runs.length, 1);
  assert.strictEqual(db.runs[0].id, res.body.id);
  assert.strictEqual(db.runs[0].status, 'success');
});

test('GET /api/lab/runs/:id reflects live progress while running, then the stored result once finished', async () => {
  const { app, runManager } = buildApp();

  const started = await request(app)
    .post('/api/lab/runs')
    .set('x-admin-token', 'test-admin-token')
    .send({ scenario_id: 'room2' });

  const run = runManager.get(started.body.id);
  await waitForResult(run);

  const res = await request(app).get(`/api/lab/runs/${started.body.id}`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.status, 'success');
  assert.strictEqual(res.body.flag_found, 'EscapeDocker{test}');
  assert.deepStrictEqual(res.body.steps, [STEP]);
});

test('GET /api/lab/runs lists run summaries newest-first, optionally filtered', async () => {
  const { app, db } = buildApp();
  db.insert({ id: 'room2-1', scenario_id: 'room2', status: 'success', steps: [{ big: 'data' }] });
  db.insert({ id: 'room3-1', scenario_id: 'room3', status: 'failed', steps: [] });

  const all = await request(app).get('/api/lab/runs');
  assert.deepStrictEqual(all.body.map((r) => r.id), ['room3-1', 'room2-1']);
  assert.strictEqual(all.body[1].steps, undefined);

  const filtered = await request(app).get('/api/lab/runs').query({ scenario_id: 'room2' });
  assert.deepStrictEqual(filtered.body.map((r) => r.id), ['room2-1']);
});

test('GET /api/lab/runs/:id returns the full historical run, including steps', async () => {
  const { app, db } = buildApp();
  db.insert({ id: 'room2-1', scenario_id: 'room2', status: 'success', steps: [{ index: 1 }] });

  const res = await request(app).get('/api/lab/runs/room2-1');

  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body.steps, [{ index: 1 }]);
});

test('GET /api/lab/runs/:id returns 404 for unknown run', async () => {
  const { app } = buildApp();

  const res = await request(app).get('/api/lab/runs/does-not-exist');

  assert.strictEqual(res.status, 404);
});

test('Falco webhook stores alerts, newest-first via GET /api/lab/alerts', async () => {
  const { app } = buildApp();

  await request(app).post('/api/lab/falco-webhook').send({ rule: 'Terminal shell in container' });
  await request(app).post('/api/lab/falco-webhook').send({ rule: 'Docker Socket Accessed From Container' });

  const res = await request(app).get('/api/lab/alerts');

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.length, 2);
  assert.strictEqual(res.body[0].alert.rule, 'Docker Socket Accessed From Container');
  assert.strictEqual(res.body[1].alert.rule, 'Terminal shell in container');
});

test('Falco webhook forwards alerts to currently-running runs', async () => {
  // 讓 exploit 卡在 gate 上，確保 run 在我們送出 webhook 時仍是 running
  const gate = deferred();
  const fakeExploit = {
    calls: [],
    run: async (scriptPath, { onStep } = {}) => {
      fakeExploit.calls.push(scriptPath);
      onStep(STEP);
      await gate.promise;
      return { exitCode: 0, timedOut: false, result: RESULT, stderr: '' };
    },
  };
  const { app, runManager } = buildApp({ fakeExploit });

  const started = await request(app)
    .post('/api/lab/runs')
    .set('x-admin-token', 'test-admin-token')
    .send({ scenario_id: 'room2' });

  const run = runManager.get(started.body.id);
  assert.strictEqual(run.status, 'running');

  const alerts = [];
  run.emitter.on('alert', (a) => alerts.push(a));

  await request(app).post('/api/lab/falco-webhook').send({ rule: 'Terminal shell in container' });

  gate.resolve();
  await waitForResult(run);

  assert.strictEqual(alerts.length, 1);
  assert.strictEqual(alerts[0].alert.rule, 'Terminal shell in container');
});
