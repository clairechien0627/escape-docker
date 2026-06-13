# Lab 控制台（`frontend/lab/`）

Edge Container Security Lab 的前端介面，對應
`docs/edge-container-security-lab-proposal.md` 第 5.4 節（Phase 4）。
透過 `lab-api`（`/api/lab/...`）操作 15 個房間的攻擊腳本實驗，
與 Story Mode（密室逃脫遊戲本體）是獨立的入口，可從 Hub 各頁
導覽列的「🧪 Lab」連結進入。

## `index.html` — 場景選擇與執行歷史

- **場景卡片**：載入 `GET /api/lab/scenarios`，以卡片呈現全部 15 個
  場景，每張卡片顯示：
  - 標題與場景 ID（對應 `lab/scenarios/*.json`）
  - `vuln_type` 標籤（例如 privilege-escalation、docker-socket-exposure）
  - `falco_rule_refs`（該場景預期會觸發的 Falco 規則）
  - `expected_outcome`（預期達到的結果，例如「root shell via sudo
    misconfiguration」）
  - 「▶ 執行」按鈕
- **執行一次實驗**：點擊「▶ 執行」會：
  1. 透過 `window.prompt` 取得 admin token（存於
     `localStorage` 的 `escape_docker_admin_token`，與
     `admin.html` 共用同一套機制）
  2. 呼叫 `POST /api/lab/runs`（帶 `X-Admin-Token`），body 為
     `{ "scenario_id": "<id>" }`
  3. 後端立即回傳 `202` 與 run id，前端跳轉到
     `run.html?id=<run.id>` 即時觀察執行過程
- **執行歷史**：載入 `GET /api/lab/runs`（可用 `?scenario_id=` 篩選），
  以表格列出過去所有執行記錄（場景、狀態、最終權限、是否取得
  flag、耗時等），每筆連到對應的 `run.html?id=...`；每 10 秒自動
  輪詢更新。

## `run.html?id=<run_id>` — 即時執行檢視

開啟後直接以原生 WebSocket 連線
`/api/lab/runs/<run_id>/stream`（Phase 3），不需額外輪詢：

- **連線時**：後端會先「補播」目前已知狀態（`status` +
  已完成的 `steps`）；若該次執行已結束，會緊接著送出 `result`
  並關閉連線——這讓「事後回顧已完成的執行」與「即時觀看正在
  執行的實驗」走同一條路徑
- **左側「執行步驟」**：逐一顯示攻擊腳本回報的每個 step
  （步驟名稱、exit code、耗時、輸出內容），exit code 為 0 顯示
  綠色、非 0 顯示紅色
- **右側「Falco 告警」**：即時顯示執行期間透過
  `/api/lab/falco-webhook` 收到並轉發給這次 run 的告警
  （規則名稱 + output），最新的排最上面
- **執行結果區塊**：執行結束後顯示 `status`（success / failed /
  error / timeout）、`final_privilege`、`flag_found`、
  `duration_ms`
- 若 WebSocket 在收到結果前就斷線，狀態文字會附加
  「（連線已關閉）」提示

## 權限與限制

- **查看**（場景列表、執行歷史、即時檢視）不需登入，任何人皆可瀏覽
- **執行**（`POST /api/lab/runs`）需要 admin token，避免被當作
  公開可濫用的攻擊觸發器；每次執行會對對應房間容器造成實際
  變動（提權、寫檔等），執行前後 lab-api 會呼叫 `room-manager`
  reset 還原房間狀態
- 目前尚未提供 `analytics.html`（Phase 5，偵測率/延遲矩陣等彙整
  分析頁面）與「執行節點（x86 / Raspberry Pi）」選擇，皆為後續
  階段規劃
- 詳細的後端行為（事件種類、流程、已知限制）見 `lab-api/README.md`
