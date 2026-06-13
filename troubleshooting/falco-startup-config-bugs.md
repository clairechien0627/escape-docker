# Falco 監控容器首次啟動：3 個阻擋啟動/規則載入的設定問題

> **日期：** 2026-06-13

## 1. 緣由

為了驗證 `falco/` 下的設定與 `lab/rules/lab_rules.yaml` 是否真的可用
（"falco smoke test"），第一次以
`docker compose -f docker-compose.yml -f
falco/docker-compose.falco.example.yml up -d --force-recreate falco`
啟動 `escape-falco`（`falcosecurity/falco-no-driver:latest`，Falco
0.39.2）。連續遇到 3 個問題，導致 container 持續 crash-loop 或規則完全
無法載入，逐一排查修正後才成功進入穩定運作並輸出 JSON 告警。

## 2. 根因與修復

### 問題一：`--modern-bpf` 旗標在 Falco 0.39+ 已移除

**現象**：container 不斷 restart，`docker logs escape-falco` 顯示：

```
Error: Option 'modern-bpf' does not exist
```

**根因**：`docker-compose.falco.example.yml` 的 `command` 沿用舊版
Falco 的 `--modern-bpf` CLI 旗標。Falco 0.39.2（`falco-no-driver` image
目前版本）已移除此旗標；該 image 內建的 `/etc/falco/falco.yaml` 預設
`engine.kind` 即為 `modern_ebpf`，本就不需要額外旗標指定驅動。

**修復**：移除 `command` 中的 `- --modern-bpf` 一行，並在註解中說明
驅動選擇邏輯：

```yaml
command:
  - /usr/bin/falco
  - -c
  - /etc/falco/falco.yaml
```

### 問題二：`lab_rules.yaml` 的 `fd.sip` 用了 `ipaddr` 欄位不支援的語法

**現象**：問題一修復後，Falco 啟動時 `rule_loader.cpp` 報錯，
`lab_rules.yaml` 的全部 31 條規則整批載入失敗：

```
LOAD_ERR_COMPILE_CONDITION: 'startswith' operator not supported
for ip address and network filters
```

**根因**："Outbound Connection To Secret Network Subnet" 規則
（對應 room9 `internal_network_access`）的 condition 寫成：

```yaml
condition: >
  evt.type = connect and container and
  fd.sip startswith "172.22."
```

`fd.sip` 是 `ipaddr` 型別欄位，不支援 `startswith` 運算子。改成
`fd.sip in (172.22.0.0/24)` 仍報錯
`LOAD_ERR_COMPILE_CONDITION: unrecognized IPv4 address 172.22.0.0/24`
——`ipaddr` 型別欄位的 `in` 運算子不解析 CIDR 表示法。

**修復**：改用 Falco 專門提供的 `FILTER_ONLY` 子網比對欄位 `fd.snet`：

```yaml
condition: >
  evt.type = connect and container and
  fd.snet="172.22.0.0/24"
```

### 問題三：自訂 `falco.yaml` 覆蓋 image 內建設定後缺少 `engine.kind`，退回不存在的 `kmod` 驅動

**現象**：問題二修復後規則成功載入，但隨即報錯：

```
Error: ... error opening device /host/dev/falco0.
Make sure this device exists, or that the falco module is loaded.
```

**根因**：`docker-compose.falco.example.yml` 把 `falco/falco.yaml`
mount 到 `/etc/falco/falco.yaml`，**完全覆蓋**掉 image 內建那份設定檔
（其中預設 `engine.kind: modern_ebpf`）。我們的自訂 `falco.yaml` 沒有
`engine:` 區塊，Falco 因此退回程式編譯內建的預設驅動 `kmod`（kernel
module），而 `falco-no-driver` image 沒有附 kernel module，找不到
`/dev/falco0`，啟動失敗。

**修復**：在 `falco/falco.yaml` 明確加上：

```yaml
engine:
  kind: modern_ebpf
```

## 3. 驗證

依序套用三個修復後重新啟動：

```bash
docker compose -f docker-compose.yml -f \
  falco/docker-compose.falco.example.yml up -d --force-recreate falco
docker logs escape-falco --tail 30
```

確認：

- 不再出現 `Error: Option 'modern-bpf' does not exist`
- 不再出現 `rule_loader.cpp` 的 `LOAD_ERR_COMPILE_CONDITION` 錯誤
- 不再出現 `/host/dev/falco0` 相關錯誤
- log 出現 `Loaded event sources: ...`，並開始持續輸出
  JSON Lines 格式告警（`stdout_output`）

進一步在 `escape-falco` 啟動穩定的狀態下，跑
`lab/exploits/room6.sh` 與 `lab/exploits/secret-b.sh`，確認 Falco 持續
正常輸出告警（未再 crash），smoke test 的後續發現見
`falco/README.md` 第 4 節。

## 4. 修改檔案清單

| 檔案 | 變更 |
|---|---|
| `falco/docker-compose.falco.example.yml` | 移除 `command` 中的 `- --modern-bpf`；補充驅動選擇相關註解 |
| `falco/rules/lab_rules.yaml` | "Outbound Connection To Secret Network Subnet" 規則的 condition 由 `fd.sip startswith "172.22."` 改為 `fd.snet="172.22.0.0/24"` |
| `falco/falco.yaml` | 新增 `engine: kind: modern_ebpf` 區塊及說明註解 |
| `falco/README.md` | 同步移除範例 `command` 中的 `--modern-bpf`，並補充第 4 節 smoke test 結果記錄 |

## 5. 相關問題

這 3 個問題都是「第一次實際啟動 Falco」才會遇到的設定問題，修復後
Falco 本身運作正常。smoke test 過程中另外發現的「規則未如預期觸發」的
問題（container context 解析、規則邏輯缺口）是**獨立的根因**，記錄於
[[falco-container-context-not-resolved]]。
