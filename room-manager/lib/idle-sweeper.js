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
