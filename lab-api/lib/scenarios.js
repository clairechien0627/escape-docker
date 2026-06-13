const fs = require('fs');
const path = require('path');

// room0 ~ room11 -> final -> secret-a -> secret-b（對應 lab/exploits/README.md 的關卡順序）
const ORDER = [
  'room0', 'room1', 'room2', 'room3', 'room4', 'room5', 'room6', 'room7',
  'room8', 'room9', 'room10', 'room11', 'final', 'secret-a', 'secret-b',
];

function orderIndex(id) {
  const idx = ORDER.indexOf(id);
  return idx === -1 ? ORDER.length : idx;
}

// 讀取 <scenariosDir>/*.json，依 ORDER 排序後回傳完整 scenario 物件陣列
function loadScenarios(scenariosDir) {
  const files = fs.readdirSync(scenariosDir).filter((f) => f.endsWith('.json'));
  const scenarios = files.map((f) => JSON.parse(fs.readFileSync(path.join(scenariosDir, f), 'utf8')));
  scenarios.sort((a, b) => orderIndex(a.id) - orderIndex(b.id));
  return scenarios;
}

module.exports = { loadScenarios };
