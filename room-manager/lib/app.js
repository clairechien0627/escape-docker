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
          store.removeConnection(id);
          return res.status(504).json({ error: 'room failed to start in time' });
        }
        store.setState(id, 'running');
      }
      res.json({ state: 'running' });
    } catch (err) {
      store.setState(id, 'stopped');
      store.removeConnection(id);
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
