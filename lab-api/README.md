# lab-api

Edge Container Security Lab 的執行引擎（Phase 2 核心），對應
`docs/edge-container-security-lab-proposal.md` 第 5.2 節。與
`room-manager` 同模式：Node.js + Express，透過 HTTP 呼叫 room-manager
管理房間生命週期，並執行 `lab/exploits/*.sh` 取得結構化結果。

## API

| 方法 | 路徑 | 說明 |
|---|---|---|
| `GET` | `/api/lab/scenarios` | 列出 15 個場景的中繼資料（精簡版） |
| `GET` | `/api/lab/scenarios/:id` | 單一場景完整內容（含 `exploit_steps`、`falco_rule_refs` 等） |
| `POST` | `/api/lab/runs` | 執行一次實驗：body `{ "scenario_id": "room2" }`，需 `x-admin-token` header |
| `GET` | `/api/lab/runs` | 歷史執行列表（可用 `?scenario_id=` 篩選），由新到舊 |
| `GET` | `/api/lab/runs/:id` | 單次執行詳情（含每個 step 的輸出） |
| `POST` | `/api/lab/falco-webhook` | Falco `http_output` 的目標端點，記錄最近的告警 |
| `GET` | `/api/lab/alerts` | 查看最近收到的 Falco 告警（除錯用，記憶體內，重啟即清空） |

## `POST /api/lab/runs` 流程

1. 呼叫 `room-manager` 的 `POST /rooms/:container/reset`
   （`x-admin-token` = `ADMIN_TOKEN`），確保場景對應的房間在乾淨狀態
2. 以 `bash lab/exploits/<scenario_id>.sh` 執行攻擊腳本，逐行解析其
   JSON Lines 輸出（`{"type":"step",...}` / `{"type":"result",...}`，
   見 `lab/exploits/lib/common.sh`）
3. 執行完成後，再呼叫一次 `room-manager` 的 `reset`（best-effort，失敗
   只記錄 log，不影響本次回應），讓房間回到乾淨狀態供下次實驗使用
4. 將結果（`status`/`final_privilege`/`flag_found`/`duration_ms`/每個
   step 的輸出）寫入 `data/runs.json` 並回傳

## 環境變數

| 變數 | 預設值 | 說明 |
|---|---|---|
| `PORT` | `4100` | 監聽埠 |
| `ADMIN_TOKEN` | `admin_dev_token` | 呼叫 `POST /api/lab/runs` 與 room-manager reset 用的 token |
| `ROOM_MANAGER_URL` | `http://room-manager:4000` | room-manager 的 base URL |
| `LAB_DIR` | `../lab`（本機）/ `/app/lab`（容器） | `lab/` 目錄路徑，需含 `scenarios/` 與 `exploits/` |
| `RUN_TIMEOUT_MS` | `120000` | 單次 exploit 腳本的逾時時間（毫秒），超時會 `SIGKILL` |

## 已知限制 / 未來工作

- `POST /api/lab/runs` 是**同步**執行（HTTP 回應等到腳本跑完），room8
  / secret-b 等較重的場景可能需要數十秒。即時串流（攻擊腳本 stdout +
  Falco 告警）規劃在 Phase 3（`/api/lab/runs/:id/stream`，WebSocket）。
- `falco_ruleset`（`off`/`basic`/`full`）參數尚未串接：目前 Falco 的
  ruleset 切換仍是手動修改 `falco/falco.yaml` 的 `rules_file` 或
  `-T tier_full_only` 旗標，未由 lab-api 動態控制。
- Falco 告警與 exploit run 的時間關聯分析尚未實作：根據
  `troubleshooting/falco-container-context-not-resolved.md` 的發現，
  `docker exec` 短命子行程的 `container.id` 在目前環境（Docker Desktop
  + WSL2 + modern eBPF）大多解析不到，多數規則不會對 exploit 腳本的
  操作觸發，需先解決該限制（或改用 PID 關聯）才能讓這個分析有意義。
- `secret-b` 場景的 exploit 實際操作對象是 `room7`（在 room7 對
  `escape-docker-secret-b` image 做 OCI layer 考古，見
  `lab/exploits/README.md`）；目前 `/api/lab/runs` 只會重置
  `secret-b` 本身（依 `lab/scenarios/secret-b.json` 的 `container`
  欄位），不會重置 `room7`。
- `data/runs.json` 是單一 JSON 檔（無並發鎖），假設 lab-api 為單一
  process 且 `/api/lab/runs` 為低頻人工/排程觸發，不會有併發寫入問題。
