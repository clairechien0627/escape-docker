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
