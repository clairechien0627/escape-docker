const express = require('express');
const path = require('path');

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

function createApp({ scenarios, db, runExploit, roomManagerClient, adminToken, labDir }) {
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

  // ── 執行實驗（room-manager reset -> 跑 exploit script -> reset）──
  app.post('/api/lab/runs', requireAdmin, async (req, res) => {
    const scenarioId = req.body && req.body.scenario_id;
    const scenario = scenarioById.get(scenarioId);
    if (!scenario) return res.status(404).json({ error: 'unknown scenario' });

    const startedAt = new Date().toISOString();

    try {
      await roomManagerClient.reset(scenario.container);
    } catch (err) {
      return res.status(502).json({ error: `room-manager reset failed: ${err.message}` });
    }

    const scriptPath = path.join(labDir, scenario.exploit_script);
    const { exitCode, timedOut, steps, result, stderr } = await runExploit(scriptPath);

    // 跑完後盡力把房間重置回乾淨狀態，供下次實驗使用；失敗不影響本次結果回應
    roomManagerClient.reset(scenario.container).catch((err) => {
      console.error(`[lab-api] post-run reset of ${scenario.container} failed: ${err.message}`);
    });

    const run = {
      id: `${scenarioId}-${Date.now()}`,
      scenario_id: scenarioId,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      exit_code: exitCode,
      timed_out: timedOut,
      status: result ? result.status : (timedOut ? 'timeout' : 'unknown'),
      final_privilege: result ? result.final_privilege : null,
      flag_found: result ? result.flag_found : null,
      duration_ms: result ? result.duration_ms : null,
      steps,
      stderr: stderr || undefined,
    };
    db.insert(run);
    res.status(201).json(run);
  });

  // ── 歷史結果 ──────────────────────────────────────────
  app.get('/api/lab/runs', (req, res) => {
    res.json(db.list({ scenarioId: req.query.scenario_id }).map(toRunSummary));
  });

  app.get('/api/lab/runs/:id', (req, res) => {
    const run = db.get(req.params.id);
    if (!run) return res.status(404).json({ error: 'unknown run' });
    res.json(run);
  });

  // ── Falco webhook（falco.yaml 的 http_output 指向此處）──
  // 目前先記錄在記憶體中供除錯查看；告警 <-> run 的關聯分析待後續階段
  // （見 troubleshooting/falco-container-context-not-resolved.md 的限制）。
  app.post('/api/lab/falco-webhook', (req, res) => {
    alerts.push({ received_at: new Date().toISOString(), alert: req.body });
    if (alerts.length > MAX_ALERTS) alerts.shift();
    res.status(204).end();
  });

  app.get('/api/lab/alerts', (req, res) => {
    res.json(alerts.slice().reverse());
  });

  return app;
}

module.exports = { createApp };
