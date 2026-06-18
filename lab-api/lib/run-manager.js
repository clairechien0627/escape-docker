const path = require('path');
const { EventEmitter } = require('events');

// run.alerts（連同最終結果寫入 data/runs.json）的上限。strace ground-truth
// 試驗（step_traced，見 troubleshooting/strace-ground-truth-pilot.md）會讓
// 受追蹤行程觸發大量 Falco「Ptrace Attach To Other Process」等告警
// （單次 run 可達數千筆），若不設上限會讓 data/runs.json 暴增到數 MB。
// 完整的告警規則統計改存在不受此上限影響的 alert_rule_counts。
const MAX_RUN_ALERTS = 200;

// Falco webhook 送達時間可能比事件實際發生晚數分鐘（Docker Desktop/WSL2
// 的 modern_ebpf 已知行為）。alert.time 是 Falco 記錄的事件發生時間，
// 用它比對 run 的 [started_at, finished_at] 時間窗，可回溯關聯已完成的
// run。ALERT_RETROACTIVE_BUFFER_MS 提供少量緩衝，容許容器間時鐘微偏移。
const ALERT_RETROACTIVE_BUFFER_MS = 10 * 1000;

function parseAlertTimeMs(alert) {
  if (!alert || !alert.time) return null;
  const ms = Date.parse(alert.time);
  return Number.isNaN(ms) ? null : ms;
}

// 管理「執行中」的實驗（Phase 3：即時串流）。
//
// startRun() 立刻回傳一筆 run 記錄並在背景非同步執行
// room-manager reset -> exploit script -> room-manager reset，
// 過程中透過 run.emitter 廣播 status/step/result/error 事件，
// 供 lib/ws-stream.js 轉發給已連線的前端。
//
// 執行完成後，最終結果會寫入 db（與既有 GET /api/lab/runs 歷史紀錄相容），
// 但執行中的 run 只存在記憶體（runs Map），重啟 lab-api 會遺失「進行中」狀態
// ——可接受，因為 exploit script 本身也會隨容器一起中斷。
function createRunManager({ scenarioById, db, runExploit, roomManagerClient, labDir }) {
  const runs = new Map();

  function startRun(scenarioId, extraFields = {}) {
    const scenario = scenarioById.get(scenarioId);
    if (!scenario) return null;

    const id = `${scenarioId}-${Date.now()}`;
    const emitter = new EventEmitter();
    const run = {
      id,
      scenario_id: scenarioId,
      ...extraFields,
      status: 'starting',
      started_at: new Date().toISOString(),
      finished_at: null,
      steps: [],
      alerts: [],
      alert_rule_counts: {},
      result: null,
      error: null,
      emitter,
    };
    runs.set(id, run);

    (async () => {
      try {
        await roomManagerClient.reset(scenario.container);

        run.status = 'running';
        emitter.emit('status', { type: 'status', status: 'running' });

        const scriptPath = path.join(labDir, scenario.exploit_script);
        const { exitCode, timedOut, result, stderr } = await runExploit(scriptPath, {
          onStep: (step) => {
            run.steps.push(step);
            emitter.emit('step', step);
          },
        });

        // 跑完後盡力把房間重置回乾淨狀態，供下次實驗使用；失敗不影響本次結果
        roomManagerClient.reset(scenario.container).catch((err) => {
          console.error(`[lab-api] post-run reset of ${scenario.container} failed: ${err.message}`);
        });

        const finished = {
          id,
          scenario_id: scenarioId,
          ...extraFields,
          started_at: run.started_at,
          finished_at: new Date().toISOString(),
          exit_code: exitCode,
          timed_out: timedOut,
          status: result ? result.status : (timedOut ? 'timeout' : 'unknown'),
          final_privilege: result ? result.final_privilege : null,
          flag_found: result ? result.flag_found : null,
          duration_ms: result ? result.duration_ms : null,
          steps: run.steps,
          alerts: run.alerts,
          alert_rule_counts: run.alert_rule_counts,
          stderr: stderr || undefined,
        };

        run.status = finished.status;
        run.finished_at = finished.finished_at;
        run.result = finished;

        db.insert(finished);
        emitter.emit('result', { type: 'result', ...finished });
      } catch (err) {
        run.status = 'error';
        run.finished_at = new Date().toISOString();
        run.error = err.message;
        db.insert({
          id,
          scenario_id: scenarioId,
          ...extraFields,
          started_at: run.started_at,
          finished_at: run.finished_at,
          status: 'error',
          error: err.message,
          steps: run.steps,
          alerts: run.alerts,
          alert_rule_counts: run.alert_rule_counts,
        });
        emitter.emit('error', { type: 'error', error: err.message });
      }
    })();

    return run;
  }

  // 「誤報率」基準測試（RQ2）：不執行任何 exploit，只 reset 房間後靜置
  // durationMs，記錄這段時間內收到的 Falco 告警。與 startRun 共用
  // notifyAlert 機制（同樣依賴 run.status 為 'starting'/'running'）；
  // 寫入 db 的記錄帶 type: 'baseline'，detection-matrix 會將其與一般
  // 執行記錄分開統計，用來判斷哪些規則在「沒有攻擊」時也會觸發
  // （誤報候選）。
  function startBaselineRun(scenarioId, durationMs, extraFields = {}) {
    const scenario = scenarioById.get(scenarioId);
    if (!scenario) return null;

    const id = `baseline-${scenarioId}-${Date.now()}`;
    const emitter = new EventEmitter();
    const run = {
      id,
      scenario_id: scenarioId,
      type: 'baseline',
      ...extraFields,
      status: 'starting',
      started_at: new Date().toISOString(),
      finished_at: null,
      steps: [],
      alerts: [],
      alert_rule_counts: {},
      result: null,
      error: null,
      emitter,
    };
    runs.set(id, run);

    (async () => {
      try {
        await roomManagerClient.reset(scenario.container);

        run.status = 'running';
        emitter.emit('status', { type: 'status', status: 'running' });

        await new Promise((resolve) => setTimeout(resolve, durationMs));

        // 跑完後盡力把房間重置回乾淨狀態，供下次實驗使用；失敗不影響本次結果
        roomManagerClient.reset(scenario.container).catch((err) => {
          console.error(`[lab-api] post-baseline reset of ${scenario.container} failed: ${err.message}`);
        });

        const finished = {
          id,
          scenario_id: scenarioId,
          type: 'baseline',
          ...extraFields,
          started_at: run.started_at,
          finished_at: new Date().toISOString(),
          status: 'completed',
          duration_ms: durationMs,
          alerts: run.alerts,
          alert_rule_counts: run.alert_rule_counts,
        };

        run.status = finished.status;
        run.finished_at = finished.finished_at;
        run.result = finished;

        db.insert(finished);
        emitter.emit('result', { type: 'result', ...finished });
      } catch (err) {
        run.status = 'error';
        run.finished_at = new Date().toISOString();
        run.error = err.message;
        db.insert({
          id,
          scenario_id: scenarioId,
          type: 'baseline',
          ...extraFields,
          started_at: run.started_at,
          finished_at: run.finished_at,
          status: 'error',
          error: err.message,
          steps: run.steps,
          alerts: run.alerts,
          alert_rule_counts: run.alert_rule_counts,
        });
        emitter.emit('error', { type: 'error', error: err.message });
      }
    })();

    return run;
  }

  function get(id) {
    return runs.get(id);
  }

  // 廣播 Falco 告警給執行中的 run（starting/running），或回溯補寫至
  // 已完成的 run（alert.time 落在其 [started_at, finished_at] 時間窗內）。
  //
  // 回溯邏輯解決 Falco webhook 延遲問題：exploit 腳本通常在數秒內跑完，
  // 但 Falco 在 Docker Desktop/WSL2 的 modern_ebpf 模式下 webhook 最晚可
  // 延遲數分鐘送達。用 alert.time（事件實際發生時刻）比對時間窗，可讓
  // 晚到的告警仍正確關聯到對的 run，並同步更新 db 記錄。
  //
  // runs Map 在 lab-api 存活期間不清除，故可查到本次 session 所有已完成的
  // run；重啟 lab-api 後記憶體清空，之後送到的 webhook 便無法回溯。
  function notifyAlert(alertRecord) {
    const alertTimeMs = parseAlertTimeMs(alertRecord.alert);

    for (const run of runs.values()) {
      if (run.status === 'starting' || run.status === 'running') {
        const ruleName = alertRecord.alert && alertRecord.alert.rule;
        if (ruleName) {
          run.alert_rule_counts[ruleName] = (run.alert_rule_counts[ruleName] || 0) + 1;
        }
        if (run.alerts.length < MAX_RUN_ALERTS) {
          run.alerts.push(alertRecord);
          run.emitter.emit('alert', { type: 'alert', ...alertRecord });
        }
      } else if (run.result && alertTimeMs !== null) {
        const startMs = Date.parse(run.started_at);
        const endMs = Date.parse(run.finished_at);
        if (Number.isNaN(startMs) || Number.isNaN(endMs)) continue;
        if (alertTimeMs < startMs || alertTimeMs > endMs + ALERT_RETROACTIVE_BUFFER_MS) continue;

        const ruleName = alertRecord.alert && alertRecord.alert.rule;
        if (ruleName) {
          run.alert_rule_counts[ruleName] = (run.alert_rule_counts[ruleName] || 0) + 1;
        }
        if (run.alerts.length < MAX_RUN_ALERTS) {
          run.alerts.push(alertRecord);
        }
        // run.alerts / run.alert_rule_counts 與 run.result 共用同一物件參照，
        // 記憶體端已自動更新；db 的持久化記錄需另外 patch。
        db.patch(run.id, {
          alerts: run.alerts,
          alert_rule_counts: run.alert_rule_counts,
        });
      }
    }
  }

  return { startRun, startBaselineRun, get, notifyAlert };
}

module.exports = { createRunManager };
