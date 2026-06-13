# Escape Docker — 下一步優化與擴充規劃

## Context（為什麼要做這份文件）

「Linux 與邊緣運算」期末專案的 Escape Docker 系統目前已經：
- 26 個服務全部可正常 build / 啟動（FLAG mismatch、CRLF/BOM、restart loop 都已修復）
- README 已補上開發者指南
- 12 個主關 + Final Boss + 2 個 Secret Room、提示系統、成就系統、Admin Panel 皆運作正常

接下來的目標是在**功能完整、可demo**的基礎上，找出值得投入的後續工作方向。本文件純粹是**腦力激盪 / 規劃文件**，目的是列出可選項目供你挑選優先順序，**本次不會修改任何程式碼**。

文件依照四個面向整理：
1. **小地方優化**（含「終端機輸出無法複製」）
2. **系統優化**
3. **新增功能**
4. **功能拓展**

每一項都標註預估工作量（🟢小 / 🟡中 / 🔴大）與建議優先序，方便快速篩選。

---

## 1. 小地方優化（Quick Wins）

### 1.1 🟢 終端機文字無法複製

**根因**：`frontend/js/terminal.js` 的 xterm.js 只載入了 `FitAddon`，沒有任何複製相關設定。更關鍵的是：xterm.js 預設會把所有按鍵（包含 `Ctrl+C`）透過 `onData` 轉發給後端 PTY，所以當玩家選取文字後按 `Ctrl+C`，實際上是送出了 **SIGINT 中斷訊號**給容器內的 shell，而不是觸發瀏覽器複製。

**建議修法（擇一或合併）**：
- **最小改動**：在建立 `Terminal` 時加上 `copyOnSelect: true`（xterm.js 內建選項，免裝 addon）。玩家只要用滑鼠選取文字，就會自動寫入剪貼簿，不需要按任何鍵。
- **較完整**：用 `term.attachCustomKeyEventHandler()` 攔截 `Ctrl+C` / `Ctrl+Shift+C`：
  - 如果目前有選取文字（`term.hasSelection()`），就呼叫 `navigator.clipboard.writeText(term.getSelection())` 並 `return false`（阻止送到 PTY）
  - 如果沒有選取文字，維持原行為（送出 SIGINT）
  - 同理可加 `Ctrl+Shift+V` 從剪貼簿貼上 → `navigator.clipboard.readText()` 後用 WS 送給 PTY
- 兩者可以同時做：`copyOnSelect` 解決「選取就複製」，自訂 key handler 解決「想用 Ctrl+C/V 但又不想跟 SIGINT 衝突」的情境。

**影響檔案**：`frontend/js/terminal.js`（`init()` 內 `Terminal` 設定 + 新增 key handler）

---

### 1.2 🟢 FLAG / 重要指令一鍵複製按鈕

右側任務說明 / 提示區塊裡常會出現要玩家輸入的指令範例（例如 `submit_flag "..."`、`docker inspect ...`）。可以在這些 code block 旁加一個小的「📋 複製」按鈕，呼叫 `navigator.clipboard.writeText()`。對教學情境很實用，玩家不用手動選取一長串指令。

**影響檔案**：`frontend/play.html` 或對應的 JS（依目前 render 任務說明的方式而定）

---

### 1.3 🟢 WebSocket 斷線時缺少明顯提示

目前 `terminal.js` 的重連邏輯是 `this.term.onKey(() => this._connect())` —— 玩家斷線後**完全沒有視覺提示**，只能靠按任意鍵才會嘗試重連，而且每次按鍵都會觸發一次 `_connect()`（如果還沒連上，可能短時間內疊加多個重連請求）。

**建議**：
- 斷線時在終端機畫面上方顯示一條「⚠️ 連線中斷，正在重新連線...」的 banner（CSS overlay 即可，不用改架構）
- 重連邏輯加上簡單的 flag（例如 `this._reconnecting`），避免重複建立多個 WebSocket
- 重連成功後自動隱藏 banner

**影響檔案**：`frontend/js/terminal.js`、對應 CSS

---

### 1.4 🟢 終端機缺少「搜尋」與「清除畫面」功能

長時間操作後 scrollback 會很長，找不到之前的輸出。xterm.js 官方有 `xterm-addon-search`（CDN 引入即可），可以加一個搜尋框（Ctrl+F 或一個小圖示）。另外可以加一顆「清除畫面」按鈕（呼叫 `term.clear()`），方便玩家整理畫面截圖交作業。

**影響檔案**：`frontend/play.html`（CDN 引入 addon）、`frontend/js/terminal.js`

---

### 1.5 🟡 字體大小調整 / RWD 適配

目前 xterm.js 字體大小應該是固定值，在小螢幕（筆電/平板）上可能太小或太大導致跑版。可以加上：
- 簡單的 `+`/`-` 字體大小按鈕（呼叫 `term.options.fontSize` 並 `fit()`）
- 確認 `play.html` 在較窄視窗下，終端機與右側說明欄的排版是否會重疊

---

## 2. 系統優化（Infrastructure / Reliability）

### 2.1 🟢 補上 `restart` policy 與 healthcheck

這次 BOM 問題導致一堆 container 進入 restart loop，排查時花了不少時間。`docker-compose.yml` 目前**只有 ghost-alpha/beta/gamma 設定 `restart: "no"`**，其餘服務沒有統一的 restart policy。

建議：
- 為長駐服務（room0-11、final、secret-a/b、scoreboard-api、terminal-gateway、nginx）統一加上 `restart: unless-stopped`，確保 Docker daemon 重啟後遊戲自動恢復
- 為關鍵服務（nginx、scoreboard-api、terminal-gateway）加上 `healthcheck:`，方便 `docker compose ps` 直接看出哪個服務「活著但壞掉了」，而不是只看 Up/Restarting

**影響檔案**：`docker-compose.yml`

---

### 2.2 🟡 加入 FLAG 一致性自動檢查腳本

這次 room0/room1 FLAG 不一致的問題是手動發現的。可以寫一支 `scripts/verify-flags.sh`：
1. 讀取 `.env` 的 `FLAG_SEED`
2. 對每個有 FLAG 的房間，用 `docker exec <room> ...` 取出實際 FLAG（例如讀 motd 或對應檔案）
3. 用同樣公式 `sha256(FLAG_SEED + "-" + roomId)[:16]` 計算期望值
4. 比對並印出 ✅/❌ 清單

可以在每次 `docker compose build` 後手動跑一次，作為 demo 前的健康檢查。未來如果要做 CI 也可以直接套用。

**新增檔案**：`scripts/verify-flags.sh`

---

### 2.3 🟡 Container log 大小限制

26 個服務長時間跑（尤其 demo 當天可能開一整天），預設 `json-file` log driver 沒有限制，可能累積大量磁碟空間。建議在 `docker-compose.yml` 的 service 或 top-level 加上：

```yaml
logging:
  driver: json-file
  options:
    max-size: "10m"
    max-file: "3"
```

可以用 YAML anchor 套用到所有服務，避免重複寫 26 次。

---

### 2.4 🟡 CI：保護 `.gitattributes` 規則 + Shell 腳本檢查

`.gitattributes` 已經設定 `*.sh text eol=lf`，但這只防止「未來 commit 時被轉換」，不會主動檢查既有檔案或新檔案是否符合。可以加一個輕量 GitHub Actions workflow：
- 用 `git diff --check` 或簡單腳本掃描 `.sh` / `Dockerfile` 是否含 CRLF 或 BOM
- 用 `shellcheck` 對所有 `setup.sh` / `entrypoint.sh` 做基本 lint（這次 FLAG 邏輯搬到 entrypoint.sh 後，shellcheck 可以抓到一些潛在問題，例如變數未加引號）

**新增檔案**：`.github/workflows/lint.yml`

---

### 2.5 🔴 docker.sock 掛載風險的緩解（教學情境下可選）

room6/7/9（尤其 7/9 是 read-write）掛載 `docker.sock`，玩家在這些關卡內理論上有能力影響 host 上的其他 container（包含其他玩家正在玩的 room）。在單機 demo 沒問題，但若未來開放給多人同時連線，這是一個需要注意的隔離風險。

選項（只在考慮**多人/對外開放**時才需要）：
- 改用 `docker-socket-proxy`（Tecnative 的輕量 proxy），限制這些 room 只能呼叫白名單 API（例如只允許 `GET /containers/json`，禁止 `POST /containers/.../kill`）
- 或將每位玩家的整組 room 跑在獨立的 Docker-in-Docker 環境中（工作量較大，屬於「功能拓展」等級）

這項目前優先度可以放最後，先記錄起來即可。

---

## 3. 新增功能（New Features）

### 3.1 🟡 通關時間排行榜（活用現有 `room_timings` 表）

scoreboard-api 的資料庫已經有 `room_timings` table，但目前前端排行榜似乎只用總分排名。可以新增一個「最速通關」榜單頁籤：
- 每個房間顯示「最快完成時間 Top 5」
- 呼應成就系統裡的「⚡ Speed Demon」，讓玩家有額外的競爭動機

**影響檔案**：`scoreboard-api/main.py`（新增查詢 endpoint）、`frontend/scoreboard.html`

---

### 3.2 🟡 即時完成通知（WebSocket Push）

呼應 report.md §10「多人競賽模式」的方向，但可以做一個輕量版：
- scoreboard-api 在玩家成功提交 FLAG 後，透過 WebSocket（可重用 terminal-gateway 的 ws server，或新開一個輕量 ws endpoint）廣播一則訊息
- `scoreboard.html` / `map.html` 監聽這個 WS，顯示一個短暫的 toast：「🎉 小明 完成了 Room 5！」

這個功能對「課堂同時有多人在玩」的情境很有教學效果（製造競爭氣氛），且不需要大改架構。

**影響檔案**：`scoreboard-api/main.py`（新增 WS broadcast）、`frontend/js/`（新增小型通知元件）

---

### 3.3 🟢 指令歷史 / 回放紀錄（給老師事後檢視）

呼應 report.md §10「回放功能」。最小可行版本：
- terminal-gateway 在轉發玩家輸入到 docker exec 的同時，把輸入內容（去除控制字元後的指令行）連同 timestamp 寫到 `scoreboard-api` 或一個簡單的 log 檔（例如 `logs/<player>_<room>.log`）
- Admin Panel 增加一個「查看玩家指令紀錄」的頁面/按鈕

對「教師評估學生解題過程」很有價值，且不需要前端大改，主要是 terminal-gateway 端加一個 log writer。

**影響檔案**：`terminal-gateway/index.js` 或 `docker-exec.js`（新增 log 寫入）、`frontend/admin.html`（新增查看介面）

---

### 3.4 🟡 提示使用率 / 排名的比較回饋

可以在玩家完成某房間後顯示：
- 「你使用了 1 個提示，全班平均使用 2.3 個」
- 「你的完成時間排在所有玩家的前 20%」

這類回饋能增加學習動機，且資料庫（`hint_usage`、`room_timings`）已經有足夠資料支撐，主要是新增 API 聚合查詢。

**影響檔案**：`scoreboard-api/main.py`、`frontend/play.html`（完成房間後的彈窗）

---

## 4. 功能拓展（Larger Expansions）

這些屬於「如果還有時間/想繼續發展這個專案」等級的項目，工作量較大，建議放在學期末或之後再評估。

### 4.1 🔴 CTF 多組 FLAG_SEED（多班級隔離）

report.md §10 提到的方向。讓不同班級/小組各自有獨立的 `FLAG_SEED`，彼此 FLAG 不互通。實作上可能需要：
- 每組對應一組獨立的 room containers（資源消耗會以組數倍增，需評估硬體）
- 或者保留單一份 container，但 FLAG 驗證改成「依登入時選擇的組別 + seed」動態計算（不需要每組都跑一份 container，只要 scoreboard-api 依組別算出對應 FLAG 即可比對）— 這個版本工作量小很多，值得優先考慮

### 4.2 🔴 Kubernetes 關卡章節

report.md §10 提到的方向。新增 Pod / Service / ConfigMap 相關的關卡，技術上需要在容器內跑一個輕量 k8s（如 `kind` 或 `k3s`），對資源消耗與架構複雜度影響較大，建議列為「續作」而非本學期目標。

### 4.3 🟡 行動裝置 / RWD 重新設計

目前架構假設玩家用桌機瀏覽器操作 terminal，若要在手機/平板上也能玩（例如展示用），需要：
- 終端機虛擬鍵盤（特殊鍵如 Tab、Ctrl、方向鍵的觸控按鈕列）
- `play.html` 版面在窄螢幕下改為上下排列（終端機 / 任務說明）

### 4.4 🟢 多語言（English）版本

如果未來要對外展示或投稿，提供英文版的 motd / 任務說明 / 前端文字會提升受眾範圍。可以先從 room0 開始，建立 i18n 機制（例如環境變數切換語系的 setup.sh，或前端用 JSON 語言檔）。

---

## 建議優先順序總覽

| 優先序 | 項目 | 工作量 | 理由 |
|--------|------|--------|------|
| 1 | 1.1 終端機複製（`copyOnSelect` + Ctrl+C 攔截） | 🟢 | 主動提出、影響每位玩家的基本體驗 |
| 2 | 2.1 restart policy + healthcheck | 🟢 | 直接呼應這次 restart loop 的踩坑經驗，預防未來重演 |
| 3 | 1.3 斷線提示 banner | 🟢 | 體驗問題，改動小 |
| 4 | 1.2 一鍵複製指令按鈕 | 🟢 | 教學情境實用，改動小 |
| 5 | 2.2 FLAG 一致性檢查腳本 | 🟡 | 預防未來再次踩到 FLAG mismatch |
| 6 | 3.3 指令回放紀錄 | 🟢-🟡 | 老師端很有價值，後端改動集中在 terminal-gateway |
| 7 | 3.1 通關時間排行榜 | 🟡 | 活用既有資料表，視覺效果好，適合 demo |
| 8 | 1.4 搜尋/清除畫面 | 🟡 | 體驗加分，非必要 |
| 9 | 2.3 / 2.4 log 限制與 CI lint | 🟡 | 維運面，非展示重點，但長期有幫助 |
| 之後再說 | 3.2、3.4、第 4 章所有項目 | 🟡-🔴 | 屬於「還有餘裕再做」的擴充方向 |

---

## 驗證方式

本文件不涉及程式碼修改。後續若依此規劃實作，每一項的驗證建議：
- **1.1 / 1.3 / 1.4**：在瀏覽器開啟 `play.html`，實測選取文字 → 複製 → 貼到外部編輯器；模擬斷線（重啟對應 room container）觀察 UI 提示
- **2.1**：`docker compose down && docker compose up -d` 後執行 `docker compose ps` 確認所有服務狀態與 healthcheck 結果
- **2.2**：修改 `.env` 的 `FLAG_SEED` 後執行 `verify-flags.sh`，確認能正確抓出尚未重 build 的房間
- **3.1 / 3.2 / 3.3**：以測試玩家帳號跑完整流程（提交 FLAG → 確認排行榜/通知/紀錄是否正確更新）
