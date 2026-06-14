const { execFile } = require('child_process');

// 把 `docker stats --format '{{json .}}'` 的單行輸出（CPUPerc/MemUsage/...
// 皆為帶單位的字串）轉成分析頁好用的形狀，CPU/記憶體百分比轉成數字。
function normalizeStat(name, raw) {
  const cpu = parseFloat(String(raw.CPUPerc || '').replace('%', ''));
  const mem = parseFloat(String(raw.MemPerc || '').replace('%', ''));
  return {
    name,
    cpu_percent: Number.isNaN(cpu) ? null : cpu,
    mem_usage: raw.MemUsage || null,
    mem_percent: Number.isNaN(mem) ? null : mem,
    net_io: raw.NetIO || null,
    block_io: raw.BlockIO || null,
    pids: raw.PIDs != null ? Number(raw.PIDs) : null,
  };
}

// 透過 lab-api 掛載的 /var/run/docker.sock + docker-cli（見
// lab-api/Dockerfile）取得指定 container 的即時資源用量（RQ3 的 x86 代理
// 量測：「執行 Falco 規則式偵測」相對於 lab-api/room-manager 本身的額外
// 資源開銷）。execImpl 可注入供測試使用。
function createDockerStats({ execImpl = execFile } = {}) {
  function statOne(containerName) {
    return new Promise((resolve) => {
      execImpl('docker', ['stats', '--no-stream', '--format', '{{json .}}', containerName], { timeout: 10000 }, (err, stdout) => {
        if (err) return resolve({ name: containerName, error: 'unavailable' });
        try {
          const line = String(stdout).trim().split('\n')[0];
          resolve(normalizeStat(containerName, JSON.parse(line)));
        } catch (e) {
          resolve({ name: containerName, error: 'parse_error' });
        }
      });
    });
  }

  function statsFor(containerNames) {
    return Promise.all(containerNames.map(statOne));
  }

  return { statsFor };
}

module.exports = { createDockerStats, normalizeStat };
