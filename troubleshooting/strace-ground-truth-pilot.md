# Phase B：strace ground-truth 對照試驗（room2 探測失敗、room6 pilot 成功，但 strace 本身會洪水攻擊 Falco）

> **日期：** 2026-06-14

## 緣由

Phase A（[falco-container-context-not-resolved.md](falco-container-context-not-resolved.md)
第 8 節）讓 `rule_coverage` 由 0 變為非零，但 `rule_coverage` 終究只是
「Falco 這一種規則式偵測手段」的單方視角。使用者選擇的 Phase B 方向是
「引入第二種偵測機制做對照」——對照組設計為：在房間容器內用 `strace`
直接觀察 exploit 實際呼叫的 syscalls（execve/openat/connect），作為
不依賴規則、容器外部 eBPF 的「ground truth」，與 Falco 的 `rule_coverage`
對照（RQ2：規則式偵測 vs. 自我可觀測性）。

計畫先在 room2 做最小 probe，確認 `ptrace`（strace 對自身子行程使用的
機制）是否被 `cap_drop: ALL` + Docker 預設 seccomp profile 擋下，再決定
是否擴展到全部 15 個場景。

## 根因 / 實測發現

### 發現 1：room2 probe — ptrace 本身沒被擋，但會讓 `sudo` 的 setuid 提權失效

於 `rooms/room2/Dockerfile` 暫時加裝 `strace` 並重建，實測：

```
docker exec -u player room2 strace -f -e trace=execve -o /tmp/trace.test -- ls /home/player
# 成功，ptrace 沒被 seccomp/cap_drop:ALL 擋下
```

但 room2 的 exploit 核心步驟是 `sudo -l` / `sudo /usr/local/bin/backup.sh ...`：

```
$ docker exec -u player room2 strace -f -e trace=execve,open,openat,connect -o /tmp/trace.sudo -- sudo -l
sudo: effective uid is not 0, is /usr/bin/sudo on a file system with the
'nosuid' option set or an NFS file system without root privileges?
```

對照組（不加 strace）：

```
$ docker exec -u player room2 sudo -l
Matching Defaults entries for player on room2: ...
User player may run the following commands on room2:
    (root) NOPASSWD: /usr/local/bin/backup.sh
```

**根因**：Linux kernel 對「被 ptrace 追蹤中的行程」執行 setuid-root
二進位檔（`/usr/bin/sudo` 有 `S_ISUID` bit）時，會基於
`ptrace_may_access()` 的安全機制**不套用 setuid 效果**，避免 tracer
透過 ptrace 在 exec 瞬間竄改/觀察一個提權後的行程。因此 `sudo` 在
`strace -f` 之下永遠以呼叫者（uid 1000 / player）的權限執行，連
`sudo -l` 讀取 `/etc/sudoers` 都會失敗。

這代表：**用 strace 包裝 exploit 指令，會直接破壞所有依賴 `sudo`/SUID
二進位檔提權的場景本身**——而這正是 room2 的核心漏洞類型。對全 15 個
exploit 腳本 grep `sudo |su -|capsh|pkexec|setcap` 後，僅 room2 使用
`sudo`；其餘場景的提權途徑都不經過 setuid-root 二進位檔（docker.sock
群組成員、capability 濫用、唯讀檔案系統繞過等），理論上不受此限制影響。

**結論**：room2 排除在 strace ground-truth 範圍外（已將
`rooms/room2/Dockerfile` 的暫時改動還原，不安裝 strace）。

### 發現 2：room6 pilot — ground truth 取得成功，但 strace 觸發的 Falco `Ptrace` 規則洪水高達 8857 筆/次執行

改選 room6（docker.sock 場景，提權途徑是 `player` 屬於 `docker` group，
不涉及 setuid）作為 pilot：

- `rooms/room6/Dockerfile` 加裝 `strace`
- `lab/exploits/lib/common.sh` 新增 `step_traced`，把
  `docker logs ghost-alpha` 等指令包成
  `strace -f -e trace=execve,openat,connect -o <tmp> -- <cmd>`，
  取回 trace 後用 `lab/exploits/lib/parse_trace.py` 整理成
  `{"execs":[...],"files":[...],"connects":[...]}`，併入 `step` JSON 的
  `trace` 欄位
- `lab/exploits/room6.sh` 的 4 個 `docker ...` 步驟改用 `step_traced`

實測（`POST /api/lab/runs` → room6）：

- ground truth **成功取得**，例如 `docker logs ghost-alpha`：
  ```json
  {"execs":["/usr/bin/docker"],"files":["/home/player/.docker/config.json"],"connects":["unix:/var/run/docker.sock"]}
  ```
  清楚顯示「對 `/var/run/docker.sock` 建立 unix socket 連線」——與
  Falco 的 `Docker Socket Accessed From Container` 規則描述的行為一致，
  但粒度更細（每個 step 各自一次連線記錄，而 Falco 的 `rule_coverage`
  只是「這條規則在這個場景的所有 run 中是否至少觸發過一次」的二元值）。

- 但是：`strace -f` 對每個被追蹤的 syscall 都會用 `PTRACE_*`
  操作（如 `PTRACE_SYSCALL`/`PTRACE_GETREGS`），這些操作本身會被
  Falco 的 `Ptrace Attach To Other Process`／`PTRACE attached to
  process`／`PTRACE anti-debug attempt` 規則偵測為告警。單次 room6
  run（4 個 `step_traced` 步驟）產生的告警分佈：

  ```json
  {
    "DAC Read Search Capability Used": 23,
    "Packet socket created in container": 2,
    "Terminal shell in container": 1,
    "Unexpected Child Process In Container Via Docker Exec": 2,
    "Docker Socket Accessed From Container": 3,
    "PTRACE attached to process": 2,
    "Ptrace Attach To Other Process": 8857,
    "PTRACE anti-debug attempt": 1
  }
  ```

  `run.alerts`（連同最終結果寫入 `lab-api/data/runs.json`）因此暴增到
  **8891 筆**，把該檔案從原本的數十 KB 撐大到 **6.1 MB**。

**根因**：strace 透過 ptrace 觀察「目標行程的每一個 syscall」，所以追蹤
期間會產生數千次 `PTRACE_*` 呼叫；而 Falco 的 ptrace 相關規則正是針對
「任何對其他行程的 ptrace 操作」設計（用來偵測例如
`gdb`/惡意程式注入），對 strace 這種高頻、合法的自我除錯工具沒有特例。
**這本身就是 RQ2 的一個發現**：「自我可觀測性工具（strace ground
truth）」與「容器外部規則式 IDS（Falco）」並存時，前者會被後者大量
誤判為惡意行為，形成可觀測性與告警噪音的取捨。

## 修復

1. **room2**：還原 `rooms/room2/Dockerfile` 的 strace 安裝（不適用，見
   發現 1）。
2. **room6（pilot）**：
   - `rooms/room6/Dockerfile` 加裝 `strace`
   - `lab/exploits/lib/common.sh` 新增 `step_traced()` 與 `_LIB_DIR`
   - 新增 `lab/exploits/lib/parse_trace.py`（strace 輸出 →
     `{execs,files,connects}` JSON，過濾動態連結器/locale/`/proc`/`/sys`
     等雜訊路徑）
   - `lab/exploits/room6.sh` 的 4 個 `docker ...` 步驟改用 `step_traced`
3. **修正 `run.alerts` 無上限暴增的問題**（由發現 2 觸發、但屬一般性
   修復，任何規則洪水都適用，不限 strace）：
   - `lab-api/lib/run-manager.js`：新增 `MAX_RUN_ALERTS = 200`；
     `notifyAlert()` 改為「`alert_rule_counts`（依規則名稱計數，無上限）
     永遠更新，`run.alerts`（含完整 alert payload）超過上限後不再
     push/emit」；`finished` 物件加上 `alert_rule_counts`
   - `lab-api/lib/app.js`：`/api/lab/analytics/detection-matrix` 改為優先
     用 `run.alert_rule_counts` 計算 `triggeredRuleNames`/`detectedCount`，
     沒有此欄位的舊資料才回退掃 `run.alerts`
   - 一次性修正既存的 `lab-api/data/runs.json` 中
     `room6-1781429849696` 這筆紀錄：把 8891 筆 `alerts` 依規則名稱算出
     `alert_rule_counts` 後，`alerts` 截斷為前 200 筆（檔案從 6.1 MB
     降回 508 KB）
4. **`frontend/lab/run.html`**：`addStep()` 新增 `traceSection()`，若
   `step.trace` 有非空的 `execs`/`files`/`connects`，在該 step 下方用
   `<details>` 顯示「🔬 strace ground truth」清單，與右側即時 Falco
   告警面板並列，作為 Falco vs strace 的雙欄對照畫面。

## 驗證

- `node --test`（`lab-api/`）：**33/33 全綠**（新增 2 個測試：
  `run.alerts` 上限 + `alert_rule_counts` 全量計數、
  `/api/lab/analytics/detection-matrix` 優先採用 `alert_rule_counts`）
- 重建 `room6`、`lab-api` 後，連續兩次 `POST /api/lab/runs`
  （`room6-1781429849696`、`room6-1781430117754`）皆：
  - `status: "success"`、`flag_found` 正確
  - 4 個 `step_traced` 步驟皆回傳非空 `trace`（含
    `"connects":["unix:/var/run/docker.sock"]`）
  - `alerts.length === 200`（上限生效），
    `alert_rule_counts["Ptrace Attach To Other Process"]` 達 7917~8857
  - `/api/lab/analytics/detection-matrix` 的 room6
    `rule_coverage`/`triggered_rules` 不受告警洪水影響，維持
    `1` /
    `["Docker Socket Accessed From Container","Unexpected Child Process In Container Via Docker Exec"]`
- `GET /lab/run.html?id=room6-...` 回傳 200

## 範圍決策：不擴展到其餘 14 個場景

基於發現 1、2，全面把 `step_traced` 套用到 15 個場景的成本/風險不成比例：

- room2（及任何依賴 `sudo`/SUID 提權的未來場景）**結構性不相容**
  ——strace 會直接讓提權步驟失敗，無法同時驗證「exploit 是否成功」與
  「ground truth」
- 即使是相容的場景，每加一個 `step_traced` 步驟就會讓該次 run 的
  Falco 告警量暴增 3-4 個數量級（room6 單一步驟即可達數千筆
  `Ptrace Attach To Other Process`），讓 `rule_coverage`/`detection_rate`
  以外的告警資料幾乎只剩噪音，且持續推高 `data/runs.json` 體積
- 每個房間的 base image/套件管理工具不同，逐一加裝 `strace` 與調整
  exploit 腳本的工程量大，但邊際研究價值（在已有 room6 pilot 的情況下）
  有限

**Phase B 最終交付**：room6 作為 strace ground-truth 的可運作 pilot
（`run.html` 可視覺化雙欄對照），全面擴展列為未來工作；RQ2 的主要數據
仍以 Phase A 的 `rule_coverage`/`triggered_rules`（[falco/README.md](../falco/README.md)
第 4.6 節、[falco-container-context-not-resolved.md](falco-container-context-not-resolved.md)
第 8 節）為主，本文件的發現 1、2 作為「規則式 vs 自我可觀測性」
trade-off 的補充討論。

## 修改檔案清單

| 檔案 | 變更 |
|---|---|
| `rooms/room2/Dockerfile` | probe 用暫時加裝 strace，已還原（無淨變更） |
| `rooms/room6/Dockerfile` | 加裝 `strace`（apt） |
| `lab/exploits/lib/common.sh` | 新增 `_LIB_DIR`、`step_traced()` |
| `lab/exploits/lib/parse_trace.py` | 新增：strace 輸出 → `{execs,files,connects}` JSON |
| `lab/exploits/room6.sh` | 4 個 `docker ...` 步驟改用 `step_traced` |
| `lab-api/lib/run-manager.js` | `MAX_RUN_ALERTS=200`、`alert_rule_counts`、`notifyAlert()` 截斷邏輯 |
| `lab-api/lib/app.js` | `detection-matrix` 優先用 `alert_rule_counts` |
| `lab-api/test/app.test.js` | 新增 2 個測試（告警上限/計數、detection-matrix 採用 `alert_rule_counts`） |
| `lab-api/data/runs.json` | 一次性修正 `room6-1781429849696` 的 `alerts`/`alert_rule_counts`（6.1 MB → 508 KB） |
| `frontend/lab/run.html` | 新增 `traceSection()`，顯示 `step.trace`（strace ground truth）與 Falco 告警並列 |
| `troubleshooting/strace-ground-truth-pilot.md` | 新增（本文件） |
