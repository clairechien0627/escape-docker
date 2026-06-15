# falco/

Edge Container Security Lab 的偵測後端設定。這個目錄包含：

- `falco.yaml` — Falco 主設定（rules_file 清單、JSON/HTTP 輸出）
- `rules/lab_rules.yaml` — 針對 15 個房間設計的自訂規則
- `docker-compose.falco.example.yml` — 加入 Falco 監控容器的範例設定

## 1. Ruleset 切換機制（off / basic / full）

`lab_rules.yaml` 中每條規則都帶有 `tier_basic` 或 `tier_full_only` 標籤：

| 模式    | 行為                                                                 | 適用情境                         |
|---------|----------------------------------------------------------------------|----------------------------------|
| `off`   | `falco.yaml` 的 `rules_file` 不包含 `lab_rules.yaml`                  | 量測「無偵測機制」時的資源/效能基準 |
| `basic` | 載入 `lab_rules.yaml`，並以 `falco -T tier_full_only` 停用所有 `tier_full_only` 規則 | 只保留高信度核心規則，誤報率低     |
| `full`  | 載入 `lab_rules.yaml`，不額外停用任何 tag（`enabled: false` 的規則仍維持停用） | 涵蓋全部 15 房間的偵測規則         |

切換方式（對應 `docker-compose.falco.example.yml` 的 `command`）：

```yaml
command:
  - /usr/bin/falco
  - -c
  - /etc/falco/falco.yaml
  # basic 模式請加上：
  # - -T
  # - tier_full_only
```

> `--modern-bpf` 旗標在 Falco 0.39+ 已移除（加上會導致啟動失敗），
> `falco-no-driver` image 與 `falco/falco.yaml` 已預設 `engine.kind:
> modern_ebpf`，不需額外旗標。詳見
> `troubleshooting/falco-startup-config-bugs.md`。

`off` 模式則是把 `falco.yaml` 的 `rules_file` 中 `/etc/falco/lab_rules.yaml` 那一行移除（或不掛載該檔案）。

這三種模式對應 RQ2（不同偵測強度下的資源開銷與誤報率），未來由 lab-api 的
`falco_ruleset` 參數控制（規劃中，見 `docs/edge-container-security-lab-proposal.md`
5.2 節 endpoint 表）。

## 2. Scenario ↔ Falco 規則對照表

下表把每個房間 `lab/scenarios/<id>.json` 的 `falco_rule_refs` 對應到
`lab_rules.yaml` 中的實際規則名稱與 tier。部分項目標註「無對應規則」，
原因列於表格下方說明。

| 房間 | falco_rule_refs | 對應規則名稱（lab_rules.yaml） | tier |
|------|------------------|--------------------------------|------|
| room0 | `read_etc_motd`, `read_hint_file` | Baseline Read Of Motd Or Hint File | tier_full_only |
| room1 | `recursive_find_archive` | Recursive Find Under Archive Directory | tier_full_only |
| | `base64_decode_exec` | Base64 Decode Executed | tier_full_only |
| room2 | `sudo_exec_backup_script` | Sudo Exec Of Backup Script | tier_basic |
| | `secret_file_read_via_root` | Root Read Of Secret File Via Spawned Process | tier_basic |
| | `dac_read_search_capability_use` | DAC Read Search Capability Used | tier_full_only |
| room3 | `signal_to_other_process` | Signal Sent To Other Process | tier_full_only |
| | `ptrace_attach` | Ptrace Attach To Other Process | tier_full_only |
| | `proc_read_other_pid` | Read Proc Cmdline Or Environ Of Other Process | tier_full_only |
| room4 | `ssh_keygen_exec` | SSH Keygen Executed In Container | tier_full_only |
| | `authorized_keys_modified` | Authorized Keys Modified | tier_basic |
| | `ssh_port_forward_established` | SSH Local Port Forward Established | tier_full_only |
| | `internal_service_access_via_tunnel` | Loopback Connection To Internal-Only Port 9090 | tier_full_only |
| room5 | `local_service_port_scan` | Local Service Port Scan | tier_full_only |
| | `loopback_connect_nonstandard_port` | Loopback Connection To Nonstandard Port 7777 | tier_full_only |
| room6 | `docker_sock_access` | Docker Socket Accessed From Container | tier_basic |
| | `docker_api_container_list` | *(無對應規則，見下方說明①)* | — |
| | `docker_api_container_inspect` | *(無對應規則，見下方說明①)* | — |
| | `docker_api_container_start` | Unexpected Child Process In Container Via Docker Exec | tier_basic |
| room7 | `docker_build_exec` | Docker Build Executed In Container | tier_full_only |
| | `docker_sock_write_access` | Docker Socket Accessed From Container | tier_basic |
| | `container_create_with_host_mount` | New Container Created Via Docker CLI | tier_full_only |
| room8 | `docker_compose_exec` | Docker Compose Executed In Container | tier_full_only |
| | `new_container_created` | New Container Created Via Docker CLI | tier_full_only |
| | `local_http_request_nonstandard_port` | Local HTTP Request To Port 8080 | tier_full_only |
| room9 | `docker_sock_write_access` | Docker Socket Accessed From Container | tier_basic |
| | `docker_network_connect_api` | Docker Network Connect Executed | tier_basic |
| | `network_interface_added` | *(無對應規則，見下方說明①)* | — |
| | `internal_network_access` | Outbound Connection To Secret Network Subnet | tier_basic |
| room10 | `ssh_bruteforce_pattern` | Repeated SSH Auth Failures | tier_full_only（`enabled: false`，見下方說明②） |
| | `sensitive_endpoint_access` | Access To Sensitive Export Endpoint | tier_full_only（`enabled: false`，見下方說明②） |
| | `sensitive_token_in_log` | *(無對應規則，見下方說明②)* | — |
| room11 | `tmp_file_written_by_nonroot` | Non-root Write To Cron Watched File | tier_full_only |
| | `cron_child_process_root` | Cron Spawned Root Process | tier_full_only |
| | `secret_file_read_by_root_process` | Root Read Of Secret File Via Spawned Process | tier_basic |
| | `world_readable_file_written_by_root` | World Readable File Written By Root Cron Chain | tier_basic |
| final | `docker_sock_exec_api` | Docker Socket Accessed From Container | tier_basic |
| | `exec_create_in_other_container` | Unexpected Child Process In Container Via Docker Exec | tier_basic |
| | `unexpected_child_process_in_container` | Unexpected Child Process In Container Via Docker Exec | tier_basic |
| secret-a | `proc_environ_read` | Read Proc Cmdline Or Environ Of Other Process | tier_full_only |
| | `docker_inspect_api` | Docker Socket Accessed From Container | tier_basic |
| secret-b | `docker_save_api` | Docker Save Or History Executed | tier_full_only |
| | `image_layer_extraction` | Tar Extraction Into Tmp Directory | tier_full_only |
| | `recursive_grep_tmp` | Recursive Grep Under Tmp | tier_full_only |

**說明①（room6/room9 的 Docker API 語意區分）**：
docker.sock 上的 `list`/`inspect`/`network connect` 等操作，在 syscall 層級
都只是對同一個 unix socket fd 的 `connect`/`read`/`write`，Falco 無法單從
syscall 區分其 HTTP API 語意。這類操作統一由
`Docker Socket Accessed From Container`（第一階段訊號）涵蓋；
`docker_api_container_start`（實際啟動/exec 容器，會在目標容器內產生
非預期子程序）則由 `Unexpected Child Process In Container Via Docker Exec`
（高信度第二階段訊號）涵蓋。`network_interface_added` 同理屬於 Docker
daemon 端的狀態變化，純 host-side eBPF/syscall 監控無法直接觀察到，
若要偵測需改用 Docker events API（非 Falco 範疇）。

**說明②（room10 為靜態日誌分析）**：
room10 的玩家操作是對預先生成好的靜態日誌檔做 `grep`/`awk` 等 forensic
分析，本身是合法行為；`Repeated SSH Auth Failures` 與
`Access To Sensitive Export Endpoint` 描述的是「產生這些日誌的原始攻擊
行為」，在目前架構下不會被觸發，因此標記為 `enabled: false`
（概念性規則，保留供未來改為即時模擬攻擊流量時啟用）。
`sensitive_token_in_log` 屬於日誌內容比對，需要日誌分析工具
（例如未來的 lab-api 日誌掃描模組）而非 Falco。

## 3. 部署注意事項

### 3.1 驅動選擇（kernel module vs eBPF vs modern eBPF）

Falco 需要一種「驅動」來攔截 syscall：

- **kernel module**（`falcosecurity/falco` image）：效能最好，但需要對應
  kernel 版本的 headers（`/usr/src`、`/lib/modules`），在開發機（Linux/WSL2）
  通常可行，但版本不對時編譯會失敗。
- **modern eBPF**（`falcosecurity/falco-no-driver` + `--modern-bpf`）：
  不需要 kernel headers，但要求 **Linux kernel >= 5.8 且啟用 BTF**
  （`CONFIG_DEBUG_INFO_BTF=y`，可用 `zgrep CONFIG_DEBUG_INFO_BTF
  /proc/config.gz` 確認）。`docker-compose.falco.example.yml` 預設用此模式。
- **legacy eBPF**：相容性較廣但官方逐漸淘汰，不建議新部署採用。

**Raspberry Pi**：官方 Raspberry Pi OS（64-bit，建議 Pi 4/5）的較新版本
kernel 通常已啟用 BTF，可用 modern eBPF；若 BTF 未啟用則需確認是否能
換用支援 BTF 的 kernel，或退回 kernel module 驅動（需要對應 headers，
在 Pi 上自行編譯耗時較長）。**此為「待確認事項」，需在 Pi 到手後實測**
（對應 `docs/edge-container-security-lab-proposal.md` 第 9 節）。

### 3.2 特權容器與安全性

Falco 容器需要 `privileged: true` 與 `pid: host` 才能觀察其他容器的
syscall，這是 Falco 的標準部署方式（Falco 本身不會修改其他容器，僅做
被動觀察）。在多人共用的展示環境中，建議僅在量測/演示期間啟動此服務，
或限制其網路存取範圍（僅加入 `game_net` 以連到 lab-api）。

### 3.3 告警輸出

`falco.yaml` 設定 `http_output` 指向
`http://lab-api:4100/api/lab/falco-webhook`。`lab-api`（見
`lab-api/README.md`）已實作此端點，將收到的告警存進記憶體
（`GET /api/lab/alerts` 可查看最近 500 筆，供除錯），並依「`POST
/api/lab/runs` 的 `[started_at, finished_at]` 時間窗口」附加到對應 run 的
`alerts` 欄位（`/api/lab/analytics/detection-matrix` 用此計算
`detection_rate`/`rule_coverage`，見第 4.6 節）。同時保留
`stdout_output` 方便直接看 log 除錯（`docker compose logs -f falco`）。
`escape-falco` 已合併進主 `docker-compose.yml` 常駐運行（2026-06-14，
取代原本僅供參考的 `docker-compose.falco.example.yml`）；若該容器未啟動，
`http_output` 連線失敗不影響 Falco 本身運作，只是告警不會被轉發。

## 4. Smoke Test 結果記錄（2026-06-13）

第一次實際啟動 `escape-falco`（`docker compose -f docker-compose.yml -f
falco/docker-compose.falco.example.yml up -d --force-recreate falco`），
並對 `room6`、`room7`、`secret-b` 跑 `lab/exploits/{room6,secret-b}.sh`
與數個手動探測指令（`docker exec -u player room6 docker ps` /
`cat /var/run/docker.sock` / `tar` / `grep` 等），同時 tail Falco 的 JSON
輸出做比對。

### 4.1 啟動階段：3 個阻擋性設定/規則錯誤（已修復）

依序遇到並修復了 3 個會讓 Falco 完全無法啟動或規則載入失敗的問題：

1. `docker-compose.falco.example.yml` 沿用已移除的 `--modern-bpf` CLI 旗標
2. `lab_rules.yaml` 的 `Outbound Connection To Secret Network Subnet` 用了
   `ipaddr` 欄位不支援的 `startswith`/CIDR `in` 語法
3. 自訂 `falco.yaml` 覆蓋 image 內建設定後缺少 `engine.kind`，退回不存在的
   `kmod` 驅動

三者修復後 Falco 穩定運作，31 條 `lab_rules.yaml` 規則全部成功載入，並持續
輸出 JSON Lines 格式告警。詳細的緣由/根因/修復/驗證見
[`troubleshooting/falco-startup-config-bugs.md`](../troubleshooting/falco-startup-config-bugs.md)。

### 4.2 已驗證可運作的部分

- Falco 能正確攔截 `room6`/`secret-b` 等 container 內的 syscall：
  default 規則「Terminal shell in container」在這兩次測試中都正確帶出
  **真實的 container ID**（`secret-b` = `3588c38b871e`、`room6` =
  `4b3766ec8d4d`），對應 `proc=bash pname=containerd-shim cmd="bash
  --login"`（即 terminal-gateway 對玩家開的互動式 `docker exec`
  session）。代表 Falco 的事件擷取與部分 container 解析鏈路是通的。

### 4.3 已知限制：`docker exec <room> bash -c "..."` 產生的事件，container context 大多解析不到

`lab/exploits/*.sh` 的 `room_exec`（以及人工的 `docker exec -u player
<room> <cmd>`）全部是「短命的 `docker exec` 子行程」模式。這次 smoke test
中，這類事件絕大多數的 `container.id`／`container.name` 都是
`null`（少數情況是一個不屬於任何 top-level room container 的神秘 ID
`1085f6199000`，後來確認是 room8 內層 DinD daemon 的內部 container）。

**影響範圍**（連帶解釋了下列規則在 smoke test 中沒有如預期觸發）：

| 規則 | 對應 scenario | smoke test 結果 |
|---|---|---|
| `Docker Socket Accessed From Container` | room6/7/9/final/secret-a | 即使對 room6 執行 `docker ps`、`cat /var/run/docker.sock`（確認指令本身成功執行），仍未觸發 |
| `Docker Save Or History Executed` | secret-b | `secret-b.sh` 在 room7 執行 `docker save`/`docker history` 時未觸發 |
| `Tar Extraction Into Tmp Directory` / `Recursive Grep Under Tmp` | secret-b | `secret-b.sh` 對 OCI layer 做 `tar`/`grep` 時未觸發 |

這些規則的 `condition` 都包含 `container`（即 `container.id != host`）。
當 `container.id` 解析為 `null` 時，這個 macro 為 false，規則整體不成立
——即使對應的 syscall（`connect`/`open`/`execve`）事件本身確實發生了。
這與 4.2 的「Terminal shell in container 能正確解出 container ID」形成對比：
推測差異在於 terminal-gateway 開的是**長駐**的互動 session（Falco 啟動時
該 process 已存在於 container 的 cgroup 內，可被正常 enrichment），而
`docker exec ... bash -c "..."` 是**短命**子行程，在 Docker Desktop /
WSL2 + modern eBPF 驅動的組合下，container enrichment 來不及／無法完成。

另外，`Unexpected Child Process In Container Via Docker Exec` 規則本身還有
獨立的邏輯缺口：condition 中 `not proc.name in (bash, sh)` 會排除掉
`docker exec <container> bash -c "<cmd>"` 這種所有 15 支 exploit 腳本共用
的呼叫模式（被注入的子行程 `pname` 是 `bash`，不是 `containerd-shim`/
`runc`）。即使 container context 問題修好，這條規則仍不會對這個模式觸發。

兩個問題的詳細記錄與後續建議見
[`troubleshooting/falco-container-context-not-resolved.md`](../troubleshooting/falco-container-context-not-resolved.md)。

### 4.4 已知雜訊規則

以下規則在沒有任何 exploit 腳本執行的情況下也持續觸發，來源是 host /
Docker Desktop 內部程序（`runc`、`containerd-shim`、`docker-init`、
`fstrim`、`iptables` 等），不代表房間內的攻擊行為：

- **DAC Read Search Capability Used**（標記 `room2`，~每分鐘 27 次以上）
- **Drop and execute new binary in container**（預設規則，主要是
  `1085f6199000`／room8 內層 DinD 的 `sleep 10` healthcheck 迴圈）

`basic` 模式下這兩條規則仍會載入（前者是 `tier_full_only`，後者是 Falco
內建預設規則，不受 `lab_rules.yaml` tier 控制），未來 lab-api 若要以
「規則觸發次數」做量化分析，需要先扣除這類 baseline 雜訊或調整規則的
`condition`（例如為 DAC Read Search Capability Used 加上更嚴格的
`proc.name`/路徑限制）。

### 4.5 結論與下一步

- **Falco 部署本身已可用**：修完 3 個設定/規則 bug 後，Falco 能穩定啟動、
  載入全部規則、輸出 JSON 告警，且確實能看到 room6/secret-b 等 container
  的真實 syscall。
- **`falco_rule_refs` ↔ `lab_rules.yaml` 對照表（第 2 節）的規則名稱與
  tier 標記本身是準確的**（規則確實存在、能載入），但表中多條 `tier_basic`
  /`tier_full_only` 規則在「`docker exec` 短命子行程」這個（目前所有
  exploit 腳本採用的）攻擊模式下**實際不會觸發**，原因是 4.3 的 container
  context 解析缺口，而非規則命名或對照錯誤。
- 後續建議：
  1. 若要在目前環境（Docker Desktop + WSL2 + modern eBPF）下讓這些規則
     真正可用，需要先解決/繞過 container context 解析問題（例如改用
     `proc.pid`/`proc.vpid` 搭配 host 端 `docker top` 結果做關聯，而非
     依賴 Falco 自身的 `container.id` 欄位）。
  2. Raspberry Pi（真實 Linux + 可能改用 kernel module 驅動）上的行為
     可能不同，待硬體到手後重跑本 smoke test 驗證。
  3. `Unexpected Child Process In Container Via Docker Exec` 的
     `not proc.name in (bash, sh)` 排除條件建議在未來修訂規則時一併檢討。

## 4.6 2026-06-14 重測結果：把 `escape-falco` 接進常駐 stack 後，問題大幅緩解

依 4.5 的建議方向①，把 `escape-falco` 合併進主 `docker-compose.yml` 常駐
運行（不再是 smoke test 時才手動啟動的臨時容器），再透過 Lab 前端對
`room2`、`room6`、`secret-b` 各執行一次完整實驗（`POST /api/lab/runs`
會先呼叫 room-manager `reset` 重建房間 container）：

- **4.3 表中記錄「未觸發」的規則，本次全部正確觸發**：`Docker Socket
  Accessed From Container`（room6）、`Unexpected Child Process In
  Container Via Docker Exec`（room6）、`Docker Save Or History
  Executed`（secret-b）。
- room2 的 `falco_rule_refs` 對應規則（`Sudo Exec Of Backup Script`、
  `Root Read Of Secret File Via Spawned Process`、`DAC Read Search
  Capability Used`）也全部觸發。
- `container.name` 仍顯示 `null`，但不影響規則觸發（規則 condition 只用
  到 `container` macro，即 `container.id != host`；`container.id` 本身
  已能正確解析，只是 `container.name` 的名稱對照仍失敗）。

**根因修正**：4.3 的「`docker exec` 短命子行程 container context 大多
解析不到」並非 Docker Desktop/WSL2 + modern eBPF 的固有限制，而是因為
2026-06-13 smoke test 時 Falco 是在 room6/secret-b 等 container **已存在
一段時間後**才手動啟動的，沒能捕捉到 container 的 CREATE 事件以建立
enrichment 對照表。Falco **常駐運行 + container 透過 reset 重建**時，
enrichment 正常運作。

**對 A1（規則條件修正）的結論**：`falco/rules/lab_rules.yaml` 的規則
condition **不需修改**——27 條規則的 `container and` guard 與
`Unexpected Child Process In Container Via Docker Exec` 的
`not proc.name in (bash, sh)` 排除條件，在「Falco 常駐 + reset 重建
container」下都已正確運作。詳細記錄見
[`troubleshooting/falco-container-context-not-resolved.md`](../troubleshooting/falco-container-context-not-resolved.md)
第 8 節。

**已知殘留限制**：因 `container.name`/`container.id` 在 alert output 中
仍為 `null`/`<NA>`，lab-api 無法依「告警屬於哪個 container」過濾，
`run.alerts` 仍是用時間窗口涵蓋當時所有告警（含其他房間/host 程序的
背景雜訊，例如 `DAC Read Search Capability Used`）。這對
`rule_coverage`（只看「該規則是否曾觸發過」）影響有限，但
`triggered_rules` 列表會包含與該場景無關的雜訊規則，前端展示時需註明。

## 4.7 2026-06-14：`Ptrace` 規則被 strace ground-truth pilot 大量觸發

RQ2 的第二種偵測機制對照（pilot，見
[`troubleshooting/strace-ground-truth-pilot.md`](../troubleshooting/strace-ground-truth-pilot.md)）
在 `room6` 用 `strace -f` 包裝 exploit 指令以取得 `execve`/`openat`/
`connect` ground truth。實測發現 `strace -f` 自身對受追蹤行程持續發出
`PTRACE_*` 操作，使 `lab_rules.yaml` 既有的
`Ptrace Attach To Other Process`／`PTRACE attached to process`／
`PTRACE anti-debug attempt` 三條規則被大量觸發——單次 room6 run（4 個
追蹤步驟）即觸發 `Ptrace Attach To Other Process` **8857 次**，遠超其他
規則的觸發次數（個位數~數十）。

這對 `rule_coverage`/`triggered_rules` 本身沒有負面影響（仍只看「是否
觸發過」），但若直接把每筆告警存進 `run.alerts`，會讓
`data/runs.json` 暴增（單次 run 6.1MB）。修復方式是 `lab-api` 新增
`alert_rule_counts`（依規則名稱計數，無上限）與 `MAX_RUN_ALERTS=200`
（`run.alerts` 上限），detection-matrix 改用前者計算
`triggered_rules`。**這也是 RQ2 的一個發現**：規則式 IDS 對「自我
追蹤/除錯工具」與「真正的攻擊性 ptrace 注入」缺乏區分能力，自我
可觀測性手段（strace）與規則式偵測（Falco）並存時會互相產生大量
噪音。詳見 `troubleshooting/strace-ground-truth-pilot.md`。

## 4.8 2026-06-15：`Ptrace` 限流可行性評估 + Falco 重啟風險的 runbook

延續 4.7 與
[`troubleshooting/mass-room-container-oom-kills.md`](../troubleshooting/mass-room-container-oom-kills.md)
第 5 節的兩項後續建議，本次逐一評估其可行性：

**① 對 `Ptrace Attach To Other Process` 加上 rate-limit——評估結果：此
Falco 版本（0.39.2）不支援，且規則層級的排除方案風險過高，列為未來工作**

- 用 `falco --config-schema` 檢查設定 schema，原先設想的全域
  `outputs.rate` / `outputs.max_burst`（舊版 Falco/sysdig 的告警節流
  機制）**在 0.39.2 中不存在**——schema 中唯一含 `rate`/`max_burst`
  的物件是 `syscall_event_drops`（處理 syscall buffer 掉包，與告警
  節流無關）。`falco --rule-schema` 也未提供逐規則的
  rate/max_burst 欄位。全域節流路線不可行。
- 規則條件層級的替代方案——在 `Ptrace Attach To Other Process` 加上
  `and container.name != "room6"` 排除 strace ground-truth pilot 的
  自我追蹤——因第 4.3 節已記錄 `container.name`/`container.id` 對
  `docker exec` 短命行程經常解析為 `null`，而 Falco 對 `!=` 比較在
  欄位為 `null` 時通常視為不成立，此排除條件可能：(a) 對 room6 的
  ptrace 事件不生效（`container.name` 本身就是 null，不等於
  `"room6"` 這個比較結果為 false，規則整體仍為 false → 不觸發，剛好
  「看似有效」），但 (b) 若 room3 真正的攻擊事件 `container.name` 也
  是 `null`，同一個排除條件會「順便」讓 room3 的偵測也失效——而要
  驗證這兩種情況分別會怎樣，必須改規則後重啟 Falco 才能觀察真實
  `output_fields`，與下面 ② 的「避免不必要重啟」直接衝突。
  **結論**：在沒有重啟驗證迴圈的前提下，不安全地修改這條規則風險
  大於收益，列為未來工作（需要專門的一次性實驗：改規則 → 重啟 →
  分別觸發 room3 與 room6 → 比對 `output_fields.container.*` →
  視結果決定條件寫法）。

**② 避免不必要的 `escape-falco` 重啟——評估結果：屬於硬限制（無法
熱重載），已寫入下方 runbook**

- `falco --help` 未提供任何設定/規則熱重載選項（無 `--reload`、無
  SIGHUP 處理）。換言之，**任何 `falco.yaml`/`lab_rules.yaml` 的修改
  都必須靠 `docker restart escape-falco`（或
  `docker compose up -d escape-falco`）生效**——這證實了
  `mass-room-container-oom-kills.md` 第 5.3 點不是「建議」而是
  「目前唯一手段，且每次都有觸發 mass OOM-kill 的風險」。
- **runbook（修改 Falco 設定/規則時請依此順序操作）**：
  1. 確認 `docker-compose.yml` 中 15 個房間 + `locked-server`/
     `secret-server` 皆已套用 `mem_limit`（2026-06-15 已完成，見
     `mass-room-container-oom-kills.md` 第 5.1 點）——這不能避免
     `escape-falco` 重啟造成 host 資源尖峰，但能讓 OOM-killer 的影響
     範圍可預期（單一容器最多 256MB），不會無限蔓延
  2. 避免在「15×N baseline/exploit 批次執行」後立刻重啟——批次執行
     本身已是一次負載尖峰，疊加重啟尖峰會放大 OOM 風險（本次 session
     已實測發生兩波）
  3. 重啟後立即跑 `docker exec <room> bash -c 'cat /etc/motd'` 之類的
     sanity check + `docker ps -a` 確認沒有新增 `Exited` 容器，再繼續
     後續操作
  4. 2026-06-15 觀察：`escape-falco` 已連續運行 12+ 小時，最新一筆
     log 的 `output_fields.time` 落後當下時間約 **11.7 小時**（比
     2.1 節記錄的 37 分鐘積壓更嚴重，會隨運行時間累積）。若要做最終
     demo/資料收集前的偵測延遲量測，建議排定**一次性、計畫內**的
     `escape-falco` 重啟以清空積壓——但依①的結論，這次重啟不應同時
     夾帶規則改動（避免把「重啟造成的 OOM」與「規則改動造成的偵測
     失效」混在一起，難以歸因）
