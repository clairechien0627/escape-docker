const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const request = require('supertest');
const { createApp } = require('../lib/app');

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

function buildApp(overrides = {}) {
  const db = overrides.db || fakeDb();
  const roomManagerClient = overrides.roomManagerClient || fakeRoomManagerClient();
  const runExploitCalls = [];
  const runExploit = overrides.runExploit || (async (scriptPath) => {
    runExploitCalls.push(scriptPath);
    return {
      exitCode: 0,
      timedOut: false,
      steps: [{ type: 'step', index: 1, name: 'recon', exit_code: 0, duration_ms: 5, output: 'ok' }],
      result: { type: 'result', scenario_id: 'room2', status: 'success', steps: 1, duration_ms: 10, final_privilege: 'root', flag_found: 'EscapeDocker{test}' },
      stderr: '',
    };
  });

  const app = createApp({
    scenarios: SCENARIOS,
    db,
    runExploit,
    roomManagerClient,
    adminToken: 'test-admin-token',
    labDir: '/app/lab',
  });

  return { app, db, roomManagerClient, runExploitCalls };
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
  const { app, roomManagerClient, runExploitCalls } = buildApp();

  const res = await request(app).post('/api/lab/runs').send({ scenario_id: 'room2' });

  assert.strictEqual(res.status, 401);
  assert.deepStrictEqual(roomManagerClient.calls, []);
  assert.deepStrictEqual(runExploitCalls, []);
});

test('POST /api/lab/runs with unknown scenario_id returns 404', async () => {
  const { app } = buildApp();

  const res = await request(app)
    .post('/api/lab/runs')
    .set('x-admin-token', 'test-admin-token')
    .send({ scenario_id: 'does-not-exist' });

  assert.strictEqual(res.status, 404);
});

test('POST /api/lab/runs resets the room, runs the exploit script, resets again, and stores the result', async () => {
  const { app, db, roomManagerClient, runExploitCalls } = buildApp();

  const res = await request(app)
    .post('/api/lab/runs')
    .set('x-admin-token', 'test-admin-token')
    .send({ scenario_id: 'room2' });

  assert.strictEqual(res.status, 201);
  assert.deepStrictEqual(roomManagerClient.calls, ['room2', 'room2']);
  assert.deepStrictEqual(runExploitCalls, [path.join('/app/lab', 'exploits/room2.sh')]);

  assert.strictEqual(res.body.scenario_id, 'room2');
  assert.strictEqual(res.body.status, 'success');
  assert.strictEqual(res.body.final_privilege, 'root');
  assert.strictEqual(res.body.flag_found, 'EscapeDocker{test}');
  assert.strictEqual(res.body.steps.length, 1);

  assert.strictEqual(db.runs.length, 1);
  assert.strictEqual(db.runs[0].id, res.body.id);
});

test('POST /api/lab/runs returns 502 if the pre-run room-manager reset fails', async () => {
  const roomManagerClient = fakeRoomManagerClient({ failOn: 'room2', failOnCall: 1 });
  const { app, db, runExploitCalls } = buildApp({ roomManagerClient });

  const res = await request(app)
    .post('/api/lab/runs')
    .set('x-admin-token', 'test-admin-token')
    .send({ scenario_id: 'room2' });

  assert.strictEqual(res.status, 502);
  assert.deepStrictEqual(runExploitCalls, []);
  assert.strictEqual(db.runs.length, 0);
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

test('GET /api/lab/runs/:id returns the full run, including steps', async () => {
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
