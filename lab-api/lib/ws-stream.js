const { WebSocketServer } = require('ws');

const STREAM_PATH = /^\/api\/lab\/runs\/([^/]+)\/stream$/;

// 將 GET /api/lab/runs/:id/stream 的 WebSocket upgrade 接到 run-manager 的事件上（Phase 3）。
//
// 連線時先補送目前已知狀態（status + 已完成的 steps + 若已結束的 result/error），
// 讓中途整理頁面、或晚一步連線的前端也能看到完整歷史；
// 若 run 尚在進行中，再持續轉發後續的 step/status/result/error/alert 事件，
// 直到 result/error 出現後關閉連線。
//
// 使用 noServer + server.on('upgrade')，因為 ws 路徑帶有動態的 :id，
// WebSocketServer 內建的 path 比對只支援固定字串。
function attachRunStream(server, runManager) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const match = req.url.match(STREAM_PATH);
    if (!match) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      handleConnection(ws, match[1], runManager);
    });
  });

  return wss;
}

function handleConnection(ws, runId, runManager) {
  const run = runManager.get(runId);
  if (!run) {
    ws.send(JSON.stringify({ type: 'error', error: 'unknown run' }));
    ws.close();
    return;
  }

  const send = (msg) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  send({ type: 'status', status: run.status });
  for (const step of run.steps) send(step);

  if (run.result) {
    send({ type: 'result', ...run.result });
    ws.close();
    return;
  }
  if (run.status === 'error') {
    send({ type: 'error', error: run.error });
    ws.close();
    return;
  }

  const onStep = (step) => send(step);
  const onStatus = (status) => send(status);
  const onAlert = (alert) => send(alert);
  const onResult = (result) => {
    send(result);
    cleanup();
    ws.close();
  };
  const onError = (error) => {
    send(error);
    cleanup();
    ws.close();
  };

  function cleanup() {
    run.emitter.off('step', onStep);
    run.emitter.off('status', onStatus);
    run.emitter.off('alert', onAlert);
    run.emitter.off('result', onResult);
    run.emitter.off('error', onError);
  }

  run.emitter.on('step', onStep);
  run.emitter.on('status', onStatus);
  run.emitter.on('alert', onAlert);
  run.emitter.on('result', onResult);
  run.emitter.on('error', onError);

  ws.on('close', cleanup);
}

module.exports = { attachRunStream };
