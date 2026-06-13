const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const WebSocket = require('ws');
const { createRunManager } = require('../lib/run-manager');
const { attachRunStream } = require('../lib/ws-stream');

const SCENARIO = { id: 'room2', container: 'room2', exploit_script: 'exploits/room2.sh' };

const STEP1 = { type: 'step', index: 1, name: 'recon', exit_code: 0, duration_ms: 5, output: 'ok' };
const STEP2 = { type: 'step', index: 2, name: 'exploit', exit_code: 0, duration_ms: 7, output: 'pwned' };
const RESULT = { type: 'result', scenario_id: 'room2', status: 'success', steps: 2, duration_ms: 12, final_privilege: 'root', flag_found: 'EscapeDocker{test}' };

function fakeDb() {
  const runs = [];
  return { runs, insert(run) { runs.push(run); return run; }, get(id) { return runs.find((r) => r.id === id); } };
}

function fakeRoomManagerClient() {
  return { async reset() {} };
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

// 啟動一個帶 ws-stream 的 lab-api http server，回傳 { server, port, runManager, close }
function startServer({ runExploit }) {
  return new Promise((resolve) => {
    const scenarioById = new Map([['room2', SCENARIO]]);
    const db = fakeDb();
    const runManager = createRunManager({
      scenarioById, db, runExploit, roomManagerClient: fakeRoomManagerClient(), labDir: '/app/lab',
    });
    const server = http.createServer((req, res) => res.end());
    attachRunStream(server, runManager);
    server.listen(0, () => resolve({ server, port: server.address().port, runManager, db }));
  });
}

function collectMessages(ws) {
  const messages = [];
  ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
  return messages;
}

function onceClosed(ws) {
  return new Promise((resolve) => ws.on('close', resolve));
}

test('stream replays status/steps/result and closes once the run has already finished', async () => {
  const runExploit = async (scriptPath, { onStep }) => {
    onStep(STEP1);
    onStep(STEP2);
    return { exitCode: 0, timedOut: false, result: RESULT, stderr: '' };
  };

  const { server, port, runManager } = await startServer({ runExploit });
  const run = runManager.startRun('room2');

  // 讓 run 在我們連線前就完全跑完
  if (!run.result) await new Promise((resolve) => run.emitter.once('result', resolve));

  const ws = new WebSocket(`ws://localhost:${port}/api/lab/runs/${run.id}/stream`);
  const messages = collectMessages(ws);
  await onceClosed(ws);

  assert.deepStrictEqual(messages, [
    { type: 'status', status: 'success' },
    STEP1,
    STEP2,
    { type: 'result', ...JSON.parse(JSON.stringify(run.result)) },
  ]);

  server.close();
});

test('stream forwards live step/result events while the run is still in progress', async () => {
  const gate = deferred();
  const runExploit = async (scriptPath, { onStep }) => {
    onStep(STEP1);
    await gate.promise;
    onStep(STEP2);
    return { exitCode: 0, timedOut: false, result: RESULT, stderr: '' };
  };

  const { server, port, runManager } = await startServer({ runExploit });
  const run = runManager.startRun('room2');

  // 等到至少 step1 已經發出，確保連線時 run 仍在 running
  await new Promise((resolve) => {
    if (run.steps.length > 0) return resolve();
    run.emitter.once('step', resolve);
  });
  assert.strictEqual(run.status, 'running');

  // 先掛上 message listener（避免漏接），確認連線已開（此時補送的
  // status(running)+step1 已送出），才放行 gate 讓 step2/result 即時送達
  const ws = new WebSocket(`ws://localhost:${port}/api/lab/runs/${run.id}/stream`);
  const messages = collectMessages(ws);
  await new Promise((resolve) => ws.on('open', resolve));

  gate.resolve();
  await onceClosed(ws);

  // 連線時補送 status(running) + step1，之後即時收到 step2 + result
  assert.deepStrictEqual(messages, [
    { type: 'status', status: 'running' },
    STEP1,
    STEP2,
    { type: 'result', ...JSON.parse(JSON.stringify(run.result)) },
  ]);

  server.close();
});

test('stream sends an error and closes for an unknown run id', async () => {
  const { server, port } = await startServer({ runExploit: async () => ({ exitCode: 0, timedOut: false, result: null, stderr: '' }) });

  const ws = new WebSocket(`ws://localhost:${port}/api/lab/runs/does-not-exist/stream`);
  const messages = collectMessages(ws);
  await onceClosed(ws);

  assert.deepStrictEqual(messages, [{ type: 'error', error: 'unknown run' }]);

  server.close();
});

test('stream forwards alerts emitted while the run is in progress', async () => {
  const gate = deferred();
  const runExploit = async (scriptPath, { onStep }) => {
    onStep(STEP1);
    await gate.promise;
    return { exitCode: 0, timedOut: false, result: RESULT, stderr: '' };
  };

  const { server, port, runManager } = await startServer({ runExploit });
  const run = runManager.startRun('room2');

  await new Promise((resolve) => {
    if (run.steps.length > 0) return resolve();
    run.emitter.once('step', resolve);
  });

  const ws = new WebSocket(`ws://localhost:${port}/api/lab/runs/${run.id}/stream`);
  const messages = collectMessages(ws);
  await new Promise((resolve) => ws.on('open', resolve));

  runManager.notifyAlert({ received_at: 'now', alert: { rule: 'Terminal shell in container' } });
  gate.resolve();
  await onceClosed(ws);

  const alertMsg = messages.find((m) => m.type === 'alert');
  assert.ok(alertMsg);
  assert.strictEqual(alertMsg.alert.rule, 'Terminal shell in container');

  server.close();
});
