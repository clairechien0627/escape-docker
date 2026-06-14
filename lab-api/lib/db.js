const fs = require('fs');
const path = require('path');

// 以單一 JSON 檔儲存所有實驗結果（runs）。
// 規模不大（15 個場景 x 手動/排程觸發的次數），不需要 SQLite/原生模組，
// 純 JSON 檔在 x86 與 Raspberry Pi（ARM）上都能直接跑。
function createDb(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  function readAll() {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    return raw ? JSON.parse(raw) : [];
  }

  function writeAll(runs) {
    fs.writeFileSync(filePath, JSON.stringify(runs, null, 2));
  }

  function insert(run) {
    const runs = readAll();
    runs.push(run);
    writeAll(runs);
    return run;
  }

  // 由新到舊排序，可選用 scenarioId 篩選
  function list({ scenarioId } = {}) {
    let runs = readAll();
    if (scenarioId) runs = runs.filter((r) => r.scenario_id === scenarioId);
    return runs.slice().reverse();
  }

  function get(id) {
    return readAll().find((r) => r.id === id);
  }

  // 清空所有歷史執行紀錄，供前端「清除歷史記錄」功能使用（例如在重大
  // 修正後重跑實驗、避免舊資料污染 detection-matrix 統計）。
  function clear() {
    writeAll([]);
  }

  return { insert, list, get, clear };
}

module.exports = { createDb };
