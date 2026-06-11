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

(async () => {
  for (const [id, room] of Object.entries(roomsConfig)) {
    try {
      const status = await dockerClient.getContainerStatus(room.containers[0]);
      if (status !== 'running') store.setState(id, 'stopped');
    } catch (err) {
      console.error(`[room-manager] failed to check initial status for ${id}: ${err.message}`);
    }
  }
})();

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
