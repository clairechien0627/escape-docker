const { spawn } = require('child_process');
const readline = require('readline');

// 執行 lab/exploits/<id>.sh，逐行解析其 JSON Lines 輸出
// （{"type":"step",...} / {"type":"result",...}，見 lab/exploits/lib/common.sh）。
// onStep/onResult：每解析到一行就立即呼叫，供 Phase 3 即時串流使用；
// steps/result 仍會在 resolve 時整批回傳，供既有同步流程使用。
function runExploitScript(scriptPath, { timeoutMs = 120000, onStep, onResult } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [scriptPath]);

    const steps = [];
    let result = null;
    let stderr = '';
    let timedOut = false;

    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let parsed;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        return; // 忽略非 JSON 的雜訊輸出
      }
      if (parsed.type === 'step') {
        steps.push(parsed);
        if (onStep) onStep(parsed);
      } else if (parsed.type === 'result') {
        result = parsed;
        if (onResult) onResult(parsed);
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, timedOut, steps, result, stderr });
    });
  });
}

module.exports = { runExploitScript };
