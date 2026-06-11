# room-manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `room-manager` microservice that starts/stops/resets room containers on demand, wires it into `terminal-gateway` and the frontend, so idle rooms are stopped automatically and players see live status badges + a startup overlay.

**Architecture:** A new Express + dockerode service (`room-manager/`) tracks per-room state (`running`/`starting`/`stopped`, `lastActivity`, `connections`) in memory and exposes `GET /status`, `POST /rooms/:id/ensure|heartbeat|release|reset`. `terminal-gateway` calls `ensure` before spawning a pty, sends periodic `heartbeat`, and `release` on disconnect, relaying `starting`/`ready`/`error` status messages to the xterm client. A 60s idle sweeper stops idle running rooms and force-recreates+stops long-idle stopped rooms. `map.html` polls `/api/rooms/status` for badges; `play.html` shows a loading overlay until `ready`; `admin.html` gets a token-gated manual reset table.

**Tech Stack:** Node.js 20 (Alpine), Express 4, dockerode 4, Node's built-in `node:test` + `supertest` for tests, no new frontend dependencies.

**Resolved design question — container recreate without docker-compose CLI:** Instead of shelling out to `docker compose up -d --force-recreate` (which would require bind-mounting the whole project directory into `room-manager` at a host-matching path — fragile on Windows/Docker Desktop), `room-manager` uses **dockerode snapshot + recreate**: `inspect()` the running container, `remove({force:true})` it, then `createContainer()` with the same `Config`/`HostConfig` (which already contains daemon-resolved bind paths, e.g. `/var/run/docker.sock:/var/run/docker.sock` for room6/7/9/final), reconnect any extra networks, and `start()`. This needs only the docker.sock mount — no project-directory mount, no `docker-cli` in the image.

---

## File Structure

- **Create** `room-manager/package.json`, `room-manager/Dockerfile`, `room-manager/.gitignore`
- **Create** `room-manager/rooms-config.json` — 15 rooms + linked containers (room4↔locked-server, room9↔secret-server)
- **Create** `room-manager/lib/state.js` — in-memory room state store (factory, testable)
- **Create** `room-manager/lib/docker.js` — dockerode wrapper (status/start/stop/recreate/waitUntilReady)
- **Create** `room-manager/lib/idle-sweeper.js` — idle sweep logic (factory, testable)
- **Create** `room-manager/lib/app.js` — Express app factory (routes)
- **Create** `room-manager/index.js` — bootstrap (wires store + docker + sweeper + app)
- **Create** `room-manager/test/state.test.js`, `test/idle-sweeper.test.js`, `test/app.test.js`
- **Modify** `docker-compose.yml` — add `room-manager` service; add `ROOM_MANAGER_URL`/`ADMIN_TOKEN`/`depends_on` to `terminal-gateway`
- **Modify** `.env.example` — add `ROOM_STOP_IDLE_MINUTES`, `ROOM_RESET_IDLE_MINUTES`
- **Modify** `nginx/nginx.conf` — add `upstream room_manager` + `location /api/rooms/`
- **Create** `terminal-gateway/room-manager-client.js` + `terminal-gateway/test/room-manager-client.test.js`
- **Modify** `terminal-gateway/index.js` — ensure/heartbeat/release integration + status messages
- **Modify** `terminal-gateway/package.json` — add `"test": "node --test"`
- **Modify** `frontend/js/api.js` — `roomsStatus()`
- **Modify** `frontend/map.html` — status badges + polling
- **Modify** `frontend/play.html` — loading overlay markup/CSS
- **Modify** `frontend/js/terminal.js` — handle `status`/`ready`/`error` messages, overlay control
- **Modify** `frontend/admin.html` — room status table + reset button

**Testing scope note:** `lib/state.js`, `lib/idle-sweeper.js`, `lib/app.js` (with a fake docker client) and `terminal-gateway/room-manager-client.js` get full TDD unit tests. `lib/docker.js` talks to a real Docker daemon and has no existing test harness for that in this repo (terminal-gateway has none either) — it is exercised by the manual full-stack verification in Task 18, matching the design spec's verification section.

---

### Task 1: room-manager project skeleton

**Files:**
- Create: `room-manager/package.json`
- Create: `room-manager/Dockerfile`
- Create: `room-manager/.gitignore`

- [ ] **Step 1: Create `room-manager/package.json`**

```json
{
  "name": "escape-docker-room-manager",
  "version": "1.0.0",
  "description": "On-demand room container lifecycle manager for Escape Docker",
  "main": "index.js",
  "scripts": {
    "start": "node index.js",
    "test": "node --test"
  },
  "dependencies": {
    "dockerode": "^4.0.2",
    "express": "^4.19.2"
  },
  "devDependencies": {
    "supertest": "^7.0.0"
  }
}
```

- [ ] **Step 2: Create `room-manager/Dockerfile`**

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 4000
CMD ["node", "index.js"]
```

- [ ] **Step 3: Create `room-manager/.gitignore`**

```
node_modules/
```

- [ ] **Step 4: Install dependencies**

Run (from `room-manager/`):
```bash
cd room-manager && npm install
```
Expected: `node_modules/` created, `package-lock.json` generated, no errors.

- [ ] **Step 5: Verify dependencies resolve**

Run:
```bash
node -e "require('express'); require('dockerode'); require('supertest'); console.log('ok')"
```
Expected output: `ok`

- [ ] **Step 6: Commit**

```bash
git add room-manager/package.json room-manager/package-lock.json room-manager/Dockerfile room-manager/.gitignore
git commit -m "feat(room-manager): add project skeleton"
```

---

### Task 2: rooms-config.json

**Files:**
- Create: `room-manager/rooms-config.json`

- [ ] **Step 1: Create `room-manager/rooms-config.json`**

```json
{
  "room0":    { "containers": ["room0"] },
  "room1":    { "containers": ["room1"] },
  "room2":    { "containers": ["room2"] },
  "room3":    { "containers": ["room3"] },
  "room4":    { "containers": ["room4", "locked-server"] },
  "room5":    { "containers": ["room5"] },
  "room6":    { "containers": ["room6"] },
  "room7":    { "containers": ["room7"] },
  "room8":    { "containers": ["room8"] },
  "room9":    { "containers": ["room9", "secret-server"] },
  "room10":   { "containers": ["room10"] },
  "room11":   { "containers": ["room11"] },
  "final":    { "containers": ["final"] },
  "secret-a": { "containers": ["secret-a"] },
  "secret-b": { "containers": ["secret-b"] }
}
```

- [ ] **Step 2: Verify it parses and has 15 rooms**

Run (from `room-manager/`):
```bash
node -e "console.log(Object.keys(require('./rooms-config.json')).length)"
```
Expected output: `15`

- [ ] **Step 3: Commit**

```bash
git add room-manager/rooms-config.json
git commit -m "feat(room-manager): add rooms config with linked containers"
```

---

### Task 3: lib/state.js — in-memory room state store (TDD)

**Files:**
- Create: `room-manager/test/state.test.js`
- Create: `room-manager/lib/state.js`

- [ ] **Step 1: Write the failing test**

Create `room-manager/test/state.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { createStore } = require('../lib/state');

test('init seeds rooms as running with zero connections', () => {
  const store = createStore();
  store.init(['room0', 'room1'], 1000);

  assert.deepStrictEqual(store.get('room0'), { state: 'running', lastActivity: 1000, connections: 0 });
  assert.deepStrictEqual(store.get('room1'), { state: 'running', lastActivity: 1000, connections: 0 });
});

test('addConnection increments connections and bumps lastActivity', () => {
  const store = createStore();
  store.init(['room0'], 1000);

  store.addConnection('room0', 2000);

  assert.strictEqual(store.get('room0').connections, 1);
  assert.strictEqual(store.get('room0').lastActivity, 2000);
});

test('removeConnection decrements but never goes below zero', () => {
  const store = createStore();
  store.init(['room0'], 1000);

  store.removeConnection('room0', 2000);

  assert.strictEqual(store.get('room0').connections, 0);
  assert.strictEqual(store.get('room0').lastActivity, 2000);
});

test('touch updates lastActivity only', () => {
  const store = createStore();
  store.init(['room0'], 1000);

  store.touch('room0', 5000);

  assert.strictEqual(store.get('room0').lastActivity, 5000);
  assert.strictEqual(store.get('room0').state, 'running');
});

test('setState changes state', () => {
  const store = createStore();
  store.init(['room0'], 1000);

  store.setState('room0', 'stopped');

  assert.strictEqual(store.get('room0').state, 'stopped');
});

test('getAll returns a snapshot keyed by room id', () => {
  const store = createStore();
  store.init(['room0', 'room1'], 1000);

  const all = store.getAll();

  assert.deepStrictEqual(Object.keys(all).sort(), ['room0', 'room1']);
  assert.strictEqual(all.room0.state, 'running');
});

test('isIdleForStop is true for running, no-connection rooms past the threshold', () => {
  const store = createStore();
  store.init(['room0'], 0);

  assert.strictEqual(store.isIdleForStop('room0', 1000, 500), false);
  assert.strictEqual(store.isIdleForStop('room0', 1000, 1500), true);

  store.addConnection('room0', 1500);
  assert.strictEqual(store.isIdleForStop('room0', 1000, 5000), false);
});

test('isIdleForReset is true only for stopped rooms past the threshold', () => {
  const store = createStore();
  store.init(['room0'], 0);

  assert.strictEqual(store.isIdleForReset('room0', 1000, 5000), false);

  store.setState('room0', 'stopped');
  assert.strictEqual(store.isIdleForReset('room0', 1000, 500), false);
  assert.strictEqual(store.isIdleForReset('room0', 1000, 1500), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `room-manager/`):
```bash
node --test test/state.test.js
```
Expected: FAIL — `Cannot find module '../lib/state'`

- [ ] **Step 3: Implement `room-manager/lib/state.js`**

```js
function createStore() {
  const rooms = new Map();

  function init(roomIds, now = Date.now()) {
    for (const id of roomIds) {
      rooms.set(id, { state: 'running', lastActivity: now, connections: 0 });
    }
  }

  function get(roomId) {
    return rooms.get(roomId);
  }

  function getAll() {
    const out = {};
    for (const [id, room] of rooms) {
      out[id] = { ...room };
    }
    return out;
  }

  function setState(roomId, newState) {
    const room = rooms.get(roomId);
    if (room) room.state = newState;
  }

  function touch(roomId, now = Date.now()) {
    const room = rooms.get(roomId);
    if (room) room.lastActivity = now;
  }

  function addConnection(roomId, now = Date.now()) {
    const room = rooms.get(roomId);
    if (!room) return;
    room.connections += 1;
    room.lastActivity = now;
  }

  function removeConnection(roomId, now = Date.now()) {
    const room = rooms.get(roomId);
    if (!room) return;
    room.connections = Math.max(0, room.connections - 1);
    room.lastActivity = now;
  }

  function isIdleForStop(roomId, stopIdleMs, now = Date.now()) {
    const room = rooms.get(roomId);
    return !!room
      && room.state === 'running'
      && room.connections === 0
      && (now - room.lastActivity) > stopIdleMs;
  }

  function isIdleForReset(roomId, resetIdleMs, now = Date.now()) {
    const room = rooms.get(roomId);
    return !!room
      && room.state === 'stopped'
      && (now - room.lastActivity) > resetIdleMs;
  }

  return {
    init, get, getAll, setState, touch,
    addConnection, removeConnection,
    isIdleForStop, isIdleForReset,
  };
}

module.exports = { createStore };
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
node --test test/state.test.js
```
Expected: all 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add room-manager/lib/state.js room-manager/test/state.test.js
git commit -m "feat(room-manager): add room state store"
```

---

### Task 4: lib/idle-sweeper.js — idle sweep logic (TDD)

**Files:**
- Create: `room-manager/test/idle-sweeper.test.js`
- Create: `room-manager/lib/idle-sweeper.js`

- [ ] **Step 1: Write the failing test**

Create `room-manager/test/idle-sweeper.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { createStore } = require('../lib/state');
const { createSweeper } = require('../lib/idle-sweeper');

function fakeDockerClient() {
  const calls = [];
  return {
    calls,
    async stopContainer(name) { calls.push(['stop', name]); },
    async recreateContainer(name) { calls.push(['recreate', name]); },
  };
}

test('sweep stops a running room with no connections past the stop threshold', async () => {
  const store = createStore();
  store.init(['room0'], 0);
  const dockerClient = fakeDockerClient();
  const sweeper = createSweeper({
    roomsConfig: { room0: { containers: ['room0'] } },
    store, dockerClient,
    stopIdleMs: 1000, resetIdleMs: 60000,
  });

  await sweeper.sweep(2000);

  assert.deepStrictEqual(dockerClient.calls, [['stop', 'room0']]);
  assert.strictEqual(store.get('room0').state, 'stopped');
});

test('sweep does not stop a running room with active connections', async () => {
  const store = createStore();
  store.init(['room0'], 0);
  store.addConnection('room0', 0);
  const dockerClient = fakeDockerClient();
  const sweeper = createSweeper({
    roomsConfig: { room0: { containers: ['room0'] } },
    store, dockerClient,
    stopIdleMs: 1000, resetIdleMs: 60000,
  });

  await sweeper.sweep(2000);

  assert.deepStrictEqual(dockerClient.calls, []);
  assert.strictEqual(store.get('room0').state, 'running');
});

test('sweep recreates and re-stops a stopped room past the reset threshold, and touches lastActivity', async () => {
  const store = createStore();
  store.init(['room4'], 0);
  store.setState('room4', 'stopped');
  const dockerClient = fakeDockerClient();
  const sweeper = createSweeper({
    roomsConfig: { room4: { containers: ['room4', 'locked-server'] } },
    store, dockerClient,
    stopIdleMs: 1000, resetIdleMs: 5000,
  });

  await sweeper.sweep(6000);

  assert.deepStrictEqual(dockerClient.calls, [
    ['recreate', 'room4'],
    ['recreate', 'locked-server'],
    ['stop', 'room4'],
    ['stop', 'locked-server'],
  ]);
  assert.strictEqual(store.get('room4').state, 'stopped');
  assert.strictEqual(store.get('room4').lastActivity, 6000);
});

test('sweep ignores rooms that are neither idle-for-stop nor idle-for-reset', async () => {
  const store = createStore();
  store.init(['room0'], 0);
  const dockerClient = fakeDockerClient();
  const sweeper = createSweeper({
    roomsConfig: { room0: { containers: ['room0'] } },
    store, dockerClient,
    stopIdleMs: 1000, resetIdleMs: 5000,
  });

  await sweeper.sweep(500);

  assert.deepStrictEqual(dockerClient.calls, []);
  assert.strictEqual(store.get('room0').state, 'running');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `room-manager/`):
```bash
node --test test/idle-sweeper.test.js
```
Expected: FAIL — `Cannot find module '../lib/idle-sweeper'`

- [ ] **Step 3: Implement `room-manager/lib/idle-sweeper.js`**

```js
function createSweeper({ roomsConfig, store, dockerClient, stopIdleMs, resetIdleMs }) {
  async function sweep(now = Date.now()) {
    for (const [id, room] of Object.entries(roomsConfig)) {
      if (store.isIdleForStop(id, stopIdleMs, now)) {
        try {
          for (const container of room.containers) {
            await dockerClient.stopContainer(container);
          }
          store.setState(id, 'stopped');
        } catch (err) {
          console.error(`[idle-sweeper] failed to stop ${id}: ${err.message}`);
        }
      } else if (store.isIdleForReset(id, resetIdleMs, now)) {
        try {
          for (const container of room.containers) {
            await dockerClient.recreateContainer(container);
          }
          for (const container of room.containers) {
            await dockerClient.stopContainer(container);
          }
          store.setState(id, 'stopped');
          store.touch(id, now);
        } catch (err) {
          console.error(`[idle-sweeper] failed to reset ${id}: ${err.message}`);
        }
      }
    }
  }

  function start(intervalMs = 60000) {
    return setInterval(() => {
      sweep().catch((err) => console.error(`[idle-sweeper] sweep error: ${err.message}`));
    }, intervalMs);
  }

  return { sweep, start };
}

module.exports = { createSweeper };
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
node --test test/idle-sweeper.test.js
```
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add room-manager/lib/idle-sweeper.js room-manager/test/idle-sweeper.test.js
git commit -m "feat(room-manager): add idle sweeper"
```

---

### Task 5: lib/docker.js — status/start/stop wrapper

**Files:**
- Create: `room-manager/lib/docker.js`

- [ ] **Step 1: Implement status/start/stop in `room-manager/lib/docker.js`**

```js
const Docker = require('dockerode');

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

async function getContainerStatus(name) {
  try {
    const info = await docker.getContainer(name).inspect();
    return info.State.Running ? 'running' : 'stopped';
  } catch (err) {
    if (err.statusCode === 404) return 'missing';
    throw err;
  }
}

async function startContainer(name) {
  const container = docker.getContainer(name);
  const info = await container.inspect();
  if (!info.State.Running) {
    await container.start();
  }
}

async function stopContainer(name) {
  const container = docker.getContainer(name);
  const info = await container.inspect();
  if (info.State.Running) {
    await container.stop();
  }
}

module.exports = {
  docker,
  getContainerStatus,
  startContainer,
  stopContainer,
};
```

- [ ] **Step 2: Verify the module loads without a Docker daemon**

Run (from `room-manager/`):
```bash
node -e "const d = require('./lib/docker'); console.log(typeof d.startContainer, typeof d.stopContainer, typeof d.getContainerStatus)"
```
Expected output: `function function function`

(No live-daemon test here — `dockerode`'s constructor does not connect eagerly. Behavior against a real daemon is covered in Task 18.)

- [ ] **Step 3: Commit**

```bash
git add room-manager/lib/docker.js
git commit -m "feat(room-manager): add docker status/start/stop wrapper"
```

---

### Task 6: lib/docker.js — recreateContainer + waitUntilReady

**Files:**
- Modify: `room-manager/lib/docker.js`

- [ ] **Step 1: Append `recreateContainer` and `waitUntilReady` to `room-manager/lib/docker.js`**

Add before `module.exports`:

```js
async function recreateContainer(name) {
  const container = docker.getContainer(name);
  const info = await container.inspect();

  const createOptions = {
    name,
    Image: info.Config.Image,
    Env: info.Config.Env,
    Cmd: info.Config.Cmd,
    Entrypoint: info.Config.Entrypoint,
    Hostname: info.Config.Hostname,
    Tty: info.Config.Tty,
    OpenStdin: info.Config.OpenStdin,
    Labels: info.Config.Labels,
    HostConfig: info.HostConfig,
  };

  await container.remove({ force: true });

  const newContainer = await docker.createContainer(createOptions);

  const oldShortId = info.Id.substring(0, 12);
  const networks = info.NetworkSettings.Networks || {};
  for (const [netName, netInfo] of Object.entries(networks)) {
    const aliases = (netInfo.Aliases || []).filter((a) => a !== oldShortId);
    try {
      await docker.getNetwork(netName).connect({
        Container: newContainer.id,
        EndpointConfig: { IPAMConfig: netInfo.IPAMConfig, Aliases: aliases },
      });
    } catch (err) {
      if (!/already exists|already attached|already connected/i.test(err.message)) {
        throw err;
      }
    }
  }

  await newContainer.start();
}

async function waitUntilReady(name, timeoutMs = 30000) {
  const container = docker.getContainer(name);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const exec = await container.exec({ Cmd: ['true'], AttachStdout: true, AttachStderr: true });
      const stream = await exec.start({});
      await new Promise((resolve, reject) => {
        stream.on('end', resolve);
        stream.on('error', reject);
      });
      const result = await exec.inspect();
      if (result.ExitCode === 0) return true;
    } catch {
      // container not ready yet — retry
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}
```

- [ ] **Step 2: Update `module.exports`**

```js
module.exports = {
  docker,
  getContainerStatus,
  startContainer,
  stopContainer,
  recreateContainer,
  waitUntilReady,
};
```

- [ ] **Step 3: Verify the module still loads**

Run (from `room-manager/`):
```bash
node -e "const d = require('./lib/docker'); console.log(typeof d.recreateContainer, typeof d.waitUntilReady)"
```
Expected output: `function function`

- [ ] **Step 4: Commit**

```bash
git add room-manager/lib/docker.js
git commit -m "feat(room-manager): add recreateContainer and waitUntilReady"
```

---

### Task 7: lib/app.js — Express routes (TDD)

**Files:**
- Create: `room-manager/test/app.test.js`
- Create: `room-manager/lib/app.js`

- [ ] **Step 1: Write the failing test**

Create `room-manager/test/app.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { createStore } = require('../lib/state');
const { createApp } = require('../lib/app');

const ROOMS_CONFIG = {
  room0: { containers: ['room0'] },
  room4: { containers: ['room4', 'locked-server'] },
};

function fakeDockerClient(overrides = {}) {
  const calls = [];
  return {
    calls,
    async startContainer(name) { calls.push(['start', name]); },
    async stopContainer(name) { calls.push(['stop', name]); },
    async recreateContainer(name) { calls.push(['recreate', name]); },
    async waitUntilReady(name) { calls.push(['waitUntilReady', name]); return true; },
    ...overrides,
  };
}

function buildApp(overrides = {}) {
  const store = createStore();
  store.init(Object.keys(ROOMS_CONFIG), 0);
  const dockerClient = fakeDockerClient(overrides.dockerOverrides);
  const app = createApp({
    roomsConfig: ROOMS_CONFIG,
    store,
    dockerClient,
    adminToken: 'test-admin-token',
    ensureTimeoutMs: 1000,
  });
  return { app, store, dockerClient };
}

test('GET /status returns all room states', async () => {
  const { app } = buildApp();

  const res = await request(app).get('/status');

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.room0.state, 'running');
  assert.strictEqual(res.body.room4.state, 'running');
});

test('POST /rooms/:id/ensure on a running room does not start containers', async () => {
  const { app, dockerClient } = buildApp();

  const res = await request(app).post('/rooms/room0/ensure');

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.state, 'running');
  assert.deepStrictEqual(dockerClient.calls, []);
});

test('POST /rooms/:id/ensure on a stopped room starts and waits for all linked containers', async () => {
  const { app, store, dockerClient } = buildApp();
  store.setState('room4', 'stopped');

  const res = await request(app).post('/rooms/room4/ensure');

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.state, 'running');
  assert.deepStrictEqual(dockerClient.calls, [
    ['start', 'room4'],
    ['start', 'locked-server'],
    ['waitUntilReady', 'room4'],
  ]);
  assert.strictEqual(store.get('room4').state, 'running');
});

test('POST /rooms/:id/ensure returns 504 and marks stopped if readiness times out', async () => {
  const { app, store } = buildApp({ dockerOverrides: { async waitUntilReady() { return false; } } });
  store.setState('room0', 'stopped');

  const res = await request(app).post('/rooms/room0/ensure');

  assert.strictEqual(res.status, 504);
  assert.strictEqual(store.get('room0').state, 'stopped');
});

test('POST /rooms/:id/ensure on unknown room returns 404', async () => {
  const { app } = buildApp();

  const res = await request(app).post('/rooms/does-not-exist/ensure');

  assert.strictEqual(res.status, 404);
});

test('POST /rooms/:id/heartbeat updates lastActivity', async () => {
  const { app, store } = buildApp();

  const res = await request(app).post('/rooms/room0/heartbeat');

  assert.strictEqual(res.status, 200);
  assert.ok(store.get('room0').lastActivity > 0);
});

test('POST /rooms/:id/release decrements connections', async () => {
  const { app, store } = buildApp();
  store.addConnection('room0', 0);

  const res = await request(app).post('/rooms/room0/release');

  assert.strictEqual(res.status, 200);
  assert.strictEqual(store.get('room0').connections, 0);
});

test('POST /rooms/:id/reset without admin token returns 401', async () => {
  const { app, dockerClient } = buildApp();

  const res = await request(app).post('/rooms/room0/reset');

  assert.strictEqual(res.status, 401);
  assert.deepStrictEqual(dockerClient.calls, []);
});

test('POST /rooms/:id/reset with valid admin token recreates linked containers', async () => {
  const { app, store, dockerClient } = buildApp();

  const res = await request(app)
    .post('/rooms/room4/reset')
    .set('X-Admin-Token', 'test-admin-token');

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.state, 'running');
  assert.deepStrictEqual(dockerClient.calls, [
    ['recreate', 'room4'],
    ['recreate', 'locked-server'],
    ['waitUntilReady', 'room4'],
  ]);
  assert.strictEqual(store.get('room4').state, 'running');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `room-manager/`):
```bash
node --test test/app.test.js
```
Expected: FAIL — `Cannot find module '../lib/app'`

- [ ] **Step 3: Implement `room-manager/lib/app.js`**

```js
const express = require('express');

function createApp({ roomsConfig, store, dockerClient, adminToken, ensureTimeoutMs = 30000 }) {
  const app = express();
  app.use(express.json());

  app.get('/status', (req, res) => {
    res.json(store.getAll());
  });

  app.post('/rooms/:id/ensure', async (req, res) => {
    const { id } = req.params;
    const room = roomsConfig[id];
    if (!room) return res.status(404).json({ error: 'unknown room' });

    store.addConnection(id);

    try {
      const current = store.get(id);
      if (current.state !== 'running') {
        store.setState(id, 'starting');
        for (const container of room.containers) {
          await dockerClient.startContainer(container);
        }
        const ready = await dockerClient.waitUntilReady(room.containers[0], ensureTimeoutMs);
        if (!ready) {
          store.setState(id, 'stopped');
          return res.status(504).json({ error: 'room failed to start in time' });
        }
        store.setState(id, 'running');
      }
      res.json({ state: 'running' });
    } catch (err) {
      store.setState(id, 'stopped');
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/rooms/:id/heartbeat', (req, res) => {
    const { id } = req.params;
    if (!roomsConfig[id]) return res.status(404).json({ error: 'unknown room' });
    store.touch(id);
    res.json({ ok: true });
  });

  app.post('/rooms/:id/release', (req, res) => {
    const { id } = req.params;
    if (!roomsConfig[id]) return res.status(404).json({ error: 'unknown room' });
    store.removeConnection(id);
    res.json({ ok: true });
  });

  app.post('/rooms/:id/reset', async (req, res) => {
    const { id } = req.params;
    const room = roomsConfig[id];
    if (!room) return res.status(404).json({ error: 'unknown room' });
    if (req.headers['x-admin-token'] !== adminToken) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    try {
      store.setState(id, 'starting');
      for (const container of room.containers) {
        await dockerClient.recreateContainer(container);
      }
      const ready = await dockerClient.waitUntilReady(room.containers[0], ensureTimeoutMs);
      store.setState(id, ready ? 'running' : 'stopped');
      store.touch(id);
      res.json({ state: store.get(id).state });
    } catch (err) {
      store.setState(id, 'stopped');
      res.status(500).json({ error: err.message });
    }
  });

  return app;
}

module.exports = { createApp };
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
node --test test/app.test.js
```
Expected: all 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add room-manager/lib/app.js room-manager/test/app.test.js
git commit -m "feat(room-manager): add express routes for status/ensure/heartbeat/release/reset"
```

---

### Task 8: index.js — bootstrap

**Files:**
- Create: `room-manager/index.js`

- [ ] **Step 1: Implement `room-manager/index.js`**

```js
const { createApp } = require('./lib/app');
const { createStore } = require('./lib/state');
const { createSweeper } = require('./lib/idle-sweeper');
const dockerClient = require('./lib/docker');
const roomsConfig = require('./rooms-config.json');

const PORT = process.env.PORT || 4000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'admin_dev_token';
const STOP_IDLE_MS = (Number(process.env.ROOM_STOP_IDLE_MINUTES) || 10) * 60 * 1000;
const RESET_IDLE_MS = (Number(process.env.ROOM_RESET_IDLE_MINUTES) || 60) * 60 * 1000;

const store = createStore();
store.init(Object.keys(roomsConfig));

const app = createApp({
  roomsConfig,
  store,
  dockerClient,
  adminToken: ADMIN_TOKEN,
});

const sweeper = createSweeper({
  roomsConfig,
  store,
  dockerClient,
  stopIdleMs: STOP_IDLE_MS,
  resetIdleMs: RESET_IDLE_MS,
});
sweeper.start();

app.listen(PORT, () => {
  console.log(`[room-manager] listening on port ${PORT}`);
  console.log(`[room-manager] stop idle: ${STOP_IDLE_MS / 60000}min, reset idle: ${RESET_IDLE_MS / 60000}min`);
});
```

- [ ] **Step 2: Verify it starts and shuts down cleanly**

Run (from `room-manager/`):
```bash
node index.js
```
Expected output (within ~1s):
```
[room-manager] listening on port 4000
[room-manager] stop idle: 10min, reset idle: 60min
```
Press `Ctrl+C` to stop. (No Docker daemon is required to start — `dockerode` only connects when an operation runs, and the first sweep is 60s away.)

- [ ] **Step 3: Run the full test suite**

Run:
```bash
npm test
```
Expected: all tests across `state.test.js`, `idle-sweeper.test.js`, `app.test.js` PASS.

- [ ] **Step 4: Commit**

```bash
git add room-manager/index.js
git commit -m "feat(room-manager): wire up bootstrap entrypoint"
```

---

### Task 9: docker-compose.yml — add room-manager service

**Files:**
- Modify: `docker-compose.yml:39-50` (insert new service after `scoreboard-api`)
- Modify: `docker-compose.yml:28-37` (`terminal-gateway` service)

- [ ] **Step 1: Insert the `room-manager` service after `scoreboard-api`**

In `docker-compose.yml`, the `scoreboard-api` service currently ends at line 50 (`restart: unless-stopped`) right before the `# ══════════════ Chapter 1：The Awakening ══════════════` comment on line 52. Insert a new service between them:

```yaml
  # ──────────────── Room Manager ────────────────
  room-manager:
    build: ./room-manager
    container_name: room-manager
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    networks:
      - game_net
    environment:
      - PORT=4000
      - ADMIN_TOKEN=${ADMIN_TOKEN:-admin_dev_token}
      - ROOM_STOP_IDLE_MINUTES=${ROOM_STOP_IDLE_MINUTES:-10}
      - ROOM_RESET_IDLE_MINUTES=${ROOM_RESET_IDLE_MINUTES:-60}
    restart: unless-stopped
```

- [ ] **Step 2: Add `ROOM_MANAGER_URL` and `depends_on` to `terminal-gateway`**

Modify the existing `terminal-gateway` service (`docker-compose.yml:28-37`):

```yaml
  # ──────────────── Web Terminal Gateway ────────────────
  terminal-gateway:
    build: ./terminal-gateway
    container_name: terminal-gateway
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    networks:
      - game_net
    environment:
      - NODE_ENV=production
      - ROOM_MANAGER_URL=http://room-manager:4000
    depends_on:
      - room-manager
    restart: unless-stopped
```

- [ ] **Step 3: Validate the compose file**

Run (from `escape-docker/`):
```bash
docker compose config --quiet
```
Expected: no output, exit code 0 (means YAML is valid and interpolations resolve).

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add room-manager service and wire terminal-gateway to it"
```

---

### Task 10: .env.example — idle thresholds

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Append idle threshold settings**

Add to the end of `.env.example`:

```env

# Room Manager：房間閒置自動停止（分鐘）
ROOM_STOP_IDLE_MINUTES=10

# Room Manager：房間閒置自動重置（分鐘，需大於 ROOM_STOP_IDLE_MINUTES）
ROOM_RESET_IDLE_MINUTES=60
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: document room-manager idle threshold env vars"
```

---

### Task 11: nginx.conf — /api/rooms/ route

**Files:**
- Modify: `nginx/nginx.conf`

- [ ] **Step 1: Add the `room_manager` upstream**

In `nginx/nginx.conf`, after the existing `upstream terminal_gw { ... }` block (lines 13-15), add:

```nginx
    upstream room_manager {
        server room-manager:4000;
    }
```

- [ ] **Step 2: Add the `/api/rooms/` location block**

After the existing `location /api/ { ... }` block (lines 29-34), add:

```nginx
        # ── Room Manager（房間狀態 / 啟停 / 重置）──
        location /api/rooms/ {
            proxy_pass         http://room_manager/;
            proxy_http_version 1.1;
            proxy_set_header   Host $host;
            proxy_set_header   X-Real-IP $remote_addr;
        }
```

`/api/rooms/` is a longer, more specific prefix than `/api/`, so nginx will route it to `room_manager` instead of `scoreboard_api` regardless of declaration order.

- [ ] **Step 3: Verify nginx config syntax**

Run (from `escape-docker/`, after Task 9's compose edits are in place so the `room-manager` service/network exists):
```bash
docker compose exec nginx nginx -t
```
Expected:
```
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
```
(If `nginx` isn't running yet, this check is folded into Task 18's full-stack verification instead.)

- [ ] **Step 4: Commit**

```bash
git add nginx/nginx.conf
git commit -m "feat(nginx): proxy /api/rooms/ to room-manager"
```

---

### Task 12: terminal-gateway/room-manager-client.js (TDD)

**Files:**
- Create: `terminal-gateway/test/room-manager-client.test.js`
- Create: `terminal-gateway/room-manager-client.js`
- Modify: `terminal-gateway/package.json`

- [ ] **Step 1: Add a test script to `terminal-gateway/package.json`**

Modify `terminal-gateway/package.json` scripts block:

```json
  "scripts": {
    "start": "node index.js",
    "dev": "nodemon index.js",
    "test": "node --test"
  },
```

- [ ] **Step 2: Write the failing test**

Create `terminal-gateway/test/room-manager-client.test.js`:

```js
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
```

- [ ] **Step 3: Run test to verify it fails**

Run (from `terminal-gateway/`):
```bash
node --test test/room-manager-client.test.js
```
Expected: FAIL — `Cannot find module '../room-manager-client'`

- [ ] **Step 4: Implement `terminal-gateway/room-manager-client.js`**

```js
const ROOM_MANAGER_URL = process.env.ROOM_MANAGER_URL || 'http://room-manager:4000';

async function ensureRoom(roomId) {
  const res = await fetch(`${ROOM_MANAGER_URL}/rooms/${roomId}/ensure`, { method: 'POST' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `room-manager ensure failed (${res.status})`);
  }
  return res.json();
}

async function heartbeat(roomId) {
  try {
    await fetch(`${ROOM_MANAGER_URL}/rooms/${roomId}/heartbeat`, { method: 'POST' });
  } catch (err) {
    console.error(`[room-manager-client] heartbeat failed: ${err.message}`);
  }
}

async function release(roomId) {
  try {
    await fetch(`${ROOM_MANAGER_URL}/rooms/${roomId}/release`, { method: 'POST' });
  } catch (err) {
    console.error(`[room-manager-client] release failed: ${err.message}`);
  }
}

module.exports = { ensureRoom, heartbeat, release };
```

- [ ] **Step 5: Run test to verify it passes**

Run:
```bash
node --test test/room-manager-client.test.js
```
Expected: all 3 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add terminal-gateway/package.json terminal-gateway/room-manager-client.js terminal-gateway/test/room-manager-client.test.js
git commit -m "feat(terminal-gateway): add room-manager HTTP client"
```

---

### Task 13: terminal-gateway/index.js — ensure/heartbeat/release integration

**Files:**
- Modify: `terminal-gateway/index.js`

- [ ] **Step 1: Import the client**

At the top of `terminal-gateway/index.js` (after the existing `require('./docker-exec')` line), add:

```js
const { ensureRoom, heartbeat, release } = require('./room-manager-client');
```

- [ ] **Step 2: Make the connection handler async and call `ensureRoom` before spawning the pty**

Replace the connection handler (`terminal-gateway/index.js:15-35`):

```js
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
```

with:

```js
wss.on('connection', async (ws, req) => {
  const params = new url.URL(req.url, `http://localhost:${PORT}`).searchParams;
  const roomId = params.get('room');

  if (!roomId) {
    ws.send(JSON.stringify({ type: 'error', message: 'Missing ?room= parameter' }));
    ws.close();
    return;
  }

  console.log(`[Terminal] New connection → room: ${roomId}`);

  ws.send(JSON.stringify({ type: 'status', message: 'starting' }));

  try {
    await ensureRoom(roomId);
  } catch (err) {
    console.error(`[Terminal] ensureRoom failed for ${roomId}: ${err.message}`);
    ws.send(JSON.stringify({ type: 'error', message: `房間啟動失敗：${err.message}` }));
    ws.close();
    return;
  }

  let pty = null;

  try {
    pty = spawnTerminal(roomId);
  } catch (err) {
    ws.send(`\r\n\x1b[31m[ERROR] ${err.message}\x1b[0m\r\n`);
    ws.close();
    return;
  }

  ws.send(JSON.stringify({ type: 'ready' }));

  const heartbeatInterval = setInterval(() => heartbeat(roomId), 30000);
```

- [ ] **Step 3: Clear the heartbeat and call `release` on close**

Replace the `ws.on('close', ...)` handler (`terminal-gateway/index.js:65-68`):

```js
  ws.on('close', () => {
    console.log(`[Terminal] Connection closed → room: ${roomId}`);
    if (pty) killTerminal(pty);
  });
```

with:

```js
  ws.on('close', () => {
    console.log(`[Terminal] Connection closed → room: ${roomId}`);
    clearInterval(heartbeatInterval);
    release(roomId);
    if (pty) killTerminal(pty);
  });
```

- [ ] **Step 4: Verify the file has no syntax errors**

Run (from `terminal-gateway/`):
```bash
node -c index.js
```
Expected: no output, exit code 0.

- [ ] **Step 5: Run the existing test suite**

Run:
```bash
npm test
```
Expected: `room-manager-client.test.js` tests still PASS (this task doesn't add new automated tests for `index.js` — the WebSocket+pty+docker integration is covered by Task 18's manual verification).

- [ ] **Step 6: Commit**

```bash
git add terminal-gateway/index.js
git commit -m "feat(terminal-gateway): ensure/heartbeat/release rooms via room-manager"
```

---

### Task 14: frontend/js/api.js — roomsStatus()

**Files:**
- Modify: `frontend/js/api.js:39` (inside the `API` object)

- [ ] **Step 1: Add `roomsStatus` next to the existing `rooms` entry**

In `frontend/js/api.js`, change:

```js
  rooms: () => apiFetch('/rooms'),
```

to:

```js
  rooms: () => apiFetch('/rooms'),

  roomsStatus: () => apiFetch('/rooms/status'),
```

- [ ] **Step 2: Verify no syntax errors**

Run (from `frontend/`):
```bash
node -c js/api.js
```
Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add frontend/js/api.js
git commit -m "feat(frontend): add roomsStatus API call"
```

---

### Task 15: frontend/map.html — status badges + polling

**Files:**
- Modify: `frontend/map.html` (CSS block near line 39, room-card markup near line 236, script near line 259)

- [ ] **Step 1: Add badge CSS**

In `frontend/map.html`, after the `.room-card { ... }` rule (ends at line 39), add:

```css
    .room-badge {
      position: absolute;
      top: 8px; left: 10px;
      font-size: 0.85rem;
      z-index: 2;
    }
```

- [ ] **Step 2: Add a badge placeholder and `data-room-id` to each room card**

In `frontend/map.html`, the card markup (lines 236-243) is:

```js
        card.innerHTML = `
          <div class="room-icon">${meta.icon}</div>
          <div class="room-id">${rid.toUpperCase()}</div>
          <div class="room-name">${meta.name}</div>
          <div class="room-desc">${ROOM_DESCS[rid] || ''}</div>
          <div class="room-pts">💎 ${meta.points} pts</div>
          ${isLocked ? '<div class="lock-overlay">🔒</div>' : ''}
        `;
```

Change it to:

```js
        card.dataset.roomId = rid;
        card.innerHTML = `
          <div class="room-badge" id="badge-${rid}">⚪</div>
          <div class="room-icon">${meta.icon}</div>
          <div class="room-id">${rid.toUpperCase()}</div>
          <div class="room-name">${meta.name}</div>
          <div class="room-desc">${ROOM_DESCS[rid] || ''}</div>
          <div class="room-pts">💎 ${meta.points} pts</div>
          ${isLocked ? '<div class="lock-overlay">🔒</div>' : ''}
        `;
```

- [ ] **Step 3: Add `updateRoomBadges()` and start polling**

At the end of `frontend/map.html`'s script block, replace:

```js
loadMap();
```

with:

```js
async function updateRoomBadges() {
  try {
    const status = await API.roomsStatus();
    for (const [roomId, info] of Object.entries(status)) {
      const badge = document.getElementById(`badge-${roomId}`);
      if (!badge) continue;
      if (info.state === 'running') {
        badge.textContent = '🟢';
        badge.title = '運行中';
      } else if (info.state === 'starting') {
        badge.textContent = '🟡';
        badge.title = '啟動中';
      } else {
        badge.textContent = '⚪';
        badge.title = '待命中（進入後自動喚醒）';
      }
    }
  } catch (e) {
    // 房間狀態非關鍵資訊，輪詢失敗時靜默忽略
  }
}

loadMap().then(updateRoomBadges);
setInterval(updateRoomBadges, 12000);
```

- [ ] **Step 4: Verify no syntax errors**

Run (from `frontend/`):
```bash
node -c map.html 2>&1 | head -1 || true
```
This will report a parse error pointing at the `<!DOCTYPE` tag (expected, since `node -c` can't parse HTML) — instead, manually verify the `<script>` block is valid JS by extracting and checking it:
```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('map.html', 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1];
new Function(script);
console.log('ok');
"
```
Expected output: `ok`

- [ ] **Step 5: Commit**

```bash
git add frontend/map.html
git commit -m "feat(frontend): show room status badges on the map"
```

---

### Task 16: frontend/play.html + terminal.js — startup loading overlay

**Files:**
- Modify: `frontend/play.html` (CSS near line 45, markup near line 160)
- Modify: `frontend/js/terminal.js`

- [ ] **Step 1: Add overlay CSS**

In `frontend/play.html`, after the `#terminal-container { ... }` rule (lines 41-45), add:

```css
    #terminal-panel {
      position: relative;
      height: 100%;
    }
    .terminal-loading-overlay {
      position: absolute;
      inset: 0;
      background: rgba(13, 17, 23, 0.85);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1rem;
      color: var(--text-dim);
      font-size: 0.9rem;
      z-index: 10;
    }
    .terminal-loading-overlay.hidden {
      display: none;
    }
```

- [ ] **Step 2: Wrap `#terminal-container` in a panel with the overlay**

In `frontend/play.html`, change line 160:

```html
    <div id="terminal-container"></div>
```

to:

```html
    <div id="terminal-panel">
      <div id="terminal-container"></div>
      <div id="terminal-loading-overlay" class="terminal-loading-overlay hidden">
        <div class="spinner"></div>
        <div id="terminal-loading-text">正在啟動房間環境，請稍候（約 5-10 秒）...</div>
      </div>
    </div>
```

- [ ] **Step 3: Add overlay control methods to `EscapeTerminal`**

In `frontend/js/terminal.js`, add two methods after `_onResize()` (after line 106, before `dispose()`):

```js
  _showLoadingOverlay(text) {
    const overlay = document.getElementById('terminal-loading-overlay');
    if (!overlay) return;
    if (text) document.getElementById('terminal-loading-text').textContent = text;
    overlay.classList.remove('hidden');
  }

  _hideLoadingOverlay() {
    const overlay = document.getElementById('terminal-loading-overlay');
    if (overlay) overlay.classList.add('hidden');
  }
```

- [ ] **Step 4: Show the overlay on connect and handle `status`/`ready`/`error` messages**

In `frontend/js/terminal.js`, replace `_connect()` (lines 63-95):

```js
  _connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${proto}://${location.host}/ws?room=${this.roomId}`;

    this.term.writeln('\x1b[33mConnecting to container...\x1b[0m');
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.connected = true;
      this._onResize();
    };

    this.ws.onmessage = (ev) => {
      this.term.write(ev.data);
    };

    this.ws.onclose = () => {
      this.connected = false;
      this.term.writeln('\r\n\x1b[33m[Connection closed. Press any key to reconnect.]\x1b[0m');
      this.term.onKey(() => this._connect());
    };

    this.ws.onerror = () => {
      this.term.writeln('\r\n\x1b[31m[Connection error. Is the container running?]\x1b[0m');
    };

    // Forward keystrokes to server
    this.term.onData((data) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(data);
      }
    });
  }
```

with:

```js
  _connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${proto}://${location.host}/ws?room=${this.roomId}`;

    this.term.writeln('\x1b[33mConnecting to container...\x1b[0m');
    this._showLoadingOverlay('正在啟動房間環境，請稍候（約 5-10 秒）...');
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.connected = true;
      this._onResize();
    };

    this.ws.onmessage = (ev) => {
      let msg = null;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        // 非 JSON：原始終端機輸出
      }

      if (msg && msg.type === 'status' && msg.message === 'starting') {
        this._showLoadingOverlay('正在啟動房間環境，請稍候（約 5-10 秒）...');
        return;
      }
      if (msg && msg.type === 'ready') {
        this._hideLoadingOverlay();
        return;
      }
      if (msg && msg.type === 'error') {
        this._hideLoadingOverlay();
        this.term.writeln(`\r\n\x1b[31m[ERROR] ${msg.message}\x1b[0m\r\n`);
        return;
      }

      this._hideLoadingOverlay();
      this.term.write(ev.data);
    };

    this.ws.onclose = () => {
      this.connected = false;
      this._hideLoadingOverlay();
      this.term.writeln('\r\n\x1b[33m[Connection closed. Press any key to reconnect.]\x1b[0m');
      this.term.onKey(() => this._connect());
    };

    this.ws.onerror = () => {
      this._hideLoadingOverlay();
      this.term.writeln('\r\n\x1b[31m[Connection error. Is the container running?]\x1b[0m');
    };

    // Forward keystrokes to server
    this.term.onData((data) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(data);
      }
    });
  }
```

- [ ] **Step 5: Verify no syntax errors**

Run (from `frontend/`):
```bash
node -c js/terminal.js
```
Expected: no output, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add frontend/play.html frontend/js/terminal.js
git commit -m "feat(frontend): show startup overlay while room-manager ensures the room"
```

---

### Task 17: frontend/admin.html — manual room status & reset

**Files:**
- Modify: `frontend/admin.html`

- [ ] **Step 1: Read the current admin dashboard structure**

Run (from `frontend/`):
```bash
node -e "console.log(require('fs').readFileSync('admin.html','utf8'))" | head -n 140
```
Locate: (a) the `<div id="dashboard" ...>` (or equivalent) container shown after login, and (b) the existing `apiFetch`/`API` usage pattern with the `X-Admin-Token` header, so the new section follows the same conventions for retrieving the stored token and making authenticated calls.

- [ ] **Step 2: Add a "房間管理" section to the dashboard**

Inside the dashboard container (the element shown after a successful admin login), add:

```html
<div class="card" id="room-manager-section">
  <h2>房間管理</h2>
  <table id="room-status-table">
    <thead>
      <tr><th>房間</th><th>狀態</th><th>操作</th></tr>
    </thead>
    <tbody id="room-status-body"></tbody>
  </table>
</div>
```

- [ ] **Step 3: Add the status-loading and reset logic**

In `frontend/admin.html`'s `<script>` block, add (calling it from wherever the dashboard is initialized after login, alongside the existing scoreboard-loading call):

```js
async function loadRoomStatus() {
  const tbody = document.getElementById('room-status-body');
  if (!tbody) return;
  try {
    const status = await apiFetch('/rooms/status');
    tbody.innerHTML = '';
    for (const [roomId, info] of Object.entries(status)) {
      const tr = document.createElement('tr');
      const label = info.state === 'running' ? '🟢 運行中'
        : info.state === 'starting' ? '🟡 啟動中'
        : '⚪ 待命中';
      tr.innerHTML = `
        <td>${roomId}</td>
        <td>${label}</td>
        <td><button data-room-id="${roomId}" class="btn room-reset-btn">重置</button></td>
      `;
      tbody.appendChild(tr);
    }
    tbody.querySelectorAll('.room-reset-btn').forEach((btn) => {
      btn.addEventListener('click', () => resetRoom(btn.dataset.roomId));
    });
  } catch (e) {
    toast(`載入房間狀態失敗：${e.message}`, 'error');
  }
}

async function resetRoom(roomId) {
  if (!confirm(`確定要重置房間 ${roomId}？這會清除玩家在房間內的所有變更。`)) return;
  try {
    await apiFetch(`/rooms/${roomId}/reset`, {
      method: 'POST',
      headers: { 'X-Admin-Token': getAdminToken() },
    });
    toast(`房間 ${roomId} 已重置`, 'success');
    loadRoomStatus();
  } catch (e) {
    toast(`重置失敗：${e.message}`, 'error');
  }
}
```

Call `loadRoomStatus()` (and optionally `setInterval(loadRoomStatus, 15000)`) at the same point the dashboard's other data loaders are invoked after login.

> **Note for the implementer:** `getAdminToken()` and the exact dashboard-init call site depend on `admin.html`'s existing login flow read in Step 1 — reuse whatever helper already retrieves the stored admin token for other authenticated calls (e.g. the scoreboard refresh button), don't introduce a second token-storage mechanism.

- [ ] **Step 4: Verify no syntax errors**

Run (from `frontend/`):
```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('admin.html', 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
for (const s of scripts) new Function(s);
console.log('ok');
"
```
Expected output: `ok`

- [ ] **Step 5: Commit**

```bash
git add frontend/admin.html
git commit -m "feat(admin): add room status table and manual reset"
```

---

### Task 18: Full-stack manual verification

**Files:** none (verification only)

- [ ] **Step 1: Rebuild and start the full stack**

Run (from `escape-docker/`):
```bash
docker compose up -d --build
```
Expected: all 27 services (26 existing + `room-manager`) build and start without errors.

- [ ] **Step 2: Confirm idle rooms get stopped automatically**

Wait ~70 seconds, then run:
```bash
docker compose ps
```
Expected: `room0`–`room11`, `final`, `secret-a`, `secret-b`, `locked-server`, `secret-server` show `Exited`/stopped, while `room-manager`, `nginx`, `terminal-gateway`, `scoreboard-api` remain `Up`.

- [ ] **Step 3: On-demand start via the browser**

Open `http://localhost/play.html?room=room0`. Expected: the loading overlay ("正在啟動房間環境...") appears briefly, then disappears and the terminal connects normally. Run:
```bash
docker compose ps room0
```
Expected: `room0` is now `Up`.

- [ ] **Step 4: Idle stop preserves filesystem state**

In the room0 terminal, run `touch /tmp/idle-test-marker`. Close the browser tab. Set `ROOM_STOP_IDLE_MINUTES=1` in `.env`, run `docker compose up -d room-manager` to apply, and wait >1 minute. Run:
```bash
docker compose ps room0
```
Expected: `room0` is stopped. Reconnect via the browser, then in the terminal run `ls /tmp/idle-test-marker` — expected: file still exists (stop, not recreate).

- [ ] **Step 5: Idle reset restores a clean room**

Set `ROOM_RESET_IDLE_MINUTES=1` in `.env`, `docker compose up -d room-manager`, and wait until the stopped room0 has been idle >1 extra minute. Run:
```bash
docker compose logs room-manager --tail 20
```
Expected: log lines show `room0` (and `locked-server`/`secret-server` if applicable) being recreated then stopped. Reconnect via the browser and run `ls /tmp/idle-test-marker` — expected: `No such file or directory` (clean state restored). Then check the admin panel's FLAG for room0 still matches the FLAG printed inside the freshly-recreated container (`cat` the flag file) — confirms `FLAG_SEED`-based regeneration stayed consistent.

Restore `.env` to `ROOM_STOP_IDLE_MINUTES=10` / `ROOM_RESET_IDLE_MINUTES=60` and `docker compose up -d room-manager` afterwards.

- [ ] **Step 6: Linked containers (room4 ↔ locked-server)**

Open `http://localhost/play.html?room=room4`. Run:
```bash
docker compose ps room4 locked-server
```
Expected: both `Up`. Close the tab and wait past `ROOM_STOP_IDLE_MINUTES`; expected: both `Exited`.

- [ ] **Step 7: map.html badges update live**

Open `http://localhost/map.html`. Expected: rooms currently stopped show ⚪, room0 (opened in Step 3) shows 🟢. Open another room from the map and confirm its badge flips to 🟢 within ~12 seconds.

- [ ] **Step 8: room-manager outage doesn't hang terminal-gateway**

Run:
```bash
docker compose stop room-manager
```
Open `http://localhost/play.html?room=room5` (a currently-stopped room). Expected: within a few seconds the terminal shows `[ERROR] 房間啟動失敗：...` instead of hanging indefinitely. Restart with:
```bash
docker compose start room-manager
```

- [ ] **Step 9: Admin manual reset**

Log into `http://localhost/admin.html`, open the "房間管理" section, click "重置" on a running room, confirm the prompt. Expected: toast confirms reset; `docker compose ps <room>` shows the container was recreated (new container ID via `docker compose ps -a --format json` `CreatedAt`) and is `Up`.

- [ ] **Step 10: Final check — full test suites pass**

Run:
```bash
cd room-manager && npm test && cd ../terminal-gateway && npm test
```
Expected: all automated tests from Tasks 3, 4, 7, 12 PASS.

---

## Self-Review

**Spec coverage** (against `docs/superpowers/specs/2026-06-10-room-manager-design.md`):
- §1 room-manager service + REST API + idle sweeper → Tasks 1-8 ✅
- §2 terminal-gateway integration (ensure/heartbeat/release) → Tasks 12-13 ✅
- §3 docker-compose.yml changes → Task 9 ✅
- §4 nginx routing → Task 11 ✅
- §5.1 play.html/terminal.js loading overlay → Task 16 ✅
- §5.2 map.html badges → Task 15 ✅
- §5.3 admin.html manual controls → Task 17 ✅
- §6 linked containers (room4/locked-server, room9/secret-server) → encoded in `rooms-config.json` (Task 2), exercised by Task 4 sweeper tests and Task 18 Step 6 ✅
- §6 readiness check (`docker exec true` + retry) → `waitUntilReady` (Task 6) ✅
- §6 ensure timeout → 504 path tested in Task 7 ✅
- Verification §1-7 → mapped to Task 18 Steps 1-9 ✅
- Open design question (compose path-mapping for `--force-recreate`) → resolved via dockerode snapshot+recreate, documented in plan header and implemented in Task 6 ✅
- Additional: `/reset` admin-token gating (not explicitly in spec but required because `/api/rooms/` is publicly reachable through nginx) → added to Task 7/9/17 ✅

**Placeholder scan:** no "TBD"/"similar to Task N"/unfilled steps remain; all code blocks are complete.

**Type/signature consistency:** `createStore()` (Task 3) methods (`init/get/getAll/setState/touch/addConnection/removeConnection/isIdleForStop/isIdleForReset`) are used identically in Task 4 (`createSweeper`) and Task 7 (`createApp`). `dockerClient` shape (`startContainer/stopContainer/recreateContainer/waitUntilReady/getContainerStatus`) defined in Tasks 5-6 matches the fakes used in Tasks 4 and 7 and the real usage in Task 8. `rooms-config.json` shape (`{ containers: [...] }`) from Task 2 matches consumption in Tasks 4 and 7.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-10-room-manager-implementation.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
