const express = require('express');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const MAX_ALERTS = 500;

// 誤報率基準測試（baseline run）的預設靜置時長：reset 房間後不執行任何
// exploit，靜置這段時間收集 Falco 告警，見 POST /api/lab/baseline-runs。
const DEFAULT_BASELINE_DURATION_MS = 20000;

// falco_rule_refs（lab/scenarios/*.json）↔ lab_rules.yaml 規則名稱對照表，
// 對應 falco/README.md 第 2 節。value 為 null 表示該 ref 描述的行為沒有
// 對應的 Falco 規則（語意上無法由 syscall 層級規則偵測，見該文件「說明①②」），
// 計算 rule_coverage 時不計入分母。
const FALCO_RULE_REF_MAP = {
  read_etc_motd: 'Baseline Read Of Motd Or Hint File',
  read_hint_file: 'Baseline Read Of Motd Or Hint File',
  recursive_find_archive: 'Recursive Find Under Archive Directory',
  base64_decode_exec: 'Base64 Decode Executed',
  sudo_exec_backup_script: 'Sudo Exec Of Backup Script',
  secret_file_read_via_root: 'Root Read Of Secret File Via Spawned Process',
  dac_read_search_capability_use: 'DAC Read Search Capability Used',
  signal_to_other_process: 'Signal Sent To Other Process',
  ptrace_attach: 'Ptrace Attach To Other Process',
  proc_read_other_pid: 'Read Proc Cmdline Or Environ Of Other Process',
  ssh_keygen_exec: 'SSH Keygen Executed In Container',
  authorized_keys_modified: 'Authorized Keys Modified',
  ssh_port_forward_established: 'SSH Local Port Forward Established',
  internal_service_access_via_tunnel: 'Loopback Connection To Internal-Only Port 9090',
  local_service_port_scan: 'Local Service Port Scan',
  loopback_connect_nonstandard_port: 'Loopback Connection To Nonstandard Port 7777',
  docker_sock_access: 'Docker Socket Accessed From Container',
  docker_api_container_list: null,
  docker_api_container_inspect: null,
  docker_api_container_start: 'Unexpected Child Process In Container Via Docker Exec',
  docker_build_exec: 'Docker Build Executed In Container',
  docker_sock_write_access: 'Docker Socket Accessed From Container',
  container_create_with_host_mount: 'New Container Created Via Docker CLI',
  docker_compose_exec: 'Docker Compose Executed In Container',
  new_container_created: 'New Container Created Via Docker CLI',
  local_http_request_nonstandard_port: 'Local HTTP Request To Port 8080',
  docker_network_connect_api: 'Docker Network Connect Executed',
  network_interface_added: null,
  internal_network_access: 'Outbound Connection To Secret Network Subnet',
  ssh_bruteforce_pattern: 'Repeated SSH Auth Failures',
  sensitive_endpoint_access: 'Access To Sensitive Export Endpoint',
  sensitive_token_in_log: null,
  tmp_file_written_by_nonroot: 'Non-root Write To Cron Watched File',
  cron_child_process_root: 'Cron Spawned Root Process',
  secret_file_read_by_root_process: 'Root Read Of Secret File Via Spawned Process',
  world_readable_file_written_by_root: 'World Readable File Written By Root Cron Chain',
  docker_sock_exec_api: 'Docker Socket Accessed From Container',
  exec_create_in_other_container: 'Unexpected Child Process In Container Via Docker Exec',
  unexpected_child_process_in_container: 'Unexpected Child Process In Container Via Docker Exec',
  proc_environ_read: 'Read Proc Cmdline Or Environ Of Other Process',
  docker_inspect_api: 'Docker Socket Accessed From Container',
  docker_save_api: 'Docker Save Or History Executed',
  image_layer_extraction: 'Tar Extraction Into Tmp Directory',
  recursive_grep_tmp: 'Recursive Grep Under Tmp',
};

// 目前停用中的規則（falco/rules/lab_rules.yaml 設 enabled: false，見
// falco/README.md「說明②」），對應的 falco_rule_refs 視為不可量測。
const DISABLED_FALCO_RULES = new Set([
  'Repeated SSH Auth Failures',
  'Access To Sensitive Export Endpoint',
]);

// Falco Tier 設定：記錄目前啟用的規則 tier（basic / full）。
// 寫入 data/falco-tier（純文字），同一檔案以唯讀方式 bind-mount 進
// escape-falco 容器（/etc/falco/tier），由 falco/start.sh 在啟動時讀取，
// 決定是否加上 -T tier_full_only。切換後自動 docker restart escape-falco。
const TIER_FILE_PATH = path.join(__dirname, '../data/falco-tier');
function readTierConfig() {
  try {
    const content = fs.readFileSync(TIER_FILE_PATH, 'utf8').trim();
    return content === 'basic' ? 'basic' : 'full';
  } catch { return 'full'; }
}
function writeTierConfig(tier) {
  fs.writeFileSync(TIER_FILE_PATH, tier);
}
function restartFalco() {
  return new Promise((resolve, reject) => {
    exec('docker restart escape-falco', { timeout: 30000 }, (err, _stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message || 'restart failed').trim()));
      else resolve();
    });
  });
}

// 該 scenario 的 falco_rule_refs 中，有對應且已啟用的 Falco 規則名稱清單
// （rule_coverage / false_positive_rate 的分母）。多個 falco_rule_refs
// 可能對應到同一條 Falco 規則（例如 read_etc_motd 與 read_hint_file 都對應
// 'Baseline Read Of Motd Or Hint File'），需去重，否則該規則會在分母中被
// 重複計入，使 rule_coverage/false_positive_rate 失真，
// false_positive_rules 也會出現重複項目。
function measurableFalcoRules(falcoRuleRefs) {
  const ruleNames = (falcoRuleRefs || [])
    .map((ref) => FALCO_RULE_REF_MAP[ref])
    .filter((ruleName) => ruleName && !DISABLED_FALCO_RULES.has(ruleName));
  return [...new Set(ruleNames)];
}

// scenario 物件給「列表」用的精簡版本（省略 exploit_steps/falco_relevant_behaviors 等細節）
function toScenarioSummary(scenario) {
  const { id, title, vuln_type, container, exploit_script, expected_outcome, falco_rule_refs } = scenario;
  return { id, title, vuln_type, container, exploit_script, expected_outcome, falco_rule_refs };
}

// run 物件給「列表」用的精簡版本（省略 steps/stderr 等大型欄位）
function toRunSummary(run) {
  const { id, scenario_id, started_at, finished_at, status, final_privilege, flag_found, duration_ms, exit_code } = run;
  return { id, scenario_id, started_at, finished_at, status, final_privilege, flag_found, duration_ms, exit_code, type: run.type || 'exploit', falco_tier: run.falco_tier || null };
}

// 對外回傳「執行中」run 的精簡狀態（不含 emitter）
function toRunSnapshot(run) {
  const { emitter, ...snapshot } = run;
  return snapshot;
}

function createApp({ scenarios, db, runManager, dockerStats, resourceUsageContainers = [] }) {
  const app = express();
  app.use(express.json());

  const scenarioById = new Map(scenarios.map((s) => [s.id, s]));
  const alerts = [];

  // ── 場景目錄 ──────────────────────────────────────────
  app.get('/api/lab/scenarios', (req, res) => {
    res.json(scenarios.map(toScenarioSummary));
  });

  app.get('/api/lab/scenarios/:id', (req, res) => {
    const scenario = scenarioById.get(req.params.id);
    if (!scenario) return res.status(404).json({ error: 'unknown scenario' });
    res.json(scenario);
  });

  // ── Falco Tier 設定（前端顯示目前 tier、在建立 run 前切換並手動重啟 Falco）──
  app.get('/api/lab/falco-tier', (req, res) => {
    res.json({ tier: readTierConfig() });
  });

  app.post('/api/lab/falco-tier', async (req, res) => {
    const { tier } = req.body || {};
    if (!['basic', 'full'].includes(tier))
      return res.status(400).json({ error: 'tier must be basic or full' });
    writeTierConfig(tier);
    try {
      await restartFalco();
      res.json({ tier, restarted: true });
    } catch (restartErr) {
      res.json({ tier, restarted: false, restart_error: restartErr.message });
    }
  });

  // ── 執行實驗（非同步：立即回傳 run_id，背景跑 reset -> exploit -> reset）──
  // Phase 3：前端可立即用回傳的 id 連線 /api/lab/runs/:id/stream 取得即時進度。
  app.post('/api/lab/runs', (req, res) => {
    const scenarioId = req.body && req.body.scenario_id;
    const scenario = scenarioById.get(scenarioId);
    if (!scenario) return res.status(404).json({ error: 'unknown scenario' });

    const run = runManager.startRun(scenarioId, { falco_tier: readTierConfig() });
    res.status(202).json(toRunSnapshot(run));
  });

  // ── 誤報率基準測試（不執行 exploit，只靜置收集 Falco 告警，RQ2）──
  app.post('/api/lab/baseline-runs', (req, res) => {
    const scenarioId = req.body && req.body.scenario_id;
    const scenario = scenarioById.get(scenarioId);
    if (!scenario) return res.status(404).json({ error: 'unknown scenario' });

    const durationMs = Number(req.body && req.body.duration_ms) || DEFAULT_BASELINE_DURATION_MS;
    const run = runManager.startBaselineRun(scenarioId, durationMs, { falco_tier: readTierConfig() });
    res.status(202).json(toRunSnapshot(run));
  });

  // ── 歷史結果 ──────────────────────────────────────────
  app.get('/api/lab/runs', (req, res) => {
    res.json(db.list({ scenarioId: req.query.scenario_id }).map(toRunSummary));
  });

  // 清除所有歷史執行紀錄（供 analytics.html「清除歷史記錄」使用，例如在
  // Falco 規則或偵測機制有重大修正後，避免舊資料污染 detection-matrix 統計）。
  // 進行中的 run（runManager 記憶體內）不受影響，僅清空已寫入 db 的歷史。
  app.delete('/api/lab/runs', (req, res) => {
    db.clear();
    alerts.length = 0;
    res.status(204).end();
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

  // ── 分析（RQ2：15 場景的偵測率/誤報率彙整，Phase 5/8）──────────
  // 以歷史 runs（db）為基礎，依 scenario 彙整：成功率、flag 取得率、
  // 平均耗時、「偵測率」（該次 run 期間是否收到任一 Falco 告警，
  // run.alerts.length > 0）、「規則覆蓋率」rule_coverage（該 scenario
  // 的 falco_rule_refs 中，有對應且已啟用的規則，曾在任一次 run 中被
  // alert.rule 命中的比例，見 FALCO_RULE_REF_MAP）、「偵測延遲」
  // avg_detection_latency_ms，以及來自 baseline run（type: 'baseline'，
  // POST /api/lab/baseline-runs；不執行 exploit，只靜置收集告警）的
  // 「誤報率」false_positive_rate（measurable 規則中，在無攻擊期間也曾
  // 觸發過的比例）。即使某場景尚無任何 run 也會列出（全為 null/0），
  // 讓前端可以呈現完整的 15 列表格。
  app.get('/api/lab/analytics/detection-matrix', (req, res) => {
    const stats = new Map(scenarios.map((s) => [s.id, {
      scenario_id: s.id,
      title: s.title,
      vuln_type: s.vuln_type,
      falco_rule_refs: s.falco_rule_refs || [],
      measurable: measurableFalcoRules(s.falco_rule_refs || []),
      runs: 0,
      successCount: 0,
      flagCount: 0,
      durationSum: 0,
      durationCount: 0,
      detectedCount: 0,
      triggeredRuleNames: new Set(),
      latencySum: 0,
      latencyCount: 0,
      baselineRuns: 0,
      baselineDurationMs: 0,
      baselineAlertsTotal: 0,
      baselineTriggeredRuleNames: new Set(),
      last_run_at: null,
    }]));

    const tierFilter = req.query.tier || 'all';
    for (const run of db.list()) {
      if (tierFilter !== 'all') {
        const runTier = run.falco_tier || 'full';
        if (runTier !== tierFilter) continue;
      }
      const entry = stats.get(run.scenario_id);
      if (!entry) continue;

      // baseline run（POST /api/lab/baseline-runs）不執行 exploit，只用來
      // 量測「沒有攻擊時」的告警噪音，分開統計，不計入成功率/偵測率等指標。
      if (run.type === 'baseline') {
        entry.baselineRuns += 1;
        if (typeof run.duration_ms === 'number') entry.baselineDurationMs += run.duration_ms;
        if (run.alert_rule_counts && Object.keys(run.alert_rule_counts).length > 0) {
          for (const [ruleName, count] of Object.entries(run.alert_rule_counts)) {
            entry.baselineAlertsTotal += count;
            entry.baselineTriggeredRuleNames.add(ruleName);
          }
        } else if (Array.isArray(run.alerts)) {
          entry.baselineAlertsTotal += run.alerts.length;
          for (const a of run.alerts) {
            const ruleName = a && a.alert && a.alert.rule;
            if (ruleName) entry.baselineTriggeredRuleNames.add(ruleName);
          }
        }
        continue;
      }

      entry.runs += 1;
      if (run.status === 'success') entry.successCount += 1;
      if (run.flag_found) entry.flagCount += 1;
      if (typeof run.duration_ms === 'number') {
        entry.durationSum += run.duration_ms;
        entry.durationCount += 1;
      }
      // alert_rule_counts（不受 run.alerts 上限影響，見 run-manager.js
      // 的 MAX_RUN_ALERTS）優先；舊資料沒有此欄位時，回退用 run.alerts。
      if (run.alert_rule_counts && Object.keys(run.alert_rule_counts).length > 0) {
        entry.detectedCount += 1;
        for (const ruleName of Object.keys(run.alert_rule_counts)) {
          entry.triggeredRuleNames.add(ruleName);
        }
      } else if (Array.isArray(run.alerts) && run.alerts.length > 0) {
        entry.detectedCount += 1;
        for (const a of run.alerts) {
          const ruleName = a && a.alert && a.alert.rule;
          if (ruleName) entry.triggeredRuleNames.add(ruleName);
        }
      }
      // 偵測延遲：該 run 期間第一筆「rule 屬於 measurable」的告警，
      // received_at（lab-api 收到 webhook 的時間）與 started_at
      // （lab-api 發起 run 的時間）都是 lab-api 自己的時鐘，避免
      // Falco container 與 lab-api 之間的時鐘飄移影響量測。
      if (Array.isArray(run.alerts) && entry.measurable.length > 0 && run.started_at) {
        const startedAtMs = Date.parse(run.started_at);
        for (const a of run.alerts) {
          const ruleName = a && a.alert && a.alert.rule;
          if (!ruleName || !entry.measurable.includes(ruleName)) continue;
          const receivedAtMs = Date.parse(a.received_at);
          if (!Number.isNaN(receivedAtMs) && !Number.isNaN(startedAtMs)) {
            entry.latencySum += receivedAtMs - startedAtMs;
            entry.latencyCount += 1;
          }
          break;
        }
      }
      if (!entry.last_run_at || run.finished_at > entry.last_run_at) entry.last_run_at = run.finished_at;
    }

    const matrix = [...stats.values()].map((e) => {
      const measurable = e.measurable;
      const triggeredRules = measurable.filter((ruleName) => e.triggeredRuleNames.has(ruleName));
      const triggeredRulesUnique = [...new Set(triggeredRules)];

      // 誤報候選：在「沒有攻擊」的 baseline run 期間也觸發過的可量測規則。
      const falsePositiveRules = measurable.filter((ruleName) => e.baselineTriggeredRuleNames.has(ruleName));
      const baselineAlertRatePerMin = e.baselineDurationMs > 0
        ? Math.round((e.baselineAlertsTotal / (e.baselineDurationMs / 60000)) * 100) / 100
        : null;

      return {
        scenario_id: e.scenario_id,
        title: e.title,
        vuln_type: e.vuln_type,
        falco_rule_refs: e.falco_rule_refs,
        runs: e.runs,
        success_rate: e.runs ? e.successCount / e.runs : null,
        flag_rate: e.runs ? e.flagCount / e.runs : null,
        avg_duration_ms: e.durationCount ? Math.round(e.durationSum / e.durationCount) : null,
        detection_rate: e.runs ? e.detectedCount / e.runs : null,
        rule_coverage: e.runs && measurable.length ? triggeredRules.length / measurable.length : null,
        triggered_rules: triggeredRulesUnique,
        avg_detection_latency_ms: e.latencyCount ? Math.round(e.latencySum / e.latencyCount) : null,
        baseline_runs: e.baselineRuns,
        baseline_duration_ms: e.baselineDurationMs,
        baseline_alerts_total: e.baselineAlertsTotal,
        baseline_alert_rate_per_min: baselineAlertRatePerMin,
        false_positive_rules: falsePositiveRules,
        false_positive_rate: e.baselineRuns && measurable.length ? falsePositiveRules.length / measurable.length : null,
        last_run_at: e.last_run_at,
      };
    });

    res.json(matrix);
  });

  // ── 資源開銷（RQ3 代理量測：無 Raspberry Pi 時，以 x86 環境量化
  // Falco 規則式偵測的額外資源開銷）──────────────────────────
  // 透過 /var/run/docker.sock + docker-cli（見 lab-api/Dockerfile）取得
  // escape-falco/lab-api/room-manager 等常駐容器的即時 CPU/記憶體用量
  // （docker stats --no-stream）。單台機器上的快照無法直接換算成
  // Raspberry Pi 的實際數字，但 escape-falco 相對其他常駐服務的額外開銷
  // 比例可作為「邊緣裝置上啟用規則式偵測的成本」的代理指標。
  app.get('/api/lab/analytics/resource-usage', async (req, res) => {
    if (!dockerStats) return res.status(501).json({ error: 'docker stats unavailable' });
    try {
      const containers = await dockerStats.statsFor(resourceUsageContainers);
      res.json({ collected_at: new Date().toISOString(), containers });
    } catch (err) {
      res.status(502).json({ error: 'docker stats failed', message: err.message });
    }
  });

  return app;
}

module.exports = { createApp };
