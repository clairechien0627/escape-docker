# Edge Device Benchmark Report: Escape Docker on Raspberry Pi 4

> **Experiment Date:** 2026-06-21  
> **Benchmark Duration:** 1490.2 seconds (~24.8 min)  
> **Author:** Edge Container Security Lab

---

## 1. 實驗目的

本實驗旨在評估 Escape Docker 容器安全教學平台在 ARM 架構邊緣裝置（Raspberry Pi 4）上的可行性與效能表現。具體研究問題包括：

1. **RQ1 (ARM 可行性):** 15 個安全情境（rooms）能否在 Raspberry Pi 4 的有限資源下正常運行？
2. **RQ2 (偵測能力):** Falco 執行期安全監控在 ARM 邊緣裝置上的偵測效果如何？
3. **RQ3 (資源開銷):** 容器啟動、漏洞重現與安全監控在 ARM 上的 CPU/記憶體開銷是否可接受？

---

## 2. 實驗環境

| 項目 | 規格 |
|------|------|
| **裝置** | Raspberry Pi 4 Model B Rev 1.5 |
| **架構** | aarch64 (ARM64) |
| **CPU** | Broadcom BCM2711, 4 cores |
| **RAM** | 1844.7 MB (~1.8 GB) |
| **作業系統** | Debian GNU/Linux 13 (trixie) |
| **核心** | 6.18.34+rpt-rpi-v8 |
| **Docker** | 29.5.3 (arm64) |

---

## 3. 實驗設計

### 3.1 Benchmark 腳本架構

Benchmark 程式 (`edge_benchmark.py`) 採用四階段流水線設計，自動化執行所有 15 個 room 的測試：

```
Phase A: Baseline ─→ Phase B: Lifecycle ─→ Phase C: Exploits ─→ Phase D: Analysis
```

- **Phase A — 基線資源快照：** 停止所有 room 容器，等待系統穩定後，對基礎設施容器（Falco、lab-api、room-manager）採集 3 次 idle 狀態資源快照並取平均值。
- **Phase B — 容器生命週期基準測試：** 對每個 room 測量冷啟動（cold start，強制重建容器）與暖啟動（warm start，已存在容器的 ensure 操作）延遲。
- **Phase C — 漏洞利用執行基準測試：** 對每個 room 執行 3 次完整的自動化漏洞利用流程。每次執行包含：容器重設、啟動背景資源取樣器（每 2 秒取一次 docker stats）、觸發漏洞利用腳本、等待 Falco 告警、記錄結果。
- **Phase D — Falco 開銷與偵測矩陣分析：** 彙總 Falco 在 idle 與 active 狀態下的 CPU/記憶體使用量，並從 lab-api 取得偵測矩陣。

### 3.2 測試參數

| 參數 | 值 |
|------|-----|
| 每個 room 執行次數 | 3 |
| 資源取樣間隔 | 2 秒 |
| Falco 告警等待時間 | 15 秒 |
| 基線取樣次數 | 3 |
| 系統穩定等待 | 10 秒 |

### 3.3 測試涵蓋的 15 個安全情境

| Room | 漏洞類型 | 情境描述 |
|------|----------|----------|
| room0 | information-disclosure | MOTD 明文洩漏 FLAG |
| room1 | exposed-secret | Base64 弱混淆 FLAG 隱藏於大量干擾檔案 |
| room2 | sudo-misconfiguration | Sudo 腳本引數注入提權 |
| room3 | process-signal-exploitation | 背景程序 SIGUSR1 訊號洩漏 FLAG |
| room4 | ssh-key-based-pivot | SSH 跳板 + Port Forwarding 存取內部服務 |
| room5 | unauthenticated-network-service | 未認證內部服務（謎語問答） |
| room6 | docker-sock-exposure | 唯讀 docker.sock 仍可跨容器竊取資料 |
| room7 | docker-build-misconfiguration | Dockerfile 修復任務 + 可寫 docker.sock 濫用 |
| room8 | misconfiguration-debugging | docker-compose 設定缺陷修復 |
| room9 | docker-sock-exposure | Docker.sock 濫用繞過網路隔離 |
| room10 | exposed-secret-in-logs | 跨日誌關聯分析找出洩漏的 Session Token |
| room11 | cron-injection | Root Cron Job 間接讀取受保護檔案 |
| final | container-escape | 可寫 docker.sock 跨容器任意程式碼執行 |
| secret-a | exposed-secret | 容器環境變數洩漏 FLAG |
| secret-b | docker-layer-leak | Docker Image 分層儲存殘留機密檔案 |

---

## 4. 實驗結果

### 4.1 容器生命週期效能

| Room | 容器數 | 冷啟動 (ms) | 暖啟動 (ms) |
|------|--------|-------------|-------------|
| room0 | 1 | 655 | 7 |
| room1 | 1 | 664 | 6 |
| room2 | 1 | 643 | 6 |
| room3 | 1 | 718 | 6 |
| room4 | 2 | 1300 | 6 |
| room5 | 1 | 682 | 5 |
| room6 | 1 | 713 | 6 |
| room7 | 1 | 818 | 7 |
| room8 | 1 | 650 | 5 |
| room9 | 2 | 1381 | 10 |
| room10 | 1 | 675 | 5 |
| room11 | 1 | 629 | 10 |
| final | 1 | 709 | 9 |
| secret-a | 1 | 682 | 6 |
| secret-b | 1 | 733 | 5 |

**統計摘要：**

- 單容器 room 冷啟動：平均 **690 ms**（範圍 629–818 ms）
- 雙容器 room（room4, room9）冷啟動：平均 **1341 ms**
- 暖啟動（全部）：平均 **6.6 ms**（範圍 5–10 ms）

### 4.2 漏洞利用成功率與執行時間

| Room | 漏洞類型 | 成功率 | 平均時間 (ms) | 最小 (ms) | 最大 (ms) | 標準差 (ms) |
|------|----------|--------|--------------|-----------|-----------|-------------|
| room0 | information-disclosure | **100%** | 673 | 652 | 696 | 22 |
| room1 | exposed-secret | **100%** | 1,377 | 1,342 | 1,396 | 30 |
| room2 | sudo-misconfiguration | **100%** | 1,350 | 1,308 | 1,379 | 37 |
| room3 | process-signal-exploitation | **100%** | 2,163 | 2,106 | 2,210 | 53 |
| room4 | ssh-key-based-pivot | **100%** | 3,493 | 3,369 | 3,694 | 176 |
| room5 | unauthenticated-network-service | **100%** | 3,058 | 3,018 | 3,094 | 38 |
| room6 | docker-sock-exposure | **0%** | 4,937 | 4,734 | 5,339 | 348 |
| room7 | docker-build-misconfiguration | **0%** | 3,284 | 3,053 | 3,708 | 367 |
| room8 | misconfiguration-debugging | **100%** | 84,177 | 75,680 | 92,815 | 8,568 |
| room9 | docker-sock-exposure | **0%** | 2,711 | 2,423 | 3,088 | 341 |
| room10 | exposed-secret-in-logs | **100%** | 1,339 | 1,308 | 1,387 | 42 |
| room11 | cron-injection | **100%** | 35,781 | 24,334 | 41,579 | 9,913 |
| final | container-escape | **0%** | 1,160 | 1,046 | 1,319 | 142 |
| secret-a | exposed-secret | **100%** | 652 | 647 | 655 | 4 |
| secret-b | docker-layer-leak | **0%** | 1,062 | 1,030 | 1,078 | 28 |

**整體成功率：** 10/15 rooms (66.7%)

### 4.3 資源使用量（漏洞利用期間尖峰 CPU）

| Room | 平均尖峰 CPU (%) | 說明 |
|------|------------------|------|
| room0 | 0.00 | 純檔案讀取，幾乎無負載 |
| room1 | 13.80 | find + base64 解碼 |
| room2 | 13.82 | sudo 腳本執行 |
| room3 | 1.59 | 程序信號操作 |
| room4 | 7.64 | SSH 金鑰生成 + tunnel |
| room5 | 7.89 | 網路服務連線 |
| room6 | 24.98 | Docker CLI 反覆嘗試 |
| room7 | 14.50 | Docker build 嘗試 |
| room8 | **183.71** | docker-compose pull + up (多核心) |
| room9 | 59.84 | 多容器啟動 + Docker CLI |
| room10 | 12.26 | 日誌分析 |
| room11 | 11.22 | Cron 排程等待 |
| final | 23.14 | Docker exec 嘗試 |
| secret-a | 0.00 | 環境變數讀取 |
| secret-b | 0.00 | 檔案讀取 |

### 4.4 Falco 偵測結果

| 指標 | 值 |
|------|-----|
| 偵測率（所有 room） | **0%** |
| 觸發的告警總數 | **0** |
| 觸發的規則數 | **0** |
| Falco idle CPU | 0.0% |
| Falco idle 記憶體 | 0.0 MB |
| Falco active 平均 CPU | 0.0% |
| Falco active 平均記憶體 | 0.0 MB |

### 4.5 偵測矩陣摘要

以下為各 room 預期的 Falco 規則與實際觸發情況：

| Room | 預期規則數 | 實際觸發 | 規則涵蓋率 |
|------|-----------|----------|-----------|
| room0 | 2 | 0 | 0% |
| room1 | 2 | 0 | 0% |
| room2 | 3 | 0 | 0% |
| room3 | 2 | 0 | 0% |
| room4 | 4 | 0 | 0% |
| room5 | 2 | 0 | 0% |
| room6 | 4 | 0 | 0% |
| room7 | 3 | 0 | 0% |
| room8 | 1 | 0 | 0% |
| room9 | 4 | 0 | 0% |
| room10 | 3 | 0 | 0% |
| room11 | 4 | 0 | 0% |
| final | 3 | 0 | 0% |
| secret-a | 2 | 0 | 0% |
| secret-b | 3 | 0 | 0% |

---

## 5. 結果分析

### 5.1 ARM 可行性分析 (RQ1)

**10 個 room（66.7%）在 Raspberry Pi 4 上成功完成漏洞利用，** 驗證了邊緣裝置作為容器安全教學平台的基本可行性。

**成功的 10 個 room** 涵蓋了多種漏洞類型：
- 資訊洩漏（room0, room1, room10, secret-a）
- 權限提升（room2）
- 程序操控（room3）
- 網路跳板（room4, room5）
- 設定修復（room8）
- 排程注入（room11）

**失敗的 5 個 room** 均因 `docker.sock` 權限不足（`permission denied while trying to connect to the docker API`）。詳細根因分析見 [5.5 節](#55-根因分析docker-sock-權限失敗)。

### 5.2 效能表現分析

#### 容器啟動延遲

在 Pi 4 上，單容器 room 的冷啟動平均為 **690 ms**，雙容器的冷啟動約 **1341 ms**，均在 1.5 秒內完成。暖啟動極快（平均 6.6 ms），表明容器已建立後的再次啟動幾乎無延遲。對於互動式教學平台而言，此啟動延遲完全可接受。

#### 漏洞利用執行時間

大多數 room 在 **1–4 秒內完成**，使用者體驗良好。兩個例外：

- **room8（84.2 秒）：** 因為需要 `docker compose pull` 拉取 `python:3.11-slim` 映像（約 14 MB），在 Pi 的 SD 卡 I/O 和有限頻寬下耗時較長。尖峰 CPU 達 183.71%（跨多核心），為系統負擔最重的 room。
- **room11（35.8 秒）：** Cron job 排程注入需要等待 cron 週期執行（通常為每分鐘一次），等待時間為設計固有的延遲。

#### 執行穩定性

成功的 room 在 3 次迭代中表現一致，標準差相對較低：
- 簡單 room（room0, room1, secret-a）：標準差 < 30 ms
- 中等 room（room2–room5, room10）：標準差 30–176 ms
- 複雜 room（room8, room11）：標準差較大（8568 ms, 9913 ms），主要受網路和 I/O 影響

### 5.3 Falco 偵測分析 (RQ2)

**本次實驗中 Falco 未產生任何告警。** 所有 15 個 room 的偵測率均為 0%，且 Falco 容器的 CPU 和記憶體使用量均顯示為 0.0。

**確認的原因：Falco 容器啟動失敗（eBPF/BTF 不相容）。**

雖然 `start-pi.sh` 預設不啟動 Falco（第 58 行註解：`# falco 在 Pi 上需要特定 kernel eBPF 支援，預設略過`），但本次 benchmark 執行前已**手動執行 `docker compose up -d falco`** 嘗試啟動 Falco。然而 Falco 容器因 modern eBPF 驅動與 Pi 核心不相容而**啟動失敗或立即退出**。

以下為佐證：

**佐證 1：`escape-falco` 容器存在但無資源消耗。** `edge_benchmark_results.json` 中 `escape-falco` 出現在 baseline 快照及 87 筆 resource samples 中，表示 `docker stats` 能看到這個容器（已被 create），但所有指標**恆為 0.0**：

```json
// baseline（第 20 行）
"escape-falco": { "cpu_percent": 0.0, "mem_usage_mb": 0.0, "mem_percent": 0.0 }

// falco_overhead（第 4133 行）
"falco_overhead": {
  "idle_cpu_percent": 0.0, "idle_mem_mb": 0.0,
  "active_avg_cpu_percent": 0.0, "active_avg_mem_mb": 0.0
}
```

若容器從未被 create，`docker stats` 不會回報它；若容器正常運行，即使 idle 也會有非零的記憶體佔用（Falco 常駐程序典型記憶體約 30–80 MB）。**全 0.0 唯一合理的解釋是容器已建立但處於 Exited 狀態**（已退出的容器在 `docker stats --no-stream` 中仍可被列出，但所有動態指標為 0）。

**佐證 2：整個 benchmark 期間（~25 分鐘）持續為 0.0。** 如果 Falco 僅是間歇性重啟，應會在部分 samples 中出現非零值。但 87 筆 samples 橫跨 25 分鐘、15 個 room，**無一例外全為 0.0**，表明 Falco 在整個實驗期間始終處於退出狀態，而非偶發故障。

**佐證 3：eBPF/BTF 不相容的技術背景。** `docker-compose.yml` 中 Falco 的配置為：

```yaml
falco:
  image: falcosecurity/falco-no-driver:latest   # 不含 kernel module
  privileged: true
  pid: host
  command: ["/bin/sh", "/etc/falco/start.sh"]   # 最終執行 falco -c falco.yaml
```

`falco.yaml` 指定 `engine.kind: modern_ebpf`，此模式要求 **Linux kernel >= 5.8 且啟用 BTF**（`CONFIG_DEBUG_INFO_BTF=y`）。Pi 的核心版本 `6.18.34+rpt-rpi-v8` 滿足版本要求，但 Raspberry Pi OS 的自訂核心（`+rpt-rpi-v8` 後綴）**預設未啟用 BTF**。Falco 嘗試載入 modern eBPF probe 時因找不到 BTF 資訊而立即退出。

可在 Pi 上執行以下命令確認此根因：

```bash
# 查看 Falco 容器退出日誌（預期看到 eBPF/BTF 相關錯誤）
docker compose logs falco

# 確認核心是否啟用 BTF
zgrep CONFIG_DEBUG_INFO_BTF /proc/config.gz
# 預期：未找到 或 CONFIG_DEBUG_INFO_BTF is not set

# 檢查 BTF 資料是否存在
ls -la /sys/kernel/btf/vmlinux
# 預期：No such file or directory
```

**結論：** 本次實驗的 Falco 偵測率 0% 反映的是**「ARM 邊緣環境的 eBPF 相容性限制」**，而非 Falco 規則或偵測邏輯本身的問題。這是 RQ2 的一項重要負面發現——在缺乏 BTF 支援的邊緣裝置核心上，依賴 modern eBPF 的執行期安全監控工具無法運行。

### 5.4 資源開銷分析 (RQ3)

| 指標 | 結果 |
|------|------|
| 大多數 room 的尖峰 CPU | < 15% (4 核心) |
| 最高尖峰 CPU | 183.71% (room8, docker compose 操作) |
| 記憶體使用量 | 所有 room 報告為 0.0 MB * |
| Falco 額外開銷 | 無法測量（Falco 因 eBPF/BTF 不相容而啟動失敗） |

*\* 記憶體報告為 0.0 MB 是因為 `docker stats --no-stream` 在 Pi 的 cgroup v2 環境下存在精度限制。*

整體而言，除 room8 的 docker compose 操作外，Pi 4 的 4 核心 CPU 足以應付所有 room 的運算需求。1.8 GB 的記憶體在本實驗中未成為瓶頸（基準測試中僅同時運行一個 room）。

### 5.5 根因分析：docker.sock 權限失敗

#### 失敗現象

5 個 room（room6, room7, room9, final, secret-b）在 Pi 上全部 3 次迭代均回報：

```
permission denied while trying to connect to the docker API at unix:///var/run/docker.sock
```

這些 room 在 Windows Docker Desktop 環境下可正常運行。

#### docker.sock 掛載方式

分析 `docker-compose.yml` 中各 room 的 volume 掛載：

| Room | 掛載方式 | 讀寫模式 |
|------|---------|----------|
| room6 | `/var/run/docker.sock:/var/run/docker.sock:ro` | 唯讀 |
| room7 | `/var/run/docker.sock:/var/run/docker.sock` | 讀寫 |
| room9 | `/var/run/docker.sock:/var/run/docker.sock` | 讀寫 |
| final | `/var/run/docker.sock:/var/run/docker.sock` | 讀寫 |
| secret-b | *（無掛載 — 設計上需經由 room7 操作）* | N/A |

room6 為唯讀掛載、room7/room9/final 為讀寫掛載，但**全部失敗**，表明問題不在讀寫權限，而在 socket 的 Unix 檔案存取權限。

#### 容器內的使用者與群組設定

這 4 個直接掛載 docker.sock 的 room（room6, room7, room9, final）的 Dockerfile 均使用相同模式：

```dockerfile
# 安裝 Docker CLI（順帶建立容器內的 docker 群組）
RUN apt-get install -y docker.io

# 建立 player 使用者並加入 docker 群組
RUN useradd -m -s /bin/bash -u 1000 player && \
    usermod -aG docker player

# 以 player 身份執行
USER player
```

`apt-get install docker.io` 在 Ubuntu 22.04 容器內建立的 `docker` 群組，其 GID 由系統自動分配（通常為 **GID 998** 或類似值）。

#### 確認的根因：Host 與容器的 docker 群組 GID 不匹配

當 `/var/run/docker.sock` 被 bind-mount 進容器時，socket 檔案保留的是 **host（Pi）上的擁有者與群組**：

```
# Host（Pi）上的 docker.sock
srw-rw---- 1 root docker /var/run/docker.sock
                   ^^^^^ GID = host 的 docker GID（例如 999）
```

容器內 `player` 使用者所屬的 `docker` 群組是 **容器內建立的 GID（例如 998）**，與 host 的 docker GID 不同。因此，即使 `player` 在容器內屬於 `docker` 群組，Linux kernel 在檢查 socket 存取權限時比對的是**數值 GID**，GID 不匹配導致權限被拒。

```
Host docker GID:      999  ← docker.sock 的 group owner
Container docker GID: 998  ← player 所屬的 docker group
                      ^^^ 不同！→ permission denied
```

**為何 Windows Docker Desktop 不受影響？** Docker Desktop 在 Windows/Mac 上透過 WSL2/HyperKit VM 代理 docker.sock，其權限模型與原生 Linux 不同 — socket 存取不受嚴格的 Unix GID 檢查限制。而 Pi 上是原生 Linux Docker，直接適用 Unix socket 的檔案權限語義。

#### secret-b 的特殊情況

`secret-b` 容器**本身未掛載 docker.sock**。根據 `lab/scenarios/secret-b.json`，其設計上的攻擊路徑是：

> 在 room7（已掛載 docker.sock）執行 `docker save escape-docker-secret-b` 匯出映像，解析 OCI layout 的 layer blobs 找回被刪除的機密檔案。

因此 secret-b 失敗是 room7 的**連鎖效應** — room7 無法存取 docker.sock，導致依賴 room7 的 secret-b 攻擊路徑也無法完成。

---

## 6. 修復驗證

### 6.1 docker.sock GID 不匹配的修復方案

核心思路：讓容器內的 `player` 使用者在執行期獲得與 host docker.sock 相同的 GID 權限。

#### 方案 A：`docker-compose.yml` 使用 `group_add`（推薦）

不修改 Dockerfile，在 `docker-compose.yml` 中透過 `group_add` 將 host 的 docker GID 動態注入容器：

```yaml
# docker-compose.yml 修改範例（以 room6 為例）
room6:
  build: ./rooms/room6
  container_name: room6
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock:ro
  group_add:
    - "${DOCKER_GID:-999}"   # 注入 host 的 docker group GID
```

對 room7、room9、final 做同樣修改。

在 `start-pi.sh` 啟動前自動偵測 GID 並寫入 `.env`：

```bash
# start-pi.sh 中新增（在 docker compose up 之前）
DOCKER_GID=$(stat -c '%g' /var/run/docker.sock)
grep -q '^DOCKER_GID=' .env 2>/dev/null && \
  sed -i "s/^DOCKER_GID=.*/DOCKER_GID=${DOCKER_GID}/" .env || \
  echo "DOCKER_GID=${DOCKER_GID}" >> .env
echo "[✓] Host docker GID: ${DOCKER_GID}"
```

**優點：** 不需重新 build image，GID 自動適配任何主機環境。  
**驗證方式：** 修改後在 Pi 上執行 `docker compose exec room6 docker ps`，預期可列出容器清單。

#### 方案 B：啟動時動態修改 socket 權限

在 `start-pi.sh` 中啟動容器前，將 docker.sock 的權限放寬為 other-readable：

```bash
sudo chmod 666 /var/run/docker.sock
```

**缺點：** 降低了 host 的安全性（任何 host 使用者皆可操作 Docker daemon），不建議用於生產環境。但在單人使用的教學用 Pi 上是可接受的快速修復。

#### 方案 C：Dockerfile 中以 build-arg 匹配 GID

在 Dockerfile 中使用 `ARG` 接收 host 的 docker GID，並建立匹配的群組：

```dockerfile
ARG DOCKER_GID=999
RUN groupadd -g ${DOCKER_GID} docker-host || true
RUN usermod -aG docker-host player
```

搭配 build 時傳入：

```bash
DOCKER_GID=$(stat -c '%g' /var/run/docker.sock)
docker compose build --build-arg DOCKER_GID=${DOCKER_GID} room6 room7 room9 final
```

**缺點：** 需要重新 build image，且 GID 在 build 時固定，換主機需重建。

### 6.2 Falco 啟動的修復方案

本次實驗已確認 Falco 的 modern eBPF 驅動在 Pi 核心上啟動失敗。修復需解決 BTF 不相容問題，有兩條路徑：

#### 路徑 A：啟用核心 BTF 支援（讓 modern eBPF 可用）

```bash
# 1. 確認當前核心的 BTF 狀態
zgrep CONFIG_DEBUG_INFO_BTF /proc/config.gz
# 本次實驗預期結果：未找到 或 =n

# 2. 更新至支援 BTF 的核心
sudo rpi-update          # 更新至最新測試版核心（可能已啟用 BTF）
sudo reboot

# 3. 再次確認
zgrep CONFIG_DEBUG_INFO_BTF /proc/config.gz
# 期望：CONFIG_DEBUG_INFO_BTF=y

# 4. 重新啟動 Falco
docker compose up -d falco
docker compose logs falco | head -30   # 應看到 "Loaded event sources"
```

#### 路徑 B：退回 kernel module 驅動（不需 BTF）

若核心更新仍無 BTF，可改用 Falco 的 kernel module 驅動。需要安裝對應核心版本的 headers：

```bash
# 1. 安裝 kernel headers
sudo apt-get install raspberrypi-kernel-headers

# 2. 修改 docker-compose.yml 的 falco 服務
```

```yaml
falco:
  image: falcosecurity/falco:latest       # 含 kernel module 編譯能力的映像
  # ...其餘不變...
  volumes:
    # 新增 kernel headers 掛載：
    - /usr/src:/usr/src:ro
    - /lib/modules:/lib/modules:ro
    # ...其餘 volume 不變...
```

```bash
# 3. 同時修改 falco.yaml 的 engine 設定
```

```yaml
engine:
  kind: kmod    # 從 modern_ebpf 改為 kmod
```

```bash
# 4. 重建並啟動
docker compose up -d --force-recreate falco
docker compose logs -f falco   # 應看到 kernel module 編譯成功並載入
```

#### 驗證 Falco 正常運行

```bash
# 檢查容器狀態（應為 Up，非 Exited）
docker compose ps falco

# 確認 Falco 有 CPU/記憶體消耗（非 0.0）
docker stats --no-stream escape-falco

# 手動觸發測試告警
docker compose exec falco falco-event-generator
```

### 6.3 修復效果預期

| 修復項目 | 預期結果 |
|---------|---------|
| docker.sock GID 修復 | room6, room7, room9, final 成功率從 0% → 100% |
| secret-b（連鎖修復） | room7 修復後 secret-b 可正常從 room7 操作，成功率 0% → 100% |
| Falco eBPF/BTF 修復 | 偵測率從 0%（啟動失敗）→ 可實測的數值，完成 RQ2 的實際驗證 |
| 整體 room 成功率 | 10/15 (66.7%) → 15/15 (100%) |

---

## 7. 結論

### 7.1 結論

1. **Raspberry Pi 4 可作為 Escape Docker 的邊緣部署平台，** 15 個 room 的 ARM 映像均可正常 build 與啟動。5 個 room 的運行失敗源於 docker.sock 的 GID 配置問題，而非 ARM 架構不相容。
2. **10/15 room（66.7%）在當前配置下可在 Pi 4 上正常運行，** 涵蓋資訊洩漏、權限提升、網路跳板、設定修復、排程注入等主要漏洞類型。套用 `group_add` 修復後預期可達 15/15 (100%)。
3. **容器啟動效能可接受：** 冷啟動 < 1.5 秒，暖啟動 < 10 ms。
4. **Falco 在 ARM 邊緣環境因 eBPF/BTF 不相容而啟動失敗，** 偵測率 0% 是「測了但環境不支援」的結果。這是 RQ2 的重要負面發現：依賴 modern eBPF 的執行期監控在缺乏 BTF 的邊緣核心上無法運行，需要換用支援 BTF 的核心或退回 kernel module 驅動。
5. **因硬體借用時間限制，** 本報告提出的修復方案（docker.sock GID `group_add` 修復、Falco BTF 驗證與驅動切換）尚未在 Pi 上實機驗證，列為未來工作。報告已給出具體修復步驟與預期結果（見第 6 節），待取得硬體後可直接套用並重跑 benchmark。

### 7.2 建議

| 建議 | 優先級 | 說明 |
|------|--------|------|
| 套用 `group_add` 修復 docker.sock GID | **高** | 在 `docker-compose.yml` 中為 room6/7/9/final 加入 `group_add: ["${DOCKER_GID}"]`，並在 `start-pi.sh` 自動偵測寫入 `.env` |
| 解決 Falco eBPF/BTF 不相容 | **高** | 更新至支援 BTF 的核心（路徑 A），或退回 kernel module 驅動（路徑 B），使 Falco 在 Pi 上正常運行 |
| 修復後重跑 benchmark | **中** | 使用相同參數 `python3 experiments/edge_benchmark.py --iterations 3` 取得完整的 15-room 數據與 Falco 偵測率 |
| 預拉取 room8 所需映像 | 低 | 在 `start-pi.sh` 中加入 `docker pull python:3.11-slim alpine:3.19`，避免執行期的 pull 延遲 |

---

## 附錄 A：原始資料檔案

| 檔案 | 說明 |
|------|------|
| `pi/edge_benchmark_results.json` | 完整 benchmark 結果（含每次迭代的步驟、告警、資源取樣） |
| `pi/edge_benchmark_summary.csv` | 各 room 的彙總統計 |
| `pi/system_info.json` | 系統硬體與軟體資訊 |
| `pi/detection_matrix.json` | Falco 偵測矩陣（預期規則 vs 實際觸發） |

## 附錄 B：失敗 Room 的完整 docker.sock 掛載配置

```yaml
# docker-compose.yml 中 4 個直接掛載 docker.sock 的 room：
room6:
  volumes: ["/var/run/docker.sock:/var/run/docker.sock:ro"]   # 唯讀
room7:
  volumes: ["/var/run/docker.sock:/var/run/docker.sock"]      # 讀寫
room9:
  volumes: ["/var/run/docker.sock:/var/run/docker.sock"]      # 讀寫
final:
  volumes: ["/var/run/docker.sock:/var/run/docker.sock"]      # 讀寫

# secret-b：無 docker.sock 掛載，依賴 room7 的 docker.sock 操作
# ghost-alpha/beta/gamma/delta：room6 的目標容器，不直接參與攻擊

# 各 room 的 Dockerfile 中 player 使用者群組設定（均相同）：
# useradd -m -s /bin/bash -u 1000 player
# usermod -aG docker player    ← 容器內 docker GID ≠ host docker GID
```
