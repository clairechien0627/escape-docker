# lab-api

Edge Container Security Lab 的執行引擎（Phase 2 核心 + Phase 3 即時串流），
對應 `docs/edge-container-security-lab-proposal.md` 第 5.2 節。與
`room-manager` 同模式：Node.js + Express，透過 HTTP 呼叫 room-manager
管理房間生命週期，並執行 `lab/exploits/*.sh` 取得結構化結果。

## API

| 方法 | 路徑 | 說明 |
|---|---|---|
| `GET` | `/api/lab/scenarios` | 列出 15 個場景的中繼資料（精簡版） |
| `GET` | `/api/lab/scenarios/:id` | 單一場景完整內容（含 `exploit_steps`、`falco_rule_refs` 等） |
| `POST` | `/api/lab/runs` | **非同步**啟動一次實驗：body `{ "scenario_id": "room2" }`，無需登入，立即回傳 `202` + run 物件（`status: "starting"`） |
| `GET` | `/api/lab/runs` | 歷史執行列表（可用 `?scenario_id=` 篩選），由新到舊 |
| `GET` | `/api/lab/runs/:id` | 單次執行詳情（進行中回傳即時狀態，結束後回傳完整結果，含每個 step 的輸出） |
| `GET` (WS) | `/api/lab/runs/:id/stream` | **Phase 3**：即時串流該次執行的 `status`/`step`/`result`/`alert`/`error` 事件（JSON，每則一行） |
| `POST` | `/api/lab/falco-webhook` | Falco `http_output` 的目標端點，記錄最近的告警並轉發給目前執行中的 run |
| `GET` | `/api/lab/alerts` | 查看最近收到的 Falco 告警（除錯用，記憶體內，重啟即清空） |
| `GET` | `/api/lab/analytics/detection-matrix` | **Phase 5**：依場景彙整歷史執行的成功率、FLAG 取得率、平均耗時、Falco 偵測率（RQ2） |

## `POST /api/lab/runs` 流程（非同步，Phase 3）

`POST /api/lab/runs` 不需任何驗證（Lab 設計為使用者可自行操作的
實驗模擬平台），立即回傳 `202` 與一筆 run 物件
（`{ id, scenario_id, status: "starting", started_at, steps: [], ... }`），
實際執行在背景進行：

1. 呼叫 `room-manager` 的 `POST /rooms/:container/reset`
   （`x-admin-token` = `ADMIN_TOKEN`），確保場景對應的房間在乾淨狀態；
   完成後 run 狀態變為 `running`
2. 以 `bash lab/exploits/<scenario_id>.sh` 執行攻擊腳本，逐行解析其
   JSON Lines 輸出（`{"type":"step",...}` / `{"type":"result",...}`，
   見 `lab/exploits/lib/common.sh`），每個 step 解析完即透過
   `/api/lab/runs/:id/stream` 即時轉發
3. 執行完成後，再呼叫一次 `room-manager` 的 `reset`（best-effort，失敗
   只記錄 log，不影響本次結果），讓房間回到乾淨狀態供下次實驗使用
4. 將最終結果（`status`/`final_privilege`/`flag_found`/`duration_ms`/
   每個 step 的輸出）寫入 `data/runs.json`，並透過 stream 送出
   `{"type":"result",...}` 後關閉連線

`GET /api/lab/runs/:id` 在執行中會回傳即時狀態（`status`/已完成的
`steps`），結束後回傳與 `data/runs.json` 相同形狀的完整結果。

### `/api/lab/runs/:id/stream`（WebSocket）

連線後會先補送目前已知狀態：`{"type":"status","status":...}`，接著是
已完成的每個 `{"type":"step",...}`；若該次執行已結束，緊接著送出
`{"type":"result",...}` 並關閉連線。若仍在執行中，則持續推送後續的
`step`/`result`/`alert`/`error` 事件，直到 `result`/`error` 出現後關閉。
`alert` 事件來自 `/api/lab/falco-webhook`（見下方限制）。

## 環境變數

| 變數 | 預設值 | 說明 |
|---|---|---|
| `PORT` | `4100` | 監聽埠 |
| `ADMIN_TOKEN` | `admin_dev_token` | lab-api 呼叫 room-manager reset 用的內部 token（`POST /api/lab/runs` 本身不需要） |
| `ROOM_MANAGER_URL` | `http://room-manager:4000` | room-manager 的 base URL |
| `LAB_DIR` | `../lab`（本機）/ `/app/lab`（容器） | `lab/` 目錄路徑，需含 `scenarios/` 與 `exploits/` |
| `RUN_TIMEOUT_MS` | `120000` | 單次 exploit 腳本的逾時時間（毫秒），超時會 `SIGKILL` |

## 已知限制 / 未來工作

- `falco_ruleset`（`off`/`basic`/`full`）參數尚未串接：目前 Falco 的
  ruleset 切換仍是手動修改 `falco/falco.yaml` 的 `rules_file` 或
  `-T tier_full_only` 旗標，未由 lab-api 動態控制。
- 每次 run 在背景執行期間收到的 Falco 告警會記錄在
  `run.alerts`（隨最終結果寫入 `data/runs.json`），
  `/api/lab/analytics/detection-matrix` 即以
  `alerts.length > 0` 作為該次 run 是否被「偵測到」。但根據
  `troubleshooting/falco-container-context-not-resolved.md` 的發現，
  `docker exec` 短命子行程的 `container.id` 在目前環境（Docker Desktop
  + WSL2 + modern eBPF）大多解析不到，多數規則不會對 exploit 腳本的
  操作觸發，因此偵測率偏低/為 0 本身也是 RQ2 的觀察結果之一，並非
  程式錯誤；需先解決該限制（或改用 PID 關聯）才能讓這個指標更精確。
- `secret-b` 場景的 exploit 實際操作對象是 `room7`（在 room7 對
  `escape-docker-secret-b` image 做 OCI layer 考古，見
  `lab/exploits/README.md`）；目前 `/api/lab/runs` 只會重置
  `secret-b` 本身（依 `lab/scenarios/secret-b.json` 的 `container`
  欄位），不會重置 `room7`。
- `data/runs.json` 是單一 JSON 檔（無並發鎖），假設 lab-api 為單一
  process 且 `/api/lab/runs` 為低頻人工/排程觸發，不會有併發寫入問題。
