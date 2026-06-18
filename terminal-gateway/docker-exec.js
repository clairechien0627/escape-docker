const pty = require('node-pty');
const { execFile } = require('child_process');
const roomConfig = require('./room-config.json');

function getContainerName(roomId) {
  const room = roomConfig.rooms[roomId];
  if (!room) throw new Error(`Unknown room: "${roomId}"`);
  return room.container;
}

function spawnTerminal(roomId) {
  const container = getContainerName(roomId);

  console.log(`[docker-exec] Spawning: docker exec -it -u player ${container} bash`);

  const term = pty.spawn('docker', ['exec', '-it', '-u', 'player', container, 'bash', '--login'], {
    name: 'xterm-256color',
    cols: 220,
    rows: 50,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    },
  });

  term._container = container;
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
  if (term._container) {
    // Kill all player processes on pts/1+ (pts/0 is reserved for init/flag_daemon)
    const awk = 'NR>1 && $3=="player" && $2 ~ /pts\\/[^0]/ {print $1}';
    execFile('docker', [
      'exec', term._container, 'bash', '-c',
      `ps -eo pid,tty,user | awk '${awk}' | xargs -r kill -KILL 2>/dev/null; true`,
    ], (err) => {
      if (err) console.log(`[docker-exec] killContainerSession ${term._container}: ${err.message}`);
    });
  }
}

module.exports = { spawnTerminal, resizeTerminal, killTerminal };
