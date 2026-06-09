# Escape Docker — Linux 與 Docker 互動式密室逃脫學習平台

> **Linux 與邊緣運算 期末專案報告**

---

## 目錄

1. [專案概述](#1-專案概述)
2. [系統架構](#2-系統架構)
3. [技術選型與理由](#3-技術選型與理由)
4. [關卡設計](#4-關卡設計)
5. [核心功能實作](#5-核心功能實作)
6. [Docker 容器設計](#6-docker-容器設計)
7. [啟動與操作方式](#7-啟動與操作方式)
8. [技術挑戰與解決方案](#8-技術挑戰與解決方案)
9. [學習成果對應](#9-學習成果對應)
10. [未來擴充方向](#10-未來擴充方向)

---

## 1. 專案概述

### 1.1 設計動機

傳統的 Linux / Docker 學習方式以看文件、跟著教學貼指令為主，缺乏實際操作動機。本專案將課程所學轉化為**密室逃脫遊戲**：每一關都是一道謎題，必須真正理解並執行 Linux 指令才能找到 FLAG（通關密語），從而解鎖下一關。

### 1.2 專案目標

| 目標 | 說明 |
|------|------|
| **可玩性** | 網頁直接玩，不需安裝任何額外工具 |
| **教育性** | 每關對應課程中的一個核心知識點 |
| **完整性** | 15 個關卡涵蓋 Linux 基礎到 Docker 進階 |
| **可部署性** | 一個指令啟動，`docker compose up` |

### 1.3 系統規模

- **15 個遊戲容器**：12 主關 + Final Boss + 2 隱藏關
- **20+ 個 Docker 服務**：含反向代理、終端機閘道、API、輔助容器
- **67 個原始碼檔案**
- **4 個獨立 Docker 網路**
- 總分上限 **3,500+ 分**（含成就加成）

---

## 2. 系統架構

### 2.1 整體架構圖

```
瀏覽器 (http://localhost:80)
         │
         ▼
    ┌─────────────────────────────────────────┐
    │             Nginx（反向代理）              │
    │  /           → frontend (HTML/CSS/JS)   │
    │  /ws         → terminal-gateway         │
    │  /api/       → scoreboard-api           │
    └──────┬───────────────┬──────────────────┘
           │               │
      WebSocket         REST API
           │               │
           ▼               ▼
    ┌──────────────┐ ┌─────────────────────┐
    │  terminal-   │ │   scoreboard-api    │
    │  gateway     │ │  (FastAPI + SQLite) │
    │ (Node.js +   │ │                     │
    │  node-pty)   │ │  FLAG 驗證 / 排行榜  │
    └──────┬───────┘ │  成就 / 提示系統     │
           │         └─────────────────────┘
    docker exec -it <room> bash
           │
    ┌──────┴──────────────────────────────────┐
    │           Docker Compose 服務群           │
    │  room0  room1  room2  room3  room4  room5 │
    │  room6  room7  room8  room9               │
    │  room10 room11 final                      │
    │  secret-a  secret-b                       │
    │  locked-server  secret-server  vault      │
    │  ghost-alpha  ghost-beta  ghost-gamma      │
    └─────────────────────────────────────────┘
```

### 2.2 服務清單

| 服務 | 技術 | 說明 |
|------|------|------|
| `nginx` | Nginx Alpine | 反向代理，統一入口 port 80 |
| `terminal-gateway` | Node.js + node-pty | WebSocket ↔ docker exec 橋接 |
| `scoreboard-api` | FastAPI + SQLite | FLAG 驗證、排行榜、成就、提示 |
| `room0` ~ `room11` | Ubuntu 22.04 | 12 個主關謎題容器 |
| `final` | Ubuntu 22.04 | Final Boss 容器 |
| `secret-a`, `secret-b` | Ubuntu 22.04 | 2 個隱藏關容器 |
| `locked-server` | Ubuntu 22.04 | Room 4 SSH 目標伺服器 |
| `secret-server` | Python Flask | Room 9 內部隔離 API |
| `vault` | Alpine | 存放最終 FLAG |
| `ghost-alpha/beta/gamma` | Alpine/Ubuntu | Room 6 停止容器謎題 |

### 2.3 網路拓撲

```
game_net (172.20.0.0/24)      ← 所有 room 容器與 nginx/API
docker_net (172.21.0.0/24)    ← 有 Docker 存取需求的 room
secret_net (172.22.0.0/24)    ← 隔離內網，internal: true（Room 9 謎題）
ssh_net (172.23.0.0/24)       ← locked-server（Room 4 SSH 謎題）
```

---

## 3. 技術選型與理由

### 3.1 Web 終端機：xterm.js + node-pty

玩家不需要安裝任何 CLI 工具，**直接用瀏覽器**就能操作真實的 Linux 終端機。

```
瀏覽器 xterm.js  ←─ WebSocket ─→  terminal-gateway (Node.js)
                                         │
                                    node-pty.spawn(
                                      'docker', ['exec', '-it', room, 'bash']
                                    )
                                         │
                                    真實的 Ubuntu 容器 shell
```

- **xterm.js**：成熟的瀏覽器端終端機模擬器，支援 256 色、Terminal resize
- **node-pty**：以偽終端機（PTY）啟動 `docker exec`，完整支援互動式程式（vim、top 等）

### 3.2 API 後端：FastAPI

- 自動產生 OpenAPI 文件（`/api/docs`）
- Pydantic 模型驗證輸入
- 非同步處理，效能佳

### 3.3 動態 FLAG 系統

FLAG 不寫死，根據 `.env` 的 `FLAG_SEED` 動態生成，防止抄答案：

```python
# scoreboard-api/flags.py
def _gen(suffix: str) -> str:
    raw = hashlib.sha256(f"{_SEED}-{suffix}".encode()).hexdigest()[:16]
    return f"EscapeDocker{{{raw}}}"

# 範例
_gen("room1")  →  "EscapeDocker{a3f8c1d2e4b7f9a0}"
```

更換 `FLAG_SEED` 即可重新生成所有 15 個 FLAG，適合課堂多次使用。

---

## 4. 關卡設計

### 4.1 故事背景

> 你是一名系統管理員，在凌晨三點收到一封匿名訊息：
> 「我把所有機密分散藏在容器裡。找到它們，才能解開最終密碼。」
> 每個容器都是一道謎題。時鐘正在滴答作響。

### 4.2 關卡總覽

| # | 關卡名稱 | 主題 | 核心指令 / 技術 | 分數 |
|---|---------|------|----------------|------|
| 0 | Tutorial | 系統初探 | `ls`, `cd`, `cat`, `man` | 50 |
| 1 | The Archive | 檔案搜尋 | `find`, `base64 -d`, `strings` | 100 |
| 2 | The Vault | 權限提升 | `sudo -l`, SUID, path injection | 100 |
| 3 | The Process | 行程管理 | `ps aux`, `/proc`, `kill -USR1` | 150 |
| 4 | The Locksmith | SSH 金鑰 | `ssh-keygen`, `authorized_keys`, SSH Tunnel | 150 |
| 5 | The Wire | 網路診斷 | `ss -tlnp`, `nc`, `/etc/hosts` | 150 |
| 6 | The Shipyard | Docker 基礎 | `docker ps -a`, `logs`, `inspect`, `diff` | 200 |
| 7 | The Workshop | Docker Build | `Dockerfile`, `docker build`, image layers | 200 |
| 8 | The Fleet | Docker Compose | `docker-compose.yml`, `depends_on`, healthcheck | 200 |
| 9 | Network Maze | Docker 網路 | `docker network`, `internal`, DNS, `connect` | 200 |
| 10 | The Evidence | 日誌分析 | `grep`, `awk`, `sed`, 多步驟 log 追蹤 | 250 |
| 11 | The Clockwork | 自動化 | `crontab`, bash scripting, cron job | 250 |
| F | **The Escape** | **Final Boss** | `docker.sock`, Docker REST API, `curl --unix-socket` | 500 |
| S-A | The Leak | 隱藏關 A | `docker inspect`, ENV 變數洩漏 | 300 |
| S-B | The Ghost | 隱藏關 B | `docker save`, image layer 挖掘, `tar` | 300 |

### 4.3 關卡詳細說明

#### Chapter 1：Linux 基礎（Room 0-2）

**Room 1 — The Archive（檔案搜尋）**

容器內有 80 個目錄、數百個假檔案作為干擾。FLAG 被 base64 編碼後藏在深層路徑 `/home/player/archive/dir_037/backups/2023/system_backup.encoded`。另外還有一個假 ELF binary，用 `strings` 可以找到提示訊息。

```bash
# 解題流程
find /home -name "*.encoded"          # 找到目標檔案
base64 -d system_backup.encoded       # 解碼取得 FLAG
strings /home/player/binary_clue      # 進階：從 binary 找提示
```

**Room 2 — The Vault（權限提升）**

`/secret/flag.txt` 只有 root 可讀，但玩家有受限的 sudo 權限。`/usr/local/bin/backup.sh` 的內容是：

```bash
cp $1 /tmp/out   # 參數沒有引號 → path injection 漏洞
```

玩家必須發現這個路徑注入漏洞，執行 `sudo backup.sh /secret/flag.txt`，然後從 `/tmp/out` 讀取。

#### Chapter 2：系統操作（Room 3-5）

**Room 3 — The Process（行程管理）**

容器啟動時在背景執行一個 Python daemon，每 5 秒輸出 XOR 加密的 FLAG。但只有發送 SIGUSR1 才能讓它輸出明文。

```bash
ps aux | grep flag_daemon     # 找到 PID
kill -USR1 <PID>              # 觸發 FLAG 輸出
cat /proc/<PID>/cmdline       # 進階：讀取 cmdline
```

**Room 4 — The Locksmith（SSH 金鑰）**

容器內有個 `locked-server`（另一個 Ubuntu 容器），只允許公鑰認證，密碼登入已停用。FLAG 在 `locked-server` 的 `localhost:9090`，玩家必須：
1. 生成 SSH key pair
2. 把公鑰加入 locked-server 的 `authorized_keys`
3. 建立 SSH Tunnel（`-L 9090:localhost:9090`）
4. 透過 Tunnel 用 curl 取得 FLAG

#### Chapter 3：Docker 核心（Room 6-9）

**Room 6 — The Shipyard（Docker 基礎）**

三個已停止的容器（`ghost-alpha`, `ghost-beta`, `ghost-gamma`），各藏著不同資訊：

| 容器 | 取得方式 | 資訊 |
|------|---------|------|
| ghost-alpha | `docker logs` | FLAG Part 1 在輸出中 |
| ghost-beta | `docker inspect` | SECRET 在環境變數裡 |
| ghost-gamma | `docker start` + `exec` | 檔案在 `/app/secret/fragment.txt` |

**Room 9 — Network Maze（Docker 網路隔離）**

`secret-server.internal` 在 `secret_net`（`internal: true` 隔離網路），room9 容器一開始無法連線。玩家需要：

```bash
docker network ls                    # 找到 escape-docker_secret_net
docker network connect \
  escape-docker_secret_net room9     # 把自己加入隔離網路
curl -H 'X-Token: room9_player' \
  http://secret-server.internal/secret  # 帶正確 Header 取得 FLAG
```

**Final Boss — The Escape（docker.sock）**

容器掛載了 `/var/run/docker.sock`，玩家可以透過 Docker REST API 控制整個 Docker daemon：

```bash
# 1. 確認 socket 存在
ls -la /var/run/docker.sock

# 2. 列出所有容器
curl --unix-socket /var/run/docker.sock \
  http://localhost/containers/json | python3 -m json.tool

# 3. 找到 vault 容器 ID，建立 exec session
curl -X POST --unix-socket /var/run/docker.sock \
  -H "Content-Type: application/json" \
  -d '{"AttachStdout":true,"Cmd":["cat","/final_flag.txt"]}' \
  http://localhost/containers/<vault_id>/exec

# 4. 執行取得 FLAG
curl -X POST --unix-socket /var/run/docker.sock \
  -H "Content-Type: application/json" \
  -d '{"Detach":false}' \
  http://localhost/exec/<exec_id>/start
```

完成後系統顯示「為什麼 docker.sock 是嚴重安全漏洞」的教學說明。

#### 隱藏關卡

**Secret Room A — The Leak**：解鎖條件是完成 Room 6 後觀察 `secret-a` 容器的環境變數，發現 `LEAKED_SECRET` 被故意暴露（對應 ENV 安全最佳實踐）。

**Secret Room B — The Ghost**：解鎖條件是完成 Room 7 後從 `secret-b` 的 image history 發現痕跡。在某個 build layer 寫入 FLAG 後再刪除，但透過 `docker save` + `tar` 仍可從舊 layer 找到已刪除的檔案。

---

## 5. 核心功能實作

### 5.1 計分系統

```
基礎分數（FLAG 提交得分）
  + 提示懲罰（使用提示會扣分）
  + 成就加成（完成特定條件）
  = 最終分數
```

**提示系統（3 個等級）：**

| 等級 | 費用 | 內容 |
|------|------|------|
| Level 1 | 免費 | 方向提示（「試試 find 指令」）|
| Level 2 | -25 pts | 具體步驟（「用 find -name '*.encoded'」）|
| Level 3 | -50 pts | 完整解法（直接給出指令）|

### 5.2 成就系統（10 個）

| 成就 | 圖示 | 條件 | 加分 |
|------|------|------|------|
| Speed Demon | ⚡ | 任一關 3 分鐘內完成 | +100 |
| Pure Chapter 1 | 🧠 | Chapter 1 全部不用提示 | +150 |
| No Crutches | 💪 | 所有主關不用提示 | +500 |
| First Blood | 🩸 | 第一個完成某關卡 | +200 |
| All Clear | 🏆 | 完成全部 12 個主關 | +500 |
| Ghost Hunter | 👻 | 找到兩個 Secret Room | +300 |
| Completionist | 🌟 | 100% 完成率（含隱藏關）| +1000 |
| Docker Master | 🐳 | 完成 Chapter 3 全部 | +300 |
| Escape Artist | 🔓 | 完成 Final Boss | +200 |
| Log Detective | 🔍 | 完成 Room 10 | +100 |

**成就加成最高 +2,600 pts，理論總分上限 3,500+ pts。**

### 5.3 API 端點

```
POST /register              ← 玩家註冊（輸入名字）
POST /submit                ← 提交 FLAG
GET  /scoreboard            ← 即時排行榜
GET  /player/{name}         ← 個人進度 + 解鎖狀態
GET  /rooms                 ← 所有房間元資料
POST /hint                  ← 請求提示（記錄並扣分）
GET  /hints/{room_id}       ← 提示等級與費用資訊
POST /enter                 ← 記錄進入房間時間（計時用）
GET  /achievements          ← 成就清單
GET  /admin/dashboard       ← 管理員總覽（需 X-Admin-Token）
GET  /admin/flags-info      ← 所有 FLAG 答案（管理員用）
```

### 5.4 前端頁面

| 頁面 | 功能 |
|------|------|
| `index.html` | 故事介紹、輸入玩家名字 |
| `map.html` | 互動式房間地圖，顯示鎖定/解鎖/完成狀態 |
| `play.html` | 主遊戲頁：xterm.js 終端機 + 任務說明 + 提示 + FLAG 提交 |
| `scoreboard.html` | 即時排行榜（含成就加成分解）|
| `achievements.html` | 成就牆（已解鎖/未解鎖）|
| `admin.html` | 管理員面板（需輸入 Admin Token）|

### 5.5 資料庫設計（SQLite）

```sql
players       (name, avatar, joined_at)
submissions   (player_name, flag_id, room, points, submitted_at)
hint_usage    (player_name, room_id, hint_level, cost, used_at)
achievements  (player_name, achievement_id, earned_at)
room_timings  (player_name, room_id, entered_at, completed_at)
```

---

## 6. Docker 容器設計

### 6.1 Room 容器結構

每個 room 容器都有相同的基本結構：

```
rooms/roomX/
├── Dockerfile        ← Ubuntu 22.04 基底，安裝必要工具
├── setup.sh          ← build 時執行：生成謎題、假檔案、motd
├── entrypoint.sh     ← 容器啟動時執行：動態生成 FLAG、啟動背景服務
└── (各關專屬檔案)
```

**動態 FLAG 生成（entrypoint.sh 的核心邏輯）：**

```bash
FLAG=$(echo "${FLAG_SEED}-room1" | sha256sum | cut -c1-16)
echo "EscapeDocker{${FLAG}}" > /home/player/.hidden_flag
```

FLAG 值在**容器啟動時**根據 `FLAG_SEED` 動態計算，與後端 API 使用同樣的演算法驗證，不需要在程式碼裡寫死任何 FLAG。

### 6.2 網路隔離設計

```yaml
# docker-compose.yml 網路設定
networks:
  secret_net:
    driver: bridge
    internal: true          # ← 無法連上外網，也無法被外部主動連線
    ipam:
      config:
        - subnet: 172.22.0.0/24
```

`internal: true` 使 `secret_net` 完全隔離，玩家必須透過 `docker network connect` 才能存取 `secret-server.internal`，這正是 Room 9 的謎題核心。

### 6.3 docker.sock 的教學意義

Final Boss 的容器掛載了 Docker socket：

```yaml
# docker-compose.yml
final:
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock
```

這讓玩家理解：**掛載 docker.sock 等同於給予 root 權限**，因為可以透過 Docker REST API 建立特權容器並掛載 host 根目錄。完成後系統顯示實際的安全建議（改用 rootless Docker 或 socket proxy）。

---

## 7. 啟動與操作方式

### 7.1 系統需求

| 工具 | 版本需求 |
|------|---------|
| Docker Desktop | 4.0+ |
| Docker Compose | v2.0+ |
| 可用記憶體 | 4 GB+ |
| 作業系統 | Windows / Linux / macOS |

### 7.2 啟動步驟

**Windows（PowerShell）：**
```powershell
cd escape-docker
Copy-Item .env.example .env   # 可修改 FLAG_SEED 和 ADMIN_TOKEN
.\start.ps1                   # 一鍵啟動，第一次約 10-15 分鐘
```

**Linux / macOS：**
```bash
cd escape-docker
cp .env.example .env
bash start.sh
```

### 7.3 遊戲流程

```
1. 開瀏覽器 → http://localhost
2. 輸入玩家名字
3. 進入 http://localhost/map.html 查看房間地圖
4. 點擊 Room 0（Tutorial）開始
5. 在左側 xterm.js 終端機輸入 Linux 指令解謎
6. 找到 FLAG（格式：EscapeDocker{xxxxxxxxxxxxxxxx}）
7. 在右側欄位貼上 FLAG 並按「提交」
8. 解鎖下一關，循環到通關 Final Boss
```

### 7.4 管理員功能

前往 `http://localhost/admin.html`，輸入 `.env` 裡的 `ADMIN_TOKEN`：

- 即時查看所有玩家排行榜
- 查看每個玩家的 FLAG 提交記錄
- 查看提示使用記錄
- **查看所有 FLAG 答案**（方便 demo 驗證）

---

## 8. 技術挑戰與解決方案

### 8.1 Docker build 網路超時

**問題：** `docker compose build` 並行建置 20+ 個 image 時，多個容器同時下載 apt / pip 套件，導致網路頻寬不足而超時，引發連鎖取消（一個失敗→所有並行 build 被取消）。

**解決方案：**
1. 在所有 Ubuntu Dockerfile 加入 apt 超時與重試設定：
   ```dockerfile
   RUN printf 'Acquire::Retries "5";\nAcquire::http::Timeout "120";\n' \
       > /etc/apt/apt.conf.d/80-retries
   ```
2. pip 加入超時與重試參數：
   ```dockerfile
   RUN pip install --no-cache-dir --timeout 300 --retries 5 -r requirements.txt
   ```
3. 在啟動腳本設定 `BUILDKIT_MAX_PARALLELISM=4`，限制同時建置數量。

### 8.2 Docker build 時 /etc/hosts 唯讀

**問題：** Room 5 的 `setup.sh` 在 build 階段嘗試寫入 `/etc/hosts`，但 Docker build 環境中 `/etc/hosts` 是唯讀的。

**解決方案：** 將 `/etc/hosts` 的修改移到 `entrypoint.sh`（容器執行期），此時 `/etc/hosts` 是可寫的。

```bash
# entrypoint.sh（容器啟動時執行）
echo "172.22.0.50  mystery.internal" >> /etc/hosts
```

### 8.3 WebSocket 與 docker exec 的 PTY 整合

**問題：** 直接 spawn `docker exec` 不支援互動式程式（vim、top），因為沒有 PTY（偽終端機）。

**解決方案：** 使用 `node-pty` 以 PTY 模式啟動 `docker exec -it`，再將 stdin/stdout 雙向橋接到 WebSocket，同時處理 Terminal resize 事件（`SIGWINCH`）。

### 8.4 動態 FLAG 的跨服務驗證

**問題：** 每個 room 容器在執行期動態生成 FLAG，但 scoreboard-api 需要在不知道答案的情況下驗證 FLAG 是否正確。

**解決方案：** scoreboard-api 與所有 room 容器共享同一個 `FLAG_SEED` 環境變數，使用完全相同的計算邏輯：

```python
sha256(f"{FLAG_SEED}-{room_id}").hexdigest()[:16]
```

兩邊計算結果相同，不需要任何跨容器通訊。

---

## 9. 學習成果對應

### 9.1 課程知識點覆蓋

| 課程單元 | 對應關卡 | 核心技術 |
|---------|---------|---------|
| Linux 檔案系統 | Room 0, 1 | `find`, `base64`, `strings`, `file` |
| Linux 權限管理 | Room 2 | `chmod`, `sudo`, SUID bit, `sudoers` |
| 行程管理 | Room 3 | `ps`, `/proc`, `kill`, Unix signals |
| SSH 與遠端連線 | Room 4 | `ssh-keygen`, `authorized_keys`, SSH Tunnel |
| 網路工具 | Room 5 | `ss`, `netcat`, `/etc/hosts`, DNS |
| Docker 基本操作 | Room 6 | `docker ps/logs/inspect/diff/exec` |
| Dockerfile 與 Build | Room 7 | `docker build`, image layers, `docker history` |
| Docker Compose | Room 8 | `docker-compose.yml`, healthcheck |
| Docker 網路 | Room 9 | bridge, internal, `docker network connect` |
| Log 分析 | Room 10 | `grep`, `awk`, `sed`, pipeline |
| 系統自動化 | Room 11 | `crontab`, bash script, timing |
| Container Security | Final Boss | `docker.sock`, Docker REST API |

### 9.2 安全觀念教育

- **docker.sock 安全**：Final Boss 示範為什麼不應隨意掛載 docker socket
- **ENV 變數洩漏**：Secret Room A 示範敏感資訊不應放在容器 ENV
- **Image layer 的持久性**：Secret Room B 示範已刪除的資料仍在舊 layer 中
- **SUID 與 sudo 漏洞**：Room 2 示範不當的 sudo 設定可導致提權

---

## 10. 未來擴充方向

| 方向 | 說明 |
|------|------|
| **多人競賽模式** | 加入實時通知（WebSocket push），玩家可以看到其他人通關 |
| **計時排名** | 除分數外，加入通關時間排名 |
| **Kubernetes 關卡** | 加入 k8s 相關章節（Pod、Service、ConfigMap）|
| **CTF 模式** | 支援多組 FLAG_SEED 隔離，讓不同班級互不影響 |
| **回放功能** | 記錄每個玩家的指令歷史，供教師事後分析學習行為 |

---

## 附錄：目錄結構

```
escape-docker/
├── .env.example              ← 環境設定範本
├── docker-compose.yml        ← 所有 20+ 個服務定義
├── start.ps1                 ← Windows 一鍵啟動腳本
├── start.sh                  ← Linux/macOS 啟動腳本
│
├── nginx/
│   └── nginx.conf            ← 反向代理設定
│
├── frontend/                 ← 前端靜態頁面
│   ├── index.html            ← 首頁
│   ├── map.html              ← 房間地圖
│   ├── play.html             ← 主遊戲頁（xterm.js）
│   ├── scoreboard.html       ← 排行榜
│   ├── achievements.html     ← 成就牆
│   └── admin.html            ← 管理員面板
│
├── terminal-gateway/         ← Node.js WebSocket ↔ docker exec 橋接
│   ├── index.js
│   ├── docker-exec.js
│   └── package.json
│
├── scoreboard-api/           ← FastAPI 後端
│   ├── main.py               ← API 端點
│   ├── flags.py              ← 動態 FLAG + 提示資料
│   ├── achievements.py       ← 成就判斷邏輯
│   ├── database.py           ← SQLite 操作
│   └── requirements.txt
│
└── rooms/
    ├── room0/ ~ room11/      ← 12 個主關（各含 Dockerfile + setup.sh）
    ├── final/                ← Final Boss
    ├── secret-a/             ← 隱藏關 A
    ├── secret-b/             ← 隱藏關 B
    └── helpers/
        ├── locked-server/    ← Room 4 SSH 目標
        └── secret-server/    ← Room 9 隔離 API
```

---

*Linux 與邊緣運算 期末專案 — Escape Docker*
