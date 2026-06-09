const WebSocket = require('ws');
const http = require('http');
const url = require('url');
const { spawnTerminal, resizeTerminal, killTerminal } = require('./docker-exec');

const PORT = process.env.PORT || 3001;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Escape Docker Terminal Gateway\n');
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  const params = new url.URL(req.url, `http://localhost:${PORT}`).searchParams;
  const roomId = params.get('room');

  if (!roomId) {
    ws.send(JSON.stringify({ type: 'error', message: 'Missing ?room= parameter' }));
    ws.close();
    return;
  }

  console.log(`[Terminal] New connection → room: ${roomId}`);

  let pty = null;

  try {
    pty = spawnTerminal(roomId);
  } catch (err) {
    ws.send(`\r\n\x1b[31m[ERROR] ${err.message}\x1b[0m\r\n`);
    ws.close();
    return;
  }

  // pty stdout → WebSocket
  pty.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });

  pty.onExit(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send('\r\n\x1b[33m[Session ended. Close this tab or refresh to reconnect.]\x1b[0m\r\n');
      ws.close();
    }
  });

  // WebSocket → pty stdin
  ws.on('message', (msg) => {
    try {
      // JSON 控制訊息
      const parsed = JSON.parse(msg);
      if (parsed.type === 'resize') {
        resizeTerminal(pty, parsed.cols, parsed.rows);
      }
    } catch {
      // 純文字 → 直接輸入到 terminal
      if (pty) pty.write(msg.toString());
    }
  });

  ws.on('close', () => {
    console.log(`[Terminal] Connection closed → room: ${roomId}`);
    if (pty) killTerminal(pty);
  });

  ws.on('error', (err) => {
    console.error(`[Terminal] WebSocket error: ${err.message}`);
    if (pty) killTerminal(pty);
  });
});

server.listen(PORT, () => {
  console.log(`[Terminal Gateway] Listening on port ${PORT}`);
});
