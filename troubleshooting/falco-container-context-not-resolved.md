# Falco smoke test：`docker exec <room> bash -c "..."` 產生的事件，container context 大多解析不到（2026-06-14 更新：已大幅緩解，見第 8 節）

> **日期：** 2026-06-13（2026-06-14 補充第 8 節後續驗證結果）

## 1. 緣由

完成 [[falco-startup-config-bugs]] 三個啟動問題的修復後，Falco
（`falcosecurity/falco-no-driver:latest`，0.39.2，`engine.kind:
modern_ebpf`）已能穩定運作並輸出 JSON 告警。為驗證 `falco/README.md`
第 2 節「Scenario ↔ Falco 規則對照表」的規則是否真的會在實際攻擊流程中
觸發，依序執行了：

- `lab/exploits/room6.sh`、`lab/exploits/secret-b.sh`（完整 exploit
  腳本，內部透過 `lib/common.sh` 的 `room_exec` 以
  `docker exec <container> bash -c "<cmd>"` 模式操作房間）
- 人工指令：`docker exec -u player room6 docker ps`、
  `docker exec -u player room6 cat /var/run/docker.sock`、以及在
  room7 對 `/tmp/probe.tar` 做 `tar`/`grep` 的探測指令

同時用 `docker logs -f escape-falco` 即時 tail 並收集 JSON 輸出
（`falco_dump.jsonl`、`falco_live.jsonl`、`falco_live2.jsonl`，皆為
本次 smoke test 的暫存分析檔，未納入版本控制）。

**結果**：對照表中標記給 room6/room7/room9/final/secret-a/secret-b 的多條
規則——`Docker Socket Accessed From Container`、
`Docker Save Or History Executed`、`Tar Extraction Into Tmp Directory`、
`Recursive Grep Under Tmp` 等——在上述操作期間**完全沒有觸發**，即使
對應的指令本身確認執行成功（例如 `docker ps` 正常列出 4 個 container、
`cat /var/run/docker.sock` 正常讀到 socket 檔案的 `srw-rw----` 屬性）。

## 2. 觀察與根因（假設）

對收集到的 JSON 告警逐筆檢查 `container.id`／`container.name` 欄位，
發現：

- 絕大多數告警（包含「DAC Read Search Capability Used」、「Drop and
  execute new binary in container」等高頻背景雜訊）的
  `container.id`／`container.name` 都是 `null`，或是一個不屬於任何
  top-level room container 的 ID `1085f6199000`（後續確認為 room8
  內層 DinD daemon 的內部 container，host 端 `docker ps -a` 看不到）。
- **唯一例外**：default 規則「Terminal shell in container」在 room6/
  secret-b 的測試期間各觸發一次，且 `container.id` 正確帶出
  **真實值**——`secret-b` = `3588c38b871e`、`room6` = `4b3766ec8d4d`
  （以 `docker inspect <name> --format '{{.Id}}'` 核對一致），對應
  `proc.name=bash pname=containerd-shim cmd="bash --login"`。這組
  `proc`/`pname`/`cmd` 特徵符合 terminal-gateway 對玩家開啟的**長駐**
  互動式 `docker exec -it <room> bash` session，而非本次測試指令本身。

由以上兩點推斷的根因假設：

> Falco 的 container enrichment（把 syscall 事件對應到
> `container.id`/`container.name`）對**長駐**的 process（Falco 啟動時
> 該 process 已存在於 container 的 cgroup 中）能正常運作；但對
> `docker exec <container> <cmd>` 產生的**短命**子行程，在 Docker
> Desktop（WSL2 VM）+ modern eBPF 驅動的組合下，enrichment 來不及完成
> 或無法完成，導致 `container.id` 解析為 `null`。

凡是 condition 中包含 `container`（即 macro `container.id != host`）
的規則，在 `container.id` 為 `null` 時，這個 macro 為 false，**規則
整體不成立**——即使對應的 `connect`/`open`/`execve` 等 syscall 事件
本身確實發生且被 Falco 看到了（背景雜訊規則的大量輸出證明 Falco 確實
在持續攔截這些短命行程的 syscall，只是 enrichment 沒附上正確的
container 資訊）。

`lab/exploits/*.sh` 全部 15 支腳本透過 `lib/common.sh` 的 `room_exec`
一律採用 `docker exec <container> bash -c "<cmd>"` 模式，因此**對照表中
所有依賴 `container` macro 的規則，在目前的 exploit 自動化流程下都不會
觸發**——這不是規則命名或對照錯誤，而是 container context 解析本身的
環境限制。

## 3. 額外發現：`Unexpected Child Process In Container Via Docker Exec` 的獨立邏輯缺口

即使上述 container context 問題解決，這條規則仍有第二個獨立問題。
condition（`falco/rules/lab_rules.yaml`）：

```yaml
condition: >
  spawned_process and container and
  proc.pname in (containerd-shim, runc) and
  not proc.name in (bash, sh)
```

`docker exec <container> bash -c "<cmd>"` 模式下，直接被
`containerd-shim`/`runc` spawn 的行程是 `bash`（執行
`bash -c "<cmd>"`），而 `<cmd>` 裡真正的指令（`tar`、`grep`、`docker`
等）的 `pname` 是 `bash`，不是 `containerd-shim`/`runc`。因此
`not proc.name in (bash, sh)` 這個排除條件，**把所有 15 支 exploit 腳本
共用的呼叫模式都排除在外**，使這條規則對「外部 `docker exec` 注入」這個
它原本要偵測的場景實質上永遠不會命中。

## 4. 影響範圍（smoke test 期間未觸發的規則）

| 規則 | 對應 scenario | 涉及問題 |
|---|---|---|
| `Docker Socket Accessed From Container` | room6/7/9/final/secret-a | container context（第 2 節） |
| `Docker Save Or History Executed` | secret-b | container context（第 2 節） |
| `Tar Extraction Into Tmp Directory` | secret-b | container context（第 2 節） |
| `Recursive Grep Under Tmp` | secret-b | container context（第 2 節） |
| `Unexpected Child Process In Container Via Docker Exec` | room6/7/final | container context + bash 排除（第 2、3 節，雙重問題） |

## 5. 目前狀態：未修復，列為後續工作

本次 smoke test 的目的是驗證現有 Falco 部署與規則設定，找出問題範圍，
**不在本次 session 內修復**。根因屬於 Docker Desktop / WSL2 + modern
eBPF 驅動的環境限制，修復成本與風險（例如改用 `proc.pid` 搭配 host 端
`docker top` 結果做事後關聯，繞過 Falco 自身的 `container.id`）較高，
需要更完整的設計討論。

**建議後續方向**：

1. 在 Raspberry Pi（真實 Linux，可能改用 kernel module 驅動）上重跑本
   smoke test，確認是否為 Docker Desktop/WSL2 特有的問題。
2. 若 lab-api 需要把 Falco 告警與「目前正在跑哪個房間的 exploit」做關聯，
   考慮不依賴 `container.id`，改用時間窗口 + `proc.pid`/`proc.vpid` 對照
   `docker top <room>` 的結果。
3. 修訂 `Unexpected Child Process In Container Via Docker Exec` 的
   `not proc.name in (bash, sh)` 排除條件（第 3 節），但需注意放寬後
   可能大幅增加誤報（一般互動式 shell 也會符合 `pname=containerd-shim
   proc.name=bash`）。

## 6. 修改檔案清單

本次純粹是發現與記錄，**沒有程式碼修改**。`falco/README.md` 第 4 節
已加入對應的 smoke test 結果摘要與本文件的連結。

## 7. 相關問題

- 與 [[falco-startup-config-bugs]] 同屬本次 falco smoke test 的產出，
  但前者是「Falco 啟動不起來」的阻擋性問題（已修復），這篇是「Falco
  跑起來之後，規則沒有如預期觸發」的環境限制（2026-06-14 已大幅緩解，
  見第 8 節）。

## 8. 2026-06-14 後續驗證：把 Falco 接進常駐 stack 後，問題已大幅緩解

[[lab-admin-token-lockout]] 完成後，依「改善 Falco 偵測率」規劃，把
`falco/docker-compose.falco.example.yml` 的 `falco` service 正式合併進
主 `docker-compose.yml`（`escape-falco` 從此與其他服務一樣常駐運行，不再
是 smoke test 時才手動 `docker compose -f ... -f falco/docker-compose...
up` 的臨時容器）。合併後透過（已移除 admin token 驗證的）Lab 前端，依序
對 `room2`、`room6`、`secret-b` 各執行一次 `POST /api/lab/runs`
（會先呼叫 room-manager `reset`，重新建立該房間的 container），並檢視
`run.alerts`：

| 場景 | 第 4 節原記錄「未觸發」的規則 | 本次實測結果 |
|---|---|---|
| room2 | （第 2 節對照表規則，舊測試未特別記錄為失敗） | `Sudo Exec Of Backup Script`、`Root Read Of Secret File Via Spawned Process`、`DAC Read Search Capability Used` 全部觸發 |
| room6 | `Docker Socket Accessed From Container`、`Unexpected Child Process In Container Via Docker Exec` | 兩者皆觸發 |
| secret-b | `Docker Save Or History Executed`、`Tar Extraction Into Tmp Directory`、`Recursive Grep Under Tmp` | `Docker Save Or History Executed` 觸發（其餘兩條因 exploit 腳本本身失敗——見下方「次要發現」——未執行到對應步驟，無法判斷） |

### 8.1 修正後的根因

第 2 節的假設（`docker exec` 短命子行程的 `container.id` 解析為 `null`，
導致 `container` macro 為 false）**並非 Docker Desktop/WSL2 + modern eBPF
驅動的固有限制**，而是當時的**測試方法**造成的：

- 2026-06-13 的 smoke test 是先手動啟動 `escape-falco`，此時 room6/
  secret-b 等 container **早已存在並執行一段時間**。Falco 的 container
  enrichment 仰賴觀察到 container 的 CREATE/START 事件來建立內部對照表；
  若 Falco 啟動時 container 已存在，且其後沒有重建，Falco 就一直查不到
  這些 container 的 `container.id`，使其短命子行程的事件全部解析為
  `null`（唯一例外 `Terminal shell in container` 能正確解出，可能是因為
  那次測試期間 terminal-gateway 剛好重新對該房間開了新的 `docker exec -it`
  session，而非該 process 本身「長駐」）。
- 2026-06-14 的測試中，`escape-falco` 是**先啟動且持續運行**的常駐服務；
  `POST /api/lab/runs` 每次都會先呼叫 room-manager `reset`（重建該房間
  container），Falco 因此能即時捕捉到新 container 的 CREATE 事件並建立
  enrichment 對照，後續該 container 內（含 `docker exec ... bash -c
  "<cmd>"` 的短命子行程）的 syscall 就能正確解析出 `container.id`，
  `container` macro 為 true，規則正常觸發。

換言之：**「Falco 是否常駐運行、且是否在 container 建立/重建時就已在
監聽」才是關鍵，而不是 `docker exec` 短命子行程本身的限制**。Edge 場景下
這個結論本身也有意義：偵測系統的啟動時機/持久性會直接影響其對「重建後的
工作負載」的覆蓋率。

### 8.2 次要發現：`container.name` 仍為 `null`，但不影響規則觸發

本次所有告警的 `output_fields.container.name` 仍顯示 `null`（即使規則
本身已正確觸發，代表 `container.id != host` 即 `container` macro 已成立）。
推測 `container.id`（由 cgroup/namespace 資訊取得，不需查詢 Docker API）
與 `container.name`（需透過 docker.sock 查詢 metadata 做名稱對照）是兩條
獨立的 enrichment 路徑，後者在目前環境下仍未解析成功——但因為
`falco/rules/lab_rules.yaml` 的規則 condition 只用到 `container`
macro（即 `container.id`），`container.name` 解析失敗不影響規則是否觸發，
只影響 alert output 文字裡 `container=<NA>` 的顯示，**不需修正規則**。

副作用：因為 `container.name`/`container.id` 在 output 中皆不可用，
lab-api 無法用「告警屬於哪個 container」過濾，目前 `run.alerts` 是用
「`POST /api/lab/runs` 的 `[started_at, finished_at]` 時間窗口」涵蓋期間
收到的*所有*告警（包含同時間其他房間/host 程序產生的雜訊，例如
`DAC Read Search Capability Used`、`Packet socket created in container`、
`Terminal shell in container`）。這對 `rule_coverage`（A2，計算
`falco_rule_refs` 是否「曾經」被觸發過）影響有限——只要該場景對應的規則
真的有觸發過一次即可——但會讓 `triggered_rules` 列表包含與該場景無關的
雜訊規則，前端展示時需註明此限制。

### 8.3 次要發現：secret-b 場景因 room7 未重置而執行失敗（既有已知限制）

secret-b 的 exploit 腳本實際操作對象是 `room7`（見 `lab-api/README.md`
「已知限制」），但 `POST /api/lab/runs` 只會 reset `secret-b` 本身。本次
測試時 room7 容器已停止（room-manager 因閒置自動 stop），導致
`docker exec room7 ...` 回傳 `is not running`，secret-b 的 step 2-4 全部
`exit=1`，run 狀態為 `failed`。這是文件中已記載的既有限制，不在本次
Falco 規劃範圍內，故不另開 troubleshooting 文件；僅在此記錄「`Docker Save
Or History Executed` 仍在 step 3 失敗前/後的時間窗口內被觸發」這一點，
與 8.2 的「時間窗口而非 container 過濾」現象一致。

### 8.4 對 A1（規則條件修正）範圍的影響

基於以上實測，**A1 規劃中「移除 27 條規則的 `container and` 前綴」與
「修訂 `Unexpected Child Process In Container Via Docker Exec` 的
`not proc.name in (bash, sh)`」均非必要**——兩者在「Falco 常駐 + reset
重建 container」的條件下都已正確運作（`Unexpected Child Process In
Container Via Docker Exec` 在 room6 測試中也成功觸發，因為
`docker exec room6 bash -c "docker ..."` 模式下，真正被 `containerd-shim`
/`runc` 標記為非預期子程序的是 `bash` spawn 出的 `docker`/`cat` 等指令，
其 `proc.name` 本身不在 `(bash, sh)` 排除清單內，所以規則仍會命中）。

A1 因此**不修改 `falco/rules/lab_rules.yaml` 的規則條件**，本次規劃的
重點轉為 A2（新增 `rule_coverage`/`triggered_rules` 指標，量化「修正後」
的偵測覆蓋率）與文件更新（本節 + `falco/README.md` 第 4 節）。

## 9. 修改檔案清單（2026-06-14 後續驗證）

| 檔案 | 變更 |
|---|---|
| `docker-compose.yml` | 新增 `falco` service（`escape-falco` 常駐，取代僅供參考的 `falco/docker-compose.falco.example.yml`） |
| `troubleshooting/falco-container-context-not-resolved.md` | 本檔案，新增第 8 節後續驗證結果 |
| `falco/README.md` | 第 4 節補充 2026-06-14 重測結果（見該檔案） |
