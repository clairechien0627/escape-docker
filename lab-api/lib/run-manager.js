const path = require('path');
const { EventEmitter } = require('events');

// run.alerts（連同最終結果寫入 data/runs.json）的上限。strace ground-truth
// 試驗（step_traced，見 troubleshooting/strace-ground-truth-pilot.md）會讓
// 受追蹤行程觸發大量 Falco「Ptrace Attach To Other Process」等告警
// （單次 run 可達數千筆），若不設上限會讓 data/runs.json 暴增到數 MB。
// 完整的告警規則統計改存在不受此上限影響的 alert_rule_counts。
const MAX_RUN_ALERTS = 200;

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

  function startRun(scenarioId) {
    const scenario = scenarioById.get(scenarioId);
    if (!scenario) return null;

    const id = `${scenarioId}-${Date.now()}`;
    const emitter = new EventEmitter();
    const run = {
      id,
      scenario_id: scenarioId,
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
  function startBaselineRun(scenarioId, durationMs) {
    const scenario = scenarioById.get(scenarioId);
    if (!scenario) return null;

    const id = `baseline-${scenarioId}-${Date.now()}`;
    const emitter = new EventEmitter();
    const run = {
      id,
      scenario_id: scenarioId,
      type: 'baseline',
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
        emitter.emit('error', { type: 'error', error: err.message });
      }
    })();

    return run;
  }

  function get(id) {
    return runs.get(id);
  }

  // 廣播 Falco 告警給目前仍在執行中的 run（starting/running），並記錄到
  // run.alerts（隨最終結果一起寫入 db，供 /api/lab/analytics 使用）。
  // 同一時間通常只有一個實驗在跑，故不做更精細的時間窗關聯
  // （見 troubleshooting/falco-container-context-not-resolved.md 的限制）。
  function notifyAlert(alertRecord) {
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
      }
    }
  }

  return { startRun, startBaselineRun, get, notifyAlert };
}

module.exports = { createRunManager };
