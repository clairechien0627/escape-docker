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
  - --modern-bpf
  - -c
  - /etc/falco/falco.yaml
  # basic 模式請加上：
  # - -T
  # - tier_full_only
```

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
`http://lab-api:4100/api/lab/falco-webhook`（Phase 2 才會實作該端點），
同時保留 `stdout_output` 方便部署初期直接看 log 除錯
（`docker compose logs -f falco`）。在 lab-api webhook 完成前，
`http_output` 連線失敗不影響 Falco 本身運作，只是告警不會被轉發。
