# Edge Container Security Lab
## 邊緣容器環境中的攻擊鏈自動化模擬與輕量偵測機制評估 — 互動實驗平台

> 分支：`research/edge-container-security-lab`（從 `main` 切出）
> 性質：實驗性專題提案／大綱，供課程討論與後續實作對照
> 規模備註：團隊開發、時程充裕 → 採用「自助式即時實驗平台」架構（見第 3 節）

---

## 1. 背景與動機

原有的 Escape Docker 是一個以「密室逃脫」為包裝的容器安全教學遊戲，共 15 個房間，
每個房間都對應一種**真實存在的容器/邊緣裝置錯誤配置**（例如：sudo 提權、
docker.sock 暴露、SUID 二進位、cron job 注入、敏感檔案權限等）。

這個遊戲本身是一個「應用」，而本課程（Linux 與邊緣運算）需要的是
**實驗性專題**：問題 → 實驗設計 → 數據收集 → 分析 → 結論。
因此本提案把現有 15 個房間**重新定位為一組已建置完成、彼此獨立的容器錯誤配置
測試環境（corpus）**，並在其上建立一個**可由使用者透過網頁設定參數、
即時觸發、即時觀察結果**的實驗平台。

換句話說：

- **核心模組（主）**：Edge Container Security Lab —— 使用者在網頁上選擇
  「攻擊場景（房間）」「偵測規則設定（Falco ruleset）」「重複次數」「執行節點
  （x86 / Raspberry Pi）」，按下執行後即時看到攻擊腳本輸出與 Falco 告警，
  並可在分析頁查看所有歷史執行的彙整數據
- **附屬模組（副）**：Story Mode —— 原本的 15 房間密室逃脫遊戲，作為
  「以遊戲方式體驗這些錯誤配置」的補充功能，掛在 Hub 首頁的次要入口

15 個房間 + room-manager（on-demand 容器生命週期管理）已經存在且可運作，
本專題**不需要重做這些環境**，新增的工作集中在「執行引擎 + 偵測 + 視覺化平台」。

---

## 2. 研究問題（Research Questions）

- **RQ1（風險分級）**：15 種常見的容器/邊緣裝置錯誤配置，各自會帶來多大的
  攻擊面與可達權限（容器內 root？docker.sock 存取？host 存取？）？
  哪些配置的風險明顯高於其他配置？

- **RQ2（偵測有效性）**：規則式偵測機制（Falco）對這 15 種攻擊鏈的偵測率、
  偵測延遲、誤報率各是多少？哪些攻擊手法容易被現成規則覆蓋，
  哪些容易漏判？

- **RQ3（邊緣資源成本）**：偵測機制本身在資源受限的邊緣裝置
  （Raspberry Pi，ARM）上會帶來多少額外的 CPU/RAM 負擔？
  與一般 x86 主機相比，偵測延遲與資源開銷是否有顯著差異？
  在邊緣場景下，這個「監控成本」是否可被接受？

平台本身**不是研究問題的答案**，而是讓 RQ1-3 的實驗可以被「重複執行、
即時觀察、自動彙整」的工具——每一次使用者在網頁上按下「執行」，
就是一次可被記錄、分析的實驗樣本。

---

## 3. 系統架構總覽

```
                          ┌─────────────────────────────┐
                          │           瀏覽器              │
                          │  Hub（模組選單）               │
                          │  ├─ Lab：場景選擇/即時執行/分析  │
                          │  └─ Story Mode：15 房間遊戲     │
                          └───────────┬───────────────────┘
                                       │ HTTP / WebSocket
                                       ▼
                          ┌─────────────────────────────┐
                          │           nginx               │
                          └───────┬───────────┬───────────┘
                                   │           │
                     ┌─────────────┘           └─────────────┐
                     ▼                                        ▼
          ┌─────────────────────┐                  ┌──────────────────────┐
          │   lab-api（新）       │                  │ terminal-gateway /     │
          │  實驗執行引擎          │                  │ scoreboard-api（既有） │
          │  - 場景/規則設定 CRUD  │                  │ Story Mode 用          │
          │  - 觸發攻擊腳本執行    │                  └──────────────────────┘
          │  - 串流輸出 + Falco   │
          │    告警（WebSocket）  │
          │  - 寫入實驗結果 DB    │
          └──────┬───────┬───────┘
                 │       │
   docker.sock   │       │ 讀取告警
   (exec/inspect)│       │ (webhook / log tail)
                 ▼       ▼
        ┌────────────┐ ┌────────────┐       ┌──────────────────┐
        │ room0..11   │ │   Falco     │──────►│ falco-alert-relay │
        │ final, secret-*│ (host/容器) │       │（轉發到 lab-api）  │
        │（既有 15 房間）│ └────────────┘       └──────────────────┘
        └────────────┘
                 ▲
                 │ ensure / reset（既有 API）
        ┌────────────┐
        │ room-manager │（既有，重複利用）
        └────────────┘

第二個執行節點（Raspberry Pi）：
        ┌──────────────────────────────────────────┐
        │ Raspberry Pi：同一套 lab-api + Falco + 房間子集 │
        │ 主平台的「執行節點」下拉選單可選擇打到這裡       │
        └──────────────────────────────────────────┘
```

**設計原則**：

1. **不重做既有元件**：room-manager、terminal-gateway、scoreboard-api、
   nginx、15 個房間全部沿用，Lab 是「新增的一層」
2. **lab-api 是新的核心服務**，職責單一：把「使用者在網頁上的一次實驗設定」
   轉換成「對房間容器執行攻擊腳本 + 蒐集 Falco 告警 + 記錄結果」
3. **執行與展示分離**：lab-api 負責執行與資料，前端負責「即時檢視」與
   「歷史分析」兩種視圖，重用 Story Mode 已驗證過的 xterm.js 即時輸出模式
4. **開放執行**：觸發「攻擊腳本」會對房間容器產生實際變動（提權、寫檔等），
   但 Lab 本身的設計目的就是讓使用者自行操作的實驗模擬平台，因此「執行」
   與「查看歷史分析結果」一樣不需登入/權杖；每次執行前後 lab-api 會呼叫
   `room-manager` reset 還原房間狀態

---

## 4. 現有資源（不需重做）

| 資源 | 說明 |
|---|---|
| `rooms/room0` ~ `room11`、`final`、`secret-a`、`secret-b` | 15 個獨立容器，各代表一種錯誤配置，本專題的核心實驗對象 |
| `room-manager/` | on-demand 容器生命週期管理（ensure/stop/reset），Lab 執行前用來確保房間在乾淨狀態 |
| `terminal-gateway/` 的 xterm.js 即時輸出模式 | Story Mode 已驗證的「WebSocket 即時串流終端輸出」實作，Lab 的即時檢視可直接重用同一套前端元件 |
| `scripts/verify-flags.sh` | 既有的「對 15 個房間跑同一套腳本並彙整結果」模式，可作為攻擊腳本框架的參考 |
| `.env` / `FLAG_SEED` | 房間可被安全地重置回乾淨狀態，是 Lab「每次實驗前重置環境」的前提 |
| Raspberry Pi（實體裝置） | 用於 RQ3 的 ARM vs x86 對照實驗，作為第二個 Lab 執行節點 |

---

## 5. 平台元件規劃

### 5.1 攻擊場景定義（Scenario）

每個房間對應一個「場景」設定檔（例如 `lab/scenarios/room02.json`）：

```json
{
  "id": "room02",
  "title": "Sudo 權限濫用提權",
  "vuln_type": "privilege-escalation",
  "container": "room2",
  "exploit_script": "exploits/room02.sh",
  "expected_outcome": "root shell via sudo misconfiguration",
  "falco_rule_refs": ["sudo_unexpected_exec", "sensitive_file_read"]
}
```

`exploits/room02.sh` 沿用「以 `player` shell 為起點」的既有存取方式
（`docker exec -u player room2 bash`），依序執行偵察 → 利用 → 達成目標，
並輸出結構化 JSON（步數、耗時、最終權限/存取範圍）到 stdout 供 lab-api 解析。

### 5.2 lab-api（新服務，Node.js，與 room-manager 同模式）

| 方法 | 路徑 | 用途 |
|---|---|---|
| `GET` | `/api/lab/scenarios` | 列出 15 個場景的中繼資料 |
| `POST` | `/api/lab/runs` | 建立一次實驗：`{ scenario_id, falco_ruleset, repeat, node }`，回傳 `run_id`（需 team token） |
| `GET` | `/api/lab/runs/:id/stream` (WS) | 即時串流：攻擊腳本 stdout + Falco 告警事件 |
| `GET` | `/api/lab/runs` | 歷史執行列表（含 detected / latency / final_privilege） |
| `GET` | `/api/lab/runs/:id` | 單次執行詳情（完整 log + 告警時間軸） |
| `GET` | `/api/lab/analytics/detection-matrix` | RQ2：15 場景 × Falco ruleset 的偵測率/誤報率矩陣 |
| `GET` | `/api/lab/analytics/resource-overhead` | RQ3：房間數 × CPU/RAM（x86 vs Pi） |

**單次執行流程**（lab-api 內部）：

1. 呼叫既有 `room-manager` `ensure` + `reset`，確保目標房間是乾淨、running 狀態
2. 依 `falco_ruleset` 套用對應規則檔（`off` / `basic` / `full`），重載 Falco
3. `docker exec` 執行對應 `exploit_script.sh`，stdout 透過 WebSocket 即時轉發
4. 同時訂閱 Falco 對該 container 的告警（webhook 或 log tail），即時轉發並記錄
   觸發時間，計算「偵測延遲 = 告警時間 - 攻擊步驟時間」
5. 腳本結束後，整理結果（detected、detection_latency、誤報數、最終權限）寫入
   SQLite（沿用 `scoreboard-api/data` 同層的輕量資料庫模式）
6. 再次呼叫 `room-manager` `reset`，恢復房間乾淨狀態供下次實驗

### 5.3 Falco 部署與規則

- Host 層或以特權容器部署 Falco，監控所有 room container
- 規則依「攻擊手法 ↔ 規則 ID」對照表設計，至少涵蓋：
  - 容器內對 `/var/run/docker.sock` 的存取
  - 非預期的 `sudo` / SUID 執行
  - 對 `/secret`、`/etc/shadow` 等敏感檔案的讀取
  - 容器內產生新的 container（`docker run` / `docker exec` 呼叫鏈）
  - cron job 寫入/修改（room11）
- 規則分組為 `off`（不啟用）/ `basic`（基礎規則）/ `full`（全部規則），
  對應 lab-api 的 `falco_ruleset` 參數，供 RQ2 做對照實驗

### 5.4 前端（新增 `frontend/lab/`）

- **`lab/index.html`**：場景選擇（15 張卡片，對應 15 個房間/錯誤配置）+
  執行設定面板（Falco ruleset、重複次數、執行節點 x86/Pi）+「執行」按鈕
- **`lab/run.html?id=<run_id>`**：即時檢視頁，左側為攻擊腳本輸出
  （重用 Story Mode 的 xterm.js 元件），右側為 Falco 告警即時 feed，
  上方顯示進度與目前狀態（執行中/完成/偵測到/未偵測到）
- **`lab/analytics.html`**：
  - RQ1：風險分級表（攻擊面 × 可達權限）
  - RQ2：偵測率/誤報率/延遲矩陣（15 場景 × ruleset），熱力圖呈現
  - RQ3：資源開銷曲線（房間數 × CPU/RAM，x86 vs Pi 切換）
- **Hub 首頁**：Edge Container Security Lab 為主要入口卡片，
  Story Mode（15 房間遊戲）為次要/附屬卡片

### 5.5 Raspberry Pi 節點

- 在 Pi 上部署同一套 lab-api + Falco + 房間子集（選擇資源消耗較小、
  具代表性的數個房間，而非全部 15 個，視 Pi 資源而定）
- 主平台 `lab/index.html` 的「執行節點」選單可選擇打到 Pi 的 lab-api
  （簡單 HTTP 轉發/反向代理），或 Pi 端獨立執行後將結果同步回主資料庫
- `analytics.html` 的圖表均以「節點」分組，直接對照 x86 vs ARM

---

## 6. 階段規劃

| 階段 | 內容 | 對應 RQ | 狀態 |
|---|---|---|---|
| Phase 0 | 場景定義（15 個 scenario JSON）+ 15 支攻擊自動化腳本（結構化輸出） | RQ1 基礎 | ✅ 已完成 |
| Phase 1 | Falco 部署 + 規則設計（攻擊手法 ↔ 規則對照表） | RQ2 基礎 | ✅ 已完成 |
| Phase 2 | lab-api 核心：執行引擎（ensure→reset→套用規則→執行腳本→蒐集告警→寫入結果→reset） | 平台核心 | ✅ 已完成 |
| Phase 3 | 即時串流（WebSocket：攻擊輸出 + Falco 告警），`lab/run.html` 即時檢視 | 平台核心 | ✅ 已完成 |
| Phase 4 | `lab/index.html` 控制台（場景選擇、執行設定、歷史列表） | 平台核心 | ✅ 已完成（基本版） |
| Phase 5 | 對照實驗執行 + `lab/analytics.html`（偵測率/延遲矩陣、誤報率） | RQ2 | ✅ 已完成（基本版） |
| Phase 6 | Raspberry Pi 節點部署 + 資源開銷實驗 + x86/Pi 對照圖表 | RQ3 | 未開始（委派給 Pi 負責的隊員） |
| Phase 7 | Hub 整合（Lab 為主模組、Story Mode 為附屬模組）+ 整合測試 + 報告 | 整合 | 部分完成 |

> Phase 3/4 實作細節：
> - `lab-api` 改為非同步執行模型（`POST /api/lab/runs` 立即回傳 `202`），
>   並透過 `lib/run-manager.js`（EventEmitter）+ `lib/ws-stream.js` 提供
>   `/api/lab/runs/:id/stream`（WebSocket）即時推送 `status`/`step`/
>   `result`/`alert`/`error` 事件，細節見 `lab-api/README.md`
> - `frontend/lab/index.html`：場景卡片 + 「▶ 執行」按鈕（無需登入，
>   `POST /api/lab/runs` 開放任何人觸發）+ 歷史執行列表（輪詢）
> - `frontend/lab/run.html`：即時檢視頁，直接以原生 WebSocket 接上
>   `/api/lab/runs/:id/stream`，左側即時步驟輸出、右側 Falco 告警
>   feed；目前是「JSON 訊息渲染」而非重用 xterm.js 終端元件（攻擊腳本
>   輸出本身是結構化 JSON Lines，不是互動式 shell session，渲染為
>   結構化步驟卡片更適合）
> - 已加入 Hub 各頁（`map.html`/`scoreboard.html`/`achievements.html`）
>   的導覽列連結
>
> Phase 5/7 實作細節：
> - 後端新增 `GET /api/lab/analytics/detection-matrix`：依場景彙整
>   `data/runs.json` 的歷史執行記錄（執行次數、成功率、FLAG 取得率、
>   平均耗時、Falco 偵測率、規則覆蓋率 `rule_coverage`），即使尚無任何
>   run 的場景也會列出（供前端呈現完整 15 列）。`run-manager.js` 同步
>   新增 `run.alerts`：每次 run 在背景執行期間收到的 Falco 告警會記錄
>   下來並隨最終結果寫入 db，作為「偵測率」與「規則覆蓋率」的資料來源
> - `frontend/lab/analytics.html`：15 場景的彙整表格（含成功率/FLAG
>   取得率/平均耗時/Falco 偵測率/規則覆蓋率的長條視覺化）
> - **2026-06-14 更新**：`escape-falco` 已從「僅供參考的
>   `docker-compose.falco.example.yml`」正式合併進主 `docker-compose.yml`
>   常駐運行。實測顯示，先前記錄為「container context 解析不到、規則
>   不會觸發」的案例（`Docker Socket Accessed From Container`、
>   `Unexpected Child Process In Container Via Docker Exec`、
>   `Docker Save Or History Executed` 等）在 Falco 常駐 + room-manager
>   reset 重建 container 後已能正確觸發，detection_rate/rule_coverage
>   由全 0 變為非零，使 RQ2 的偵測率數據真正有意義；詳見
>   `troubleshooting/falco-container-context-not-resolved.md` 第 8 節與
>   `falco/README.md` 第 4.6 節。殘留限制（`container.name` 仍為
>   `null`、`run.alerts` 以時間窗口而非 container 關聯）見上述文件
> - Phase 7（部分）：`frontend/index.html` 首頁新增「🧪 Security Lab」
>   CTA 按鈕與簡短的 Lab 模組介紹區塊，作為 Story Mode 之外的第二入口；
>   尚未進行「Lab 為主模組」的完整版面重排與整合測試/報告
> - **2026-06-14 新增（RQ2 第二種偵測機制對照，pilot）**：在 `room6`
>   試行 `step_traced`——以 `strace -f` 包裝 exploit 指令，取得
>   `execve`/`openat`/`connect` 的 ground truth（不依賴規則），併入
>   `step` JSON 的 `trace` 欄位並於 `run.html` 與 Falco 告警並列顯示。
>   過程中發現兩個重要限制：① `room2` 的 `sudo` 提權在 `strace -f` 下
>   因 kernel 的 ptrace/setuid 安全機制失效，結構性不適用；
>   ② `strace` 自身的 ptrace 操作會讓 Falco 觸發數千筆
>   `Ptrace Attach To Other Process` 告警（單次 run 達 8857 筆），需以
>   `alert_rule_counts` + `MAX_RUN_ALERTS` 上限避免 `data/runs.json`
>   暴增。15 場景全面推廣列為未來工作，詳見
>   `troubleshooting/strace-ground-truth-pilot.md`

---

## 7. 團隊分工建議（依架構天然切分）

> 以下為建議分工，實際依團隊人數/興趣調整；各區塊之間以 lab-api 的
> REST/WebSocket 介面與 scenario JSON 格式作為介接點，可平行開發。

| 分工 | 內容 | 主要產出 |
|---|---|---|
| **攻擊腳本組** | 15 支 `exploits/*.sh` + scenario JSON 定義，需熟悉每個房間的錯誤配置細節 | `lab/exploits/`, `lab/scenarios/` |
| **偵測/後端組** | Falco 規則設計 + lab-api 執行引擎、WebSocket 串流、資料庫 | `falco/rules/`, `lab-api/` |
| **前端/視覺化組** | 場景選擇頁、即時檢視頁（重用 xterm.js）、分析儀表板（圖表） | `frontend/lab/` |
| **邊緣/Pi 組** | Raspberry Pi 部署、資源監控腳本、x86 vs ARM 對照實驗 | `lab/pi-deploy/`, 資源開銷數據 |
| **整合/Hub 組** | Hub 模組整合、Story Mode 接入、demo 腳本、報告整合 | Hub 路由、最終報告 |

---

## 8. 預期產出

1. `lab/scenarios/`：15 個場景定義（JSON）
2. `lab/exploits/`：15 支攻擊自動化腳本 + 結構化結果輸出
3. `falco/rules/`：Falco 設定與自訂規則（off/basic/full 三組）
4. `lab-api/`：實驗執行引擎服務（REST + WebSocket）
5. `frontend/lab/`：場景選擇、即時檢視、分析儀表板三頁
6. `lab/pi-deploy/`：Raspberry Pi 部署設定與資源監測腳本
7. 實驗資料庫（SQLite）：所有歷史執行記錄，供分析頁與報告引用
8. 最終報告：整合 RQ1-RQ3 的結論，並展示平台作為「可重複實驗工具」的價值

---

## 9. 待確認事項

- [ ] 15 個房間與其錯誤配置的對應清單需要重新盤點確認（哪些房間適合自動化、
      哪些需要額外調整才能無人值守執行）
- [ ] Falco 在 Docker（非 Kubernetes）環境下的部署方式需先驗證
      （kernel module / eBPF probe 在開發機與 Raspberry Pi 上的相容性）
- [ ] Raspberry Pi 的作業系統與 Docker 版本需確認是否支援 Falco 的 eBPF driver
- [ ] Lab「執行」動作的存取控制機制（team token vs 開放執行）需與團隊討論——
      是否所有人都能觸發攻擊腳本，或僅限部分角色，避免資源被無限制佔用
- [ ] 團隊人數與分工方式（第 7 節為建議，需依實際人數調整）
- [ ] Raspberry Pi 上要部署全部 15 個房間還是子集，視 Pi 的儲存/記憶體資源決定

---

## 10. 進階擴充選項（時間允許時再做，非核心交付）

第 3-8 節做完即是一個完整、可展示的成果；以下是有餘力時可以疊加的擴充方向，
依複雜度排序，彼此獨立、不影響核心平台的完整性。

### 10.1 多階段橫向移動攻擊鏈（跨房間）— 複雜度：中

- 現有網路拓撲已將部分房間分組在同一個 network（例如 room4 + locked-server
  在 `ssh_net`；room6/7/9/final + secret-server/ghost-* 在 `docker_net`），
  「從一個房間跳到另一個房間」在現有環境下本來就可行，不需重建拓樸
- 平台端需要：
  - lab-api 的「執行」單位從「單一 scenario」擴展成「chain（多個 scenario
    依序執行，並共享 context，例如第一階段取得的憑證/token 帶到下一階段）」
  - Falco 告警需要能依「chain run id」跨容器關聯，而不是只看單一容器
  - `lab/run.html` 顯示「目前在 chain 的第幾階段、跳到哪個容器」
- 結論：主要是 lab-api 的資料模型多一層（chain 包 scenario），並設計
  2-3 條跨房間攻擊路徑（例如 room6 → `docker_net` → secret-server，
  或 room4 → locked-server），不算特別麻煩

### 10.2 規則式 vs 學習式偵測比較 + 自動防禦回應 — 複雜度：中高

- 在 Falco 之外加一個輕量異常偵測模型（例如基於 syscall 計數的簡單統計
  模型/小型分類器），與 Falco 並列比較偵測率/誤報率，RQ2 從
  「Falco 有沒有偵測到」延伸為「規則式 vs 學習式，誰偵測率高、誰誤報少」
- 偵測到攻擊後，lab-api 呼叫 room-manager 自動隔離/reset 該房間，
  形成「偵測 → 自動回應」的防禦迴路
- 主要工作量在資料蒐集（需要大量正常 vs 攻擊的 syscall trace 作為
  訓練/評估資料）與模型評估；平台架構只需多一個偵測引擎介面

### 10.3 多 Pi 節點的邊緣叢集排程 — 複雜度：中

- 把 RQ3 的「1 台 Pi vs x86」擴展成「多台 Pi 組成的小型 edge cluster」，
  lab-api 依節點負載/可用資源動態分配實驗執行位置，呼應「邊緣運算」課程的
  資源排程主題
- 需要額外硬體（多台 Pi）；若團隊只有 1 台 Pi，此項不適用

### 10.4 攻擊腳本變異測試（偵測穩健性）— 複雜度：低

- 對每個攻擊腳本做小幅度的「手法變異」（例如改變指令順序、加入無害的
  干擾指令），測試 Falco 規則對「同一漏洞、不同攻擊手法」的偵測穩健性，
  補強 RQ2 的結論深度
- 工作量小，主要是多寫幾個變異版腳本
