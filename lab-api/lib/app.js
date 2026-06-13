const express = require('express');

const MAX_ALERTS = 500;

// scenario 物件給「列表」用的精簡版本（省略 exploit_steps/falco_relevant_behaviors 等細節）
function toScenarioSummary(scenario) {
  const { id, title, vuln_type, container, exploit_script, expected_outcome, falco_rule_refs } = scenario;
  return { id, title, vuln_type, container, exploit_script, expected_outcome, falco_rule_refs };
}

// run 物件給「列表」用的精簡版本（省略 steps/stderr 等大型欄位）
function toRunSummary(run) {
  const { id, scenario_id, started_at, finished_at, status, final_privilege, flag_found, duration_ms, exit_code } = run;
  return { id, scenario_id, started_at, finished_at, status, final_privilege, flag_found, duration_ms, exit_code };
}

// 對外回傳「執行中」run 的精簡狀態（不含 emitter）
function toRunSnapshot(run) {
  const { emitter, ...snapshot } = run;
  return snapshot;
}

function createApp({ scenarios, db, adminToken, runManager }) {
  const app = express();
  app.use(express.json());

  const scenarioById = new Map(scenarios.map((s) => [s.id, s]));
  const alerts = [];

  function requireAdmin(req, res, next) {
    if (req.headers['x-admin-token'] !== adminToken) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    next();
  }

  // ── 場景目錄 ──────────────────────────────────────────
  app.get('/api/lab/scenarios', (req, res) => {
    res.json(scenarios.map(toScenarioSummary));
  });

  app.get('/api/lab/scenarios/:id', (req, res) => {
    const scenario = scenarioById.get(req.params.id);
    if (!scenario) return res.status(404).json({ error: 'unknown scenario' });
    res.json(scenario);
  });

  // ── 執行實驗（非同步：立即回傳 run_id，背景跑 reset -> exploit -> reset）──
  // Phase 3：前端可立即用回傳的 id 連線 /api/lab/runs/:id/stream 取得即時進度。
  app.post('/api/lab/runs', requireAdmin, (req, res) => {
    const scenarioId = req.body && req.body.scenario_id;
    const scenario = scenarioById.get(scenarioId);
    if (!scenario) return res.status(404).json({ error: 'unknown scenario' });

    const run = runManager.startRun(scenarioId);
    res.status(202).json(toRunSnapshot(run));
  });

  // ── 歷史結果 ──────────────────────────────────────────
  app.get('/api/lab/runs', (req, res) => {
    res.json(db.list({ scenarioId: req.query.scenario_id }).map(toRunSummary));
  });

  // 進行中的 run 從 runManager 取即時狀態；結束後（live.result 存在）或歷史
  // run 則回傳完整結果記錄（與 db 內容相同的形狀）
  app.get('/api/lab/runs/:id', (req, res) => {
    const live = runManager.get(req.params.id);
    if (live) return res.json(live.result || toRunSnapshot(live));

    const run = db.get(req.params.id);
    if (!run) return res.status(404).json({ error: 'unknown run' });
    res.json(run);
  });

  // ── Falco webhook（falco.yaml 的 http_output 指向此處）──
  // 記錄在記憶體中供除錯查看，並轉發給目前執行中的 run（Phase 3 即時串流）；
  // 告警 <-> run 的時間窗關聯仍有限制（見
  // troubleshooting/falco-container-context-not-resolved.md）。
  app.post('/api/lab/falco-webhook', (req, res) => {
    const record = { received_at: new Date().toISOString(), alert: req.body };
    alerts.push(record);
    if (alerts.length > MAX_ALERTS) alerts.shift();
    runManager.notifyAlert(record);
    res.status(204).end();
  });

  app.get('/api/lab/alerts', (req, res) => {
    res.json(alerts.slice().reverse());
  });

  return app;
}

module.exports = { createApp };
