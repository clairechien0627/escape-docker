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
