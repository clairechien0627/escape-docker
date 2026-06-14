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
    clear() { runs.length = 0; },
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

test('POST /api/lab/runs with unknown scenario_id returns 404', async () => {
  const { app } = buildApp();

  const res = await request(app)
    .post('/api/lab/runs')
    .send({ scenario_id: 'does-not-exist' });

  assert.strictEqual(res.status, 404);
});

test('POST /api/lab/runs returns 202 immediately and the run finishes asynchronously', async () => {
  const { app, db, roomManagerClient, fakeExploit, runManager } = buildApp();

  const res = await request(app)
    .post('/api/lab/runs')
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

test('DELETE /api/lab/runs clears all historical runs (and the in-memory alert log)', async () => {
  const { app, db } = buildApp();
  db.insert({ id: 'room2-1', scenario_id: 'room2', status: 'success', steps: [] });
  db.insert({ id: 'room3-1', scenario_id: 'room3', status: 'success', steps: [] });
  await request(app).post('/api/lab/falco-webhook').send({ rule: 'Sudo Exec Of Backup Script' });

  const del = await request(app).delete('/api/lab/runs');
  assert.strictEqual(del.status, 204);

  const runs = await request(app).get('/api/lab/runs');
  assert.deepStrictEqual(runs.body, []);

  const alerts = await request(app).get('/api/lab/alerts');
  assert.deepStrictEqual(alerts.body, []);
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

test('GET /api/lab/analytics/detection-matrix aggregates per-scenario stats, including scenarios with no runs', async () => {
  const { app, db } = buildApp();

  db.insert({ id: 'room2-1', scenario_id: 'room2', status: 'success', flag_found: 'EscapeDocker{a}', duration_ms: 1000, alerts: [{ alert: { rule: 'r1' } }], finished_at: '2026-06-13T16:20:27.063Z' });
  db.insert({ id: 'room2-2', scenario_id: 'room2', status: 'failed', flag_found: null, duration_ms: 2000, alerts: [], finished_at: '2026-06-13T16:22:20.755Z' });

  const res = await request(app).get('/api/lab/analytics/detection-matrix');

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.length, SCENARIOS.length);

  const room2 = res.body.find((r) => r.scenario_id === 'room2');
  assert.deepStrictEqual(room2.falco_rule_refs, SCENARIOS[0].falco_rule_refs);
  assert.strictEqual(room2.runs, 2);
  assert.strictEqual(room2.success_rate, 0.5);
  assert.strictEqual(room2.flag_rate, 0.5);
  assert.strictEqual(room2.avg_duration_ms, 1500);
  assert.strictEqual(room2.detection_rate, 0.5);
  // 'r1' 不是 sudo_exec_backup_script 對應的 Falco 規則名稱
  // （Sudo Exec Of Backup Script），所以沒有命中
  assert.strictEqual(room2.rule_coverage, 0);
  assert.deepStrictEqual(room2.triggered_rules, []);
  assert.strictEqual(room2.last_run_at, '2026-06-13T16:22:20.755Z');

  const room3 = res.body.find((r) => r.scenario_id === 'room3');
  assert.strictEqual(room3.runs, 0);
  assert.strictEqual(room3.success_rate, null);
  assert.strictEqual(room3.flag_rate, null);
  assert.strictEqual(room3.avg_duration_ms, null);
  assert.strictEqual(room3.detection_rate, null);
  // falco_rule_refs 為空，無可量測規則 -> rule_coverage 恆為 null
  assert.strictEqual(room3.rule_coverage, null);
  assert.deepStrictEqual(room3.triggered_rules, []);
  assert.strictEqual(room3.last_run_at, null);
});

test('GET /api/lab/analytics/detection-matrix computes rule_coverage from matched falco_rule_refs', async () => {
  const { app, db } = buildApp();

  // sudo_exec_backup_script -> "Sudo Exec Of Backup Script"（room2 唯一的
  // falco_rule_refs），實際命中時 rule_coverage 應為 1
  db.insert({
    id: 'room2-1',
    scenario_id: 'room2',
    status: 'success',
    flag_found: 'EscapeDocker{a}',
    duration_ms: 1000,
    alerts: [
      { alert: { rule: 'DAC Read Search Capability Used' } },
      { alert: { rule: 'Sudo Exec Of Backup Script' } },
    ],
    finished_at: '2026-06-14T09:06:09.839Z',
  });

  const res = await request(app).get('/api/lab/analytics/detection-matrix');

  const room2 = res.body.find((r) => r.scenario_id === 'room2');
  assert.strictEqual(room2.detection_rate, 1);
  assert.strictEqual(room2.rule_coverage, 1);
  assert.deepStrictEqual(room2.triggered_rules, ['Sudo Exec Of Backup Script']);
});

test('GET /api/lab/analytics/detection-matrix prefers alert_rule_counts over the (capped) alerts array', async () => {
  const { app, db } = buildApp();

  // alerts 被 MAX_RUN_ALERTS 截斷，不包含 'Sudo Exec Of Backup Script'，
  // 但 alert_rule_counts 仍記錄了完整的規則計數
  db.insert({
    id: 'room2-1',
    scenario_id: 'room2',
    status: 'success',
    flag_found: 'EscapeDocker{a}',
    duration_ms: 1000,
    alerts: [{ alert: { rule: 'DAC Read Search Capability Used' } }],
    alert_rule_counts: { 'DAC Read Search Capability Used': 1, 'Sudo Exec Of Backup Script': 1 },
    finished_at: '2026-06-14T09:06:09.839Z',
  });

  const res = await request(app).get('/api/lab/analytics/detection-matrix');

  const room2 = res.body.find((r) => r.scenario_id === 'room2');
  assert.strictEqual(room2.detection_rate, 1);
  assert.strictEqual(room2.rule_coverage, 1);
  assert.deepStrictEqual(room2.triggered_rules, ['Sudo Exec Of Backup Script']);
});

test('GET /api/lab/analytics/detection-matrix treats runs without an alerts field as not detected', async () => {
  const { app, db } = buildApp();

  db.insert({ id: 'room2-1', scenario_id: 'room2', status: 'success', flag_found: 'EscapeDocker{a}', duration_ms: 1000, finished_at: '2026-06-13T16:20:27.063Z' });

  const res = await request(app).get('/api/lab/analytics/detection-matrix');

  const room2 = res.body.find((r) => r.scenario_id === 'room2');
  assert.strictEqual(room2.runs, 1);
  assert.strictEqual(room2.detection_rate, 0);
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

test('run.alerts is capped but alert_rule_counts tracks the full tally (strace ground-truth pilot can flood Falco with Ptrace alerts)', async () => {
  // 讓 exploit 卡在 gate 上，確保 run 在我們灌入大量 webhook 時仍是 running
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
  const { app, db, runManager } = buildApp({ fakeExploit });

  const started = await request(app)
    .post('/api/lab/runs')
    .send({ scenario_id: 'room2' });

  const run = runManager.get(started.body.id);

  // 模擬 step_traced 觸發的 Ptrace 告警洪水（遠超過 MAX_RUN_ALERTS=200）
  for (let i = 0; i < 250; i++) {
    await request(app).post('/api/lab/falco-webhook').send({ rule: 'Ptrace Attach To Other Process' });
  }
  await request(app).post('/api/lab/falco-webhook').send({ rule: 'Docker Socket Accessed From Container' });

  gate.resolve();
  await waitForResult(run);

  const stored = db.runs.find((r) => r.id === started.body.id);
  assert.ok(stored.alerts.length <= 200);
  assert.strictEqual(stored.alert_rule_counts['Ptrace Attach To Other Process'], 250);
  assert.strictEqual(stored.alert_rule_counts['Docker Socket Accessed From Container'], 1);
});
