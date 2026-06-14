# Lab 控制台（`frontend/lab/`）

Edge Container Security Lab 的前端介面，對應
`docs/edge-container-security-lab-proposal.md` 第 5.4 節（Phase 4）。
透過 `lab-api`（`/api/lab/...`）操作 15 個房間的攻擊腳本實驗，
與 Story Mode（密室逃脫遊戲本體）是獨立的入口，可從 Hub 各頁
導覽列的「🧪 Lab」連結進入。

## `index.html` — 場景選擇與執行歷史

- **批次操作工具列**：頁面上方提供兩個依序（非並行）對全部 15 個
  場景執行的按鈕：
  - 「▶ 執行全部場景 (15)」：對每個場景呼叫
    `POST /api/lab/runs`，等待該次執行結束（輪詢
    `GET /api/lab/runs/:id` 直到 `status` 離開
    `starting`/`running`）後再執行下一個
  - 「🔬 執行全部 Baseline (15×20s)」：對每個場景呼叫
    `POST /api/lab/baseline-runs`（不執行攻擊，靜置 20 秒收集
    Falco 告警，用於計算誤報率），同樣依序等待完成
  - 兩者都會先 `window.confirm` 提示「全部約需數分鐘、執行期間
    請勿關閉頁面」，執行期間兩個按鈕都會停用，並在工具列顯示
    `(N/15) <scenario_id> 執行中…` 進度文字；全部完成後重新載入
    場景卡片與執行歷史
- **場景卡片**：載入 `GET /api/lab/scenarios`，以卡片呈現全部 15 個
  場景，每張卡片顯示：
  - 標題與場景 ID（對應 `lab/scenarios/*.json`）
  - `vuln_type` 標籤（例如 privilege-escalation、docker-socket-exposure）
  - `falco_rule_refs`（該場景預期會觸發的 Falco 規則）
  - `expected_outcome`（預期達到的結果，例如「root shell via sudo
    misconfiguration」）
  - **「上次結果」摘要**：載入 `GET /api/lab/analytics/detection-matrix`
    後，以小標籤（pill）顯示該場景目前累積的執行次數、Falco 偵測率、
    規則覆蓋率、偵測延遲、誤報率；尚未執行過則顯示「尚未執行過」。
    偵測率/覆蓋率以「越高越綠」、誤報率以「越低越綠」的方式上色
  - 「🔬 Baseline (20s)」與「▶ 執行」按鈕
- **執行一次實驗**：點擊「▶ 執行」會：
  1. 呼叫 `POST /api/lab/runs`，body 為 `{ "scenario_id": "<id>" }`
     （無需登入，任何人都可直接觸發——Lab 本身就是設計給使用者
     自行操作的實驗模擬平台）
  2. 後端立即回傳 `202` 與 run id，前端跳轉到
     `run.html?id=<run.id>` 即時觀察執行過程
- **執行一次 Baseline**：點擊「🔬 Baseline (20s)」會呼叫
  `POST /api/lab/baseline-runs`（同樣跳轉到 `run.html` 觀察），
  不執行攻擊腳本、僅靜置 20 秒收集 Falco 告警，結果計入該場景的
  誤報率統計
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

## `analytics.html` — 偵測率 / 誤報率分析（RQ2 / RQ3）

載入 `GET /api/lab/analytics/detection-matrix`，彙整 15 個場景的歷史
執行結果：

- **摘要卡片**：總執行次數、已執行場景數、平均成功率、平均 Falco
  偵測率、平均規則覆蓋率、**平均誤報率**（僅計入已跑過 Baseline 的
  場景）、**已執行 Baseline 場景數**（`N / 15`）
- **場景矩陣表**：每個場景一列，欄位包含執行次數、成功率、FLAG
  取得率、平均耗時、Falco 偵測率、規則覆蓋率、偵測延遲、
  **誤報率**、最後執行時間
  - 誤報率欄位來自 `false_positive_rate`/`false_positive_rules`/
    `baseline_runs`/`baseline_alert_rate_per_min`，滑鼠移上去可看到
    誤報的規則名稱與告警率；尚未跑過 Baseline 顯示 `—`
- **RQ2 對照散佈圖**：以 Chart.js（CDN）繪製，橫軸為規則覆蓋率
  (%)、縱軸為誤報率 (%)，每個場景一個點，理想場景應落在右下角
  （高覆蓋率、低誤報率）；只有跑過 Baseline 的場景才會出現在圖上，
  全部尚未跑過時顯示提示文字
- **Falco 資源開銷（RQ3 代理量測）**：載入
  `GET /api/lab/analytics/resource-usage`，以 `docker stats` 快照
  顯示各容器的 CPU/記憶體/網路/PIDs，作為「啟用 Falco 規則式偵測」
  相對於常駐服務的額外資源開銷代理指標
- **執行單一場景 / 批次執行 / Baseline 已搬移到 `index.html`**：
  本頁僅提供「🧪 前往 Lab 執行頁」連結與「🗑️ 清除歷史記錄」
  （`DELETE /api/lab/runs`，會清空所有 `detection-matrix` 統計資料）

## 權限與限制

- **查看**（場景列表、執行歷史、即時檢視、分析頁）與**執行**
  （`POST /api/lab/runs`）皆不需登入——Lab 是設計給使用者自行
  操作的實驗模擬平台，任何人都可直接觸發
- 每次執行會對對應房間容器造成實際變動（提權、寫檔等），執行
  前後 lab-api 會呼叫 `room-manager` reset 還原房間狀態
- `analytics.html`（Phase 5，15 場景的成功率/FLAG 取得率/平均
  耗時/Falco 偵測率彙整表）已提供；「執行節點（x86 / Raspberry
  Pi）」選擇仍為後續階段規劃
- 詳細的後端行為（事件種類、流程、已知限制）見 `lab-api/README.md`
