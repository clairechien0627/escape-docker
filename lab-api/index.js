const path = require('path');
const http = require('http');
const { createApp } = require('./lib/app');
const { loadScenarios } = require('./lib/scenarios');
const { createDb } = require('./lib/db');
const { createRoomManagerClient } = require('./lib/room-manager-client');
const { runExploitScript } = require('./lib/runner');
const { createRunManager } = require('./lib/run-manager');
const { attachRunStream } = require('./lib/ws-stream');

const PORT = process.env.PORT || 4100;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'admin_dev_token';
const ROOM_MANAGER_URL = process.env.ROOM_MANAGER_URL || 'http://room-manager:4000';
// 容器內由 docker-compose 掛載 ./lab:/app/lab；本機開發時預設指向 repo 根目錄的 lab/
const LAB_DIR = process.env.LAB_DIR || path.join(__dirname, '..', 'lab');
const RUN_TIMEOUT_MS = Number(process.env.RUN_TIMEOUT_MS) || 120000;

const scenarios = loadScenarios(path.join(LAB_DIR, 'scenarios'));
const scenarioById = new Map(scenarios.map((s) => [s.id, s]));
const db = createDb(path.join(__dirname, 'data', 'runs.json'));
const roomManagerClient = createRoomManagerClient({ baseUrl: ROOM_MANAGER_URL, adminToken: ADMIN_TOKEN });

const runManager = createRunManager({
  scenarioById,
  db,
  runExploit: (scriptPath, opts) => runExploitScript(scriptPath, { timeoutMs: RUN_TIMEOUT_MS, ...opts }),
  roomManagerClient,
  labDir: LAB_DIR,
});

const app = createApp({
  scenarios,
  db,
  adminToken: ADMIN_TOKEN,
  runManager,
});

const server = http.createServer(app);
attachRunStream(server, runManager);

server.listen(PORT, () => {
  console.log(`[lab-api] listening on port ${PORT}`);
  console.log(`[lab-api] loaded ${scenarios.length} scenarios from ${path.join(LAB_DIR, 'scenarios')}`);
});
