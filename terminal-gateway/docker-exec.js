const pty = require('node-pty');
const roomConfig = require('./room-config.json');

function getContainerName(roomId) {
  const room = roomConfig.rooms[roomId];
  if (!room) throw new Error(`Unknown room: "${roomId}"`);
  return room.container;
}

function spawnTerminal(roomId) {
  const container = getContainerName(roomId);

  console.log(`[docker-exec] Spawning: docker exec -it -u player ${container} bash`);

  const term = pty.spawn('docker', ['exec', '-it', '-u', 'player', container, 'bash'], {
    name: 'xterm-256color',
    cols: 220,
    rows: 50,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    },
  });

  return term;
}

function resizeTerminal(term, cols, rows) {
  if (term && cols > 0 && rows > 0) {
    term.resize(cols, rows);
  }
}

function killTerminal(term) {
  try {
    term.kill();
  } catch {
    // already dead
  }
}

module.exports = { spawnTerminal, resizeTerminal, killTerminal };
