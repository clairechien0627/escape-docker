const WebSocket = require('ws');
const http = require('http');
const url = require('url');
const { spawnTerminal, resizeTerminal, killTerminal } = require('./docker-exec');
const { ensureRoom, heartbeat, release } = require('./room-manager-client');

const PORT = process.env.PORT || 3001;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Escape Docker Terminal Gateway\n');
});

const wss = new WebSocket.Server({ server });

wss.on('connection', async (ws, req) => {
  const params = new url.URL(req.url, `http://localhost:${PORT}`).searchParams;
  const roomId = params.get('room');

  if (!roomId) {
    ws.send(JSON.stringify({ type: 'error', message: 'Missing ?room= parameter' }));
    ws.close();
    return;
  }

  console.log(`[Terminal] New connection → room: ${roomId}`);

  let pty = null;
  let pendingResize = null;
  let heartbeatInterval = null;

  // 在 ensureRoom 之前就掛好 message handler，
  // 避免 client 在 onopen 立刻送出的 resize 訊息因 handler 尚未註冊而被丟棄
  ws.on('message', (msg) => {
    // JSON 控制訊息（resize）：必須是帶 type 欄位的物件，
    // 否則（包含純數字/true/false/null 等剛好也是合法 JSON 的單一按鍵）
    // 都當成終端機輸入直接寫入 pty
    let parsed = null;
    try {
      parsed = JSON.parse(msg);
    } catch {
      // 非 JSON，當成終端機輸入
    }

    if (parsed && typeof parsed === 'object' && parsed.type === 'resize') {
      if (pty) {
        resizeTerminal(pty, parsed.cols, parsed.rows);
      } else {
        pendingResize = { cols: parsed.cols, rows: parsed.rows };
      }
      return;
    }

    if (pty) pty.write(msg.toString());
  });

  ws.on('close', () => {
    console.log(`[Terminal] Connection closed → room: ${roomId}`);
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    release(roomId);
    if (pty) killTerminal(pty);
  });

  ws.on('error', (err) => {
    console.error(`[Terminal] WebSocket error: ${err.message}`);
    if (pty) killTerminal(pty);
  });

  ws.send(JSON.stringify({ type: 'status', message: 'starting' }));

  try {
    await ensureRoom(roomId);
  } catch (err) {
    console.error(`[Terminal] ensureRoom failed for ${roomId}: ${err.message}`);
    ws.send(JSON.stringify({ type: 'error', message: `房間啟動失敗：${err.message}` }));
    ws.close();
    return;
  }

  try {
    pty = spawnTerminal(roomId);
    if (pendingResize) {
      resizeTerminal(pty, pendingResize.cols, pendingResize.rows);
      pendingResize = null;
    }
  } catch (err) {
    ws.send(`\r\n\x1b[31m[ERROR] ${err.message}\x1b[0m\r\n`);
    ws.close();
    return;
  }

  ws.send(JSON.stringify({ type: 'ready' }));

  heartbeatInterval = setInterval(() => heartbeat(roomId), 30000);

  // pty stdout → WebSocket（null byte 會讓 xterm.js 狀態機出錯，轉發前替換掉）
  pty.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data.replace(/\0/g, ' '));
    }
  });

  pty.onExit(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send('\r\n\x1b[33m[Session ended. Close this tab or refresh to reconnect.]\x1b[0m\r\n');
      ws.close();
    }
  });
});

server.listen(PORT, () => {
  console.log(`[Terminal Gateway] Listening on port ${PORT}`);
});
