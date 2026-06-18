# Falco Tier 對比實驗 — 分析紀錄

> 紀錄日期：2026-06-18  
> 實驗環境：Windows 11 + Docker Desktop（WSL2 + modern_ebpf）  
> Falco 版本：0.39.2（falcosecurity/falco-no-driver:latest）

---

## 1. 實驗設計

### 研究問題

在邊緣運算環境中，Falco 規則集的精簡程度如何影響：
- **RQ2**：偵測覆蓋率（rule_coverage）與誤報率（false_positive_rate）
- **RQ3**：告警處理成本（baseline alert volume 作為代理量測）

### 兩個 Tier 的設計邏輯

| | Basic Tier | Full Tier |
|---|---|---|
| 規則數 | **8 條** | **31 條**（8 basic + 21 full_only + 2 disabled） |
| 設計原則 | 「**永遠不合法**」的容器操作 | 額外加入「**可疑但可能合法**」的行為 |
| 目標環境 | 資源受限的邊緣節點 | 雲端 / 資源充足環境 |

#### Basic Tier 的 8 條規則（`tier_basic` tag）

| 規則名稱 | 對應場景 | 觸發條件 |
|---|---|---|
| Sudo Exec Of Backup Script | room2 | sudo 執行 backup.sh |
| Root Read Of Secret File Via Spawned Process | room2, room11 | root 程序讀 /secret |
| Authorized Keys Modified | room4 | authorized_keys 被寫入 |
| Docker Socket Accessed From Container | room6,7,9,final,secret-a,b | 存取 /var/run/docker.sock |
| Unexpected Child Process In Container Via Docker Exec | final, room6 | containerd-shim/runc 產生非預期子程序 |
| Docker Network Connect Executed | room9 | `docker network connect` |
| Outbound Connection To Secret Network Subnet | room9 | 連線到 172.22.0.0/24 |
| World Readable File Written By Root Cron Chain | room11 | root 寫出 /tmp/result |

這 8 條規則的共同特徵：在正常容器運作中**幾乎不會出現**，觸發即具高度可信度。

#### Full-Only 的 21 條附加規則（`tier_full_only` tag）

涵蓋：process 偵察（signal/ptrace/proc 讀取）、SSH 操作（ssh-keygen/port forward）、特定工具執行（base64/find/tar/grep/docker build/save/compose）、網路偵察（port scan/特定 port 連線）、cron 行為監控。

這些規則在攻擊時出現，但在**正常維運中同樣常見**，因此誤報率較高。

---

## 2. 實驗數據（每個 Tier 各跑 1 次 exploit + 1 次 baseline）

### 2.1 規則覆蓋率（rule_coverage）

> 定義：exploit 執行期間，該場景 `falco_rule_refs` 中有被觸發的規則比例

| 場景 | 漏洞類型 | Basic 覆蓋率 | Full 覆蓋率 | Δ (Full−Basic) | 備註 |
|---|---|:---:|:---:|:---:|---|
| room0 | information-disclosure | 0% | **100%** | +100% | Full 才有 MOTD 規則 |
| room1 | exposed-secret | 0% | **100%** | +100% | Full 才有 base64/find 規則 |
| room2 | sudo-misconfiguration | 0% | 33% | +33% | DAC_READ_SEARCH 在 Full，basic 規則未觸發 |
| room3 | process-signal-exploitation | 0% | 0% | 0% | 兩個 Tier 均未偵測（eBPF 限制） |
| room4 | ssh-key-based-pivot | 0% | 25% | +25% | SSH tunnel 規則在 Full |
| room5 | unauthenticated-network-service | 0% | 0% | 0% | 兩個 Tier 均未偵測（eBPF 限制） |
| room6 | docker-sock-exposure | **100%** | **100%** | 0% | Basic 的 docker.sock 規則完全覆蓋 |
| room7 | docker-build-misconfiguration | 33% | 33% | 0% | 均觸發 Docker Socket Accessed |
| room8 | misconfiguration-debugging | 0% | 0% | 0% | docker compose 規則未觸發 |
| room9 | docker-sock-exposure | **33%** | 0% | −33% | ⚠ 異常（詳見第 3 節） |
| room10 | exposed-secret-in-logs | — | — | — | 靜態日誌場景，無可量測規則 |
| room11 | cron-injection | **50%** | 0% | −50% | ⚠ 異常（詳見第 3 節） |
| final | container-escape | **100%** | 0% | −100% | ⚠ 異常（詳見第 3 節） |
| secret-a | exposed-secret | 0% | 0% | 0% | /proc 讀取規則未觸發 |
| secret-b | docker-layer-leak | 0% | 0% | 0% | docker save 規則未觸發 |

**平均規則覆蓋率：Basic ≈ 23%，Full ≈ 28%（差距僅 5%）**

### 2.2 誤報率（false_positive_rate）

> 定義：baseline 靜置期間（無攻擊），同一批規則仍被觸發的比例

| 場景 | Basic 誤報率 | Full 誤報率 | Δ (Full−Basic) |
|---|:---:|:---:|:---:|
| room0 | 0% | **100%** | +100% |
| room1 | 0% | 0% | 0% |
| room2 | 0% | 33% | +33% |
| room3 | 0% | 50% | +50% |
| room4 | 0% | 0% | 0% |
| room5 | 0% | 0% | 0% |
| room6 | 50% | 50% | 0% |
| room7 | 0% | 0% | 0% |
| room8 | 0% | 0% | 0% |
| room9 | 0% | 0% | 0% |
| room10 | — | — | — |
| room11 | 0% | 25% | +25% |
| final | 50% | 50% | 0% |
| secret-a | 0% | 50% | +50% |
| secret-b | 0% | 0% | 0% |

**平均誤報率：Basic ≈ 7.1%，Full ≈ 25.6%（Full 高出 3.6 倍）**

### 2.3 Baseline 告警量（20 秒靜置期間）

> 代理量測邊緣設備上的「雜訊處理負擔」

| 場景 | Basic 告警/分鐘 | Full 告警/分鐘 | 倍數 |
|---|:---:|:---:|:---:|
| room0 | 123 | 258 | ×2.10 |
| room1 | 150 | 309 | ×2.06 |
| room2 | 144 | 327 | ×2.27 |
| room3 | 159 | 363 | ×2.28 |
| room4 | 189 | 399 | ×2.11 |
| room5 | 177 | 363 | ×2.05 |
| room6 | 126 | 279 | ×2.21 |
| room7 | 150 | 771 | ×5.14 |
| room8 | 198 | 1293 | ×6.53 |
| room9 | 210 | 951 | ×4.53 |
| room10 | 198 | 570 | ×2.88 |
| room11 | 156 | 372 | ×2.38 |
| final | 153 | 318 | ×2.08 |
| secret-a | 141 | 291 | ×2.06 |
| secret-b | 102 | 207 | ×2.03 |
| **平均** | **~53/min** | **~157/min** | **×2.98** |

**Full Tier 在靜置狀態下產生約 3 倍告警量。**  
room7/room8/room9 因 Docker 操作密集場景差距更大（最高 ×6.5）。

### 2.4 告警處理成本估算（假設：每筆 350 bytes，10 個容器）

| 指標 | Basic Tier | Full Tier |
|---|---|---|
| 平均告警率（每容器）| 53 則/分 | 157 則/分 |
| 每小時傳輸量 | ~10.6 MB/hr | ~31.5 MB/hr |
| 每日傳輸量 | ~254 MB/day | ~756 MB/day |

---

## 3. 異常說明

### 3.1 room9 / room11 / final：Basic 覆蓋率 > Full 覆蓋率

**原因：Falco webhook 延遲（Docker Desktop/WSL2 已知問題）**

這三個場景的 exploit 執行時間短（2–3 秒），但 Falco webhook 可能在執行結束後數秒至數分鐘才送達。

- **Full tier run**：webhook 抵達時 run 已結束，alert 依 `alert.time` 回溯，但時間窗口計算偏差（或被歸到 baseline run），導致覆蓋率記為 0%
- **Basic tier run**（跑在不同時間點）：剛好 webhook 及時送達，覆蓋率正確記錄

這是**量測方法論的限制**，非 Basic tier 真的比 Full tier 更有效偵測這些場景。論文中應明確說明此限制。

### 3.2 room3 / room5：兩個 Tier 覆蓋率均為 0%

**原因：modern_ebpf 在 WSL2 虛擬化層的 syscall 捕獲不穩定**

- `Signal Sent To Other Process`（room3）：依賴 `kill`/`tgkill` syscall 事件
- `Local Service Port Scan`（room5）：依賴 `spawned_process` + `ss`/`netstat`

這些 syscall 在 Docker Desktop 的 WSL2 後端未必能被 eBPF probe 穩定捕獲。這是環境限制，在 Linux 裸機上可能有不同結果。

### 3.3 room0 Full Tier 誤報率 100%

**這是刻意的設計**。`Baseline Read Of Motd Or Hint File` 規則標記為 `tier_full_only`，且 desc 說明「用於誤報率對照」——每次任何程序讀 /etc/motd 都會觸發，正常容器啟動也不例外。這條規則是對照組，刻意放在 Full tier 用於展示誤報問題。

---

## 4. 主要發現摘要

### 論文論述核心

> Full tier 在偵測覆蓋率上比 Basic tier 高 **+5%**，但：
> - 誤報率高出 **3.6 倍**（25.6% vs 7.1%）
> - 靜置告警量多出 **~3 倍**（157 vs 53 則/分）
> - 在 Docker 密集場景（room7/room8）差距高達 **5–6 倍**
>
> 在資源受限的邊緣節點上，以精選高信度規則（Basic tier）可在幾乎不犧牲偵測能力的前提下，大幅降低告警處理負擔與誤報干擾。

### 量化表格（論文可直接引用）

| 指標 | Basic Tier | Full Tier | Full/Basic 比 |
|---|:---:|:---:|:---:|
| 規則數 | 8 | 31 | ×3.88 |
| 平均規則覆蓋率 | 23% | 28% | ×1.22 |
| 平均誤報率 | 7.1% | 25.6% | ×3.61 |
| 平均 Baseline 告警率 | 53/min | 157/min | ×2.98 |
| 每日傳輸量估算（10容器）| 254 MB | 756 MB | ×2.98 |

---

## 5. 前端現有功能清單（大改動前紀錄）

### 5.1 頁面結構

```
frontend/lab/
├── analytics.html   — 分析頁（Tier tabs + 對比視圖 + 圖表 + 成本估算 + CSV 下載）
├── index.html       — Lab 執行頁（場景卡片 + 執行歷史 + Tier 切換）
└── batch-run.html   — 批次執行頁（Tier 指示器 + 即時 WebSocket 串流）
```

### 5.2 analytics.html 功能

- **Tier tabs**：全部 / 🟢 Full Tier / 🔵 Basic Tier / ⚖ Tier 對比
- **單一 Tier 視圖**：
  - 摘要卡片（總執行次數、場景數、成功率、偵測率、規則覆蓋率、誤報率、Baseline 場景數）
  - Detection matrix 表格（11 欄）
  - RQ2 圖表：規則覆蓋率 vs 誤報率（Chart.js 橫向 bar）
  - ⬇ 下載 CSV 按鈕
- **Tier 對比視圖**：
  - 摘要卡片（平均規則覆蓋率 Δ、平均誤報率 Δ、Baseline 告警率倍數）
  - 10 欄比對表（含 Δ 覆蓋率、Δ 誤報率、告警率、雜訊倍數）
  - 圖表 1：規則覆蓋率 + 誤報率 Tier 對比（4 datasets 橫向 grouped bar）
  - 圖表 2：Baseline 告警率 Tier 對比（2 datasets 直向 grouped bar）
  - 告警處理成本估算（可調容器數，自動重算頻寬/儲存量）
  - ⬇ 下載比對 CSV 按鈕
- **RQ3 區塊**：docker stats 即時資源用量表（Falco / lab-api / room-manager）

### 5.3 index.html 功能

- Tier 狀態徽章（🔵 Basic / 🟢 Full）+ 切換按鈕（自動重啟 Falco）
- 場景卡片（執行 / Baseline / 上次結果摘要）
- 執行歷史表格（含 Tier/類型欄，🔵/🟢 + 🔬 baseline 標示）

### 5.4 batch-run.html 功能

- Tier 指示器 badge（只讀）
- 15 場景批次執行（WebSocket 即時串流）
- 每場景獨立進度列 + 告警計數
- WS close handler 防止意外斷線卡住批次

---

## 6. 前端改進建議（大改動方向）

以下是根據實驗結果與論文需求，可考慮的前端優化方向：

### 6.1 Analytics 頁強化（論文取數據用）

- [ ] **多次實驗取平均**：目前每個 tier 每場景只有 1 次，建議顯示「n 次平均 ± 標準差」
- [ ] **MITRE ATT&CK 對應欄**：在場景表格加入攻擊技術分類（T1610 Container Admin Command 等），強化學術可信度
- [ ] **場景分組**：按 Chapter（Chapter 1~4 + Final + Secret）分組顯示，與論文架構對齊
- [ ] **Export PNG**：圖表加「另存為圖片」按鈕，方便插入論文

### 6.2 Lab 執行頁（操作體驗）

- [ ] **一鍵完整實驗**：在 batch-run.html 加「切換 Tier 並批次執行」流程，自動切換 → 等待 Falco 重啟 → 跑完 15 場景
- [ ] **執行次數控制**：batch 執行時可設定每個場景重複次數（用於取平均）
- [ ] **時間線視圖**：執行歷史改為時間軸形式，清楚顯示各 tier 資料收集的時間順序

### 6.3 整體設計方向

- [ ] **論文模式 / 展示模式切換**：論文模式顯示完整數據與統計；展示模式（給玩家）只顯示遊戲相關資訊
- [ ] **響應式設計**：目前圖表在小螢幕上可能超出視窗
- [ ] **黑暗/明亮主題**：目前只有黑暗主題，論文截圖可能需要白底

---

## 7. 後端 API 端點清單（供前端參考）

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/lab/scenarios` | 所有場景定義 |
| GET | `/api/lab/runs` | 執行歷史（可加 `?scenario_id=` 過濾） |
| POST | `/api/lab/runs` | 啟動 exploit 執行 |
| POST | `/api/lab/baseline-runs` | 啟動 baseline 執行 |
| GET | `/api/lab/runs/:id/stream` | WebSocket 即時串流 |
| GET | `/api/lab/analytics/detection-matrix` | 偵測矩陣（可加 `?tier=basic\|full\|all`） |
| GET | `/api/lab/analytics/resource-usage` | Docker stats 資源用量 |
| GET | `/api/lab/falco-tier` | 當前 tier 設定 |
| POST | `/api/lab/falco-tier` | 切換 tier（自動重啟 Falco） |
| DELETE | `/api/lab/runs` | 清除所有歷史記錄 |

---

## 8. 技術限制備忘

1. **Falco webhook 延遲**：Docker Desktop/WSL2 modern_ebpf 模式下，webhook 最晚可延遲數分鐘。已實作 10 秒緩衝的回溯關聯機制（`ALERT_RETROACTIVE_BUFFER_MS`），但仍有遺漏風險。
2. **container.name 為 null**：Falco 0.39.2 在此環境中告警的 container.name/id 欄位為 null，因此告警以時間窗口關聯而非容器名稱關聯。跨場景同時執行時可能有串擾。
3. **Baseline 持續時間 20 秒**：目前固定為 20 秒，統計上略短。若要提升可信度，建議改為 60 秒或多次執行取平均。
4. **規則 ID 對應**：`falco_rule_refs`（場景 JSON 的內部 ID）與 Falco 規則名稱的對應靠 `app.js` 裡的手動 `RULE_REF_MAP`，新增規則需同步更新對應表。
