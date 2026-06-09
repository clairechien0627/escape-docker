# Escape Docker

> Linux 與 Docker 互動式密室逃脫學習系統

---

## 系統需求

| 工具 | 最低版本 | 確認指令 |
|------|---------|---------|
| Docker Desktop | 4.0+ | `docker --version` |
| Docker Compose | v2.0+ | `docker compose version` |
| 可用記憶體 | 4 GB+ | — |
| OS | Windows / Linux / macOS | — |

> **Windows 使用者**：安裝 [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/) 即可，不需要 WSL2。

---

## 快速開始

### 1. Clone 專案

```bash
git clone https://github.com/<your-username>/escape-docker.git
cd escape-docker
```

### 2. 複製設定檔

**PowerShell（Windows）：**
```powershell
Copy-Item .env.example .env
```

**bash（Linux / macOS）：**
```bash
cp .env.example .env
```

`.env` 內容（可不改，直接用預設值）：

```env
FLAG_SEED=escape_docker_2024_change_me   # 改這個會重新生成所有 FLAG
ADMIN_TOKEN=admin_secret_change_me       # Admin Panel 的密碼
```

### 3. 一鍵啟動

**PowerShell（Windows）：**
```powershell
.\start.ps1
```

**bash（Linux / macOS）：**
```bash
bash start.sh
```

第一次啟動會 build 所有 image，約需 **10–15 分鐘**（視網路速度而定）。  
之後重啟只需 **30 秒**。

### 4. 開瀏覽器

| 頁面 | 網址 |
|------|------|
| 🎮 遊戲首頁 | http://localhost |
| 🗺️ 房間地圖 | http://localhost/map.html |
| 📊 排行榜 | http://localhost/scoreboard.html |
| 🏆 成就牆 | http://localhost/achievements.html |
| 🔴 Admin | http://localhost/admin.html |

---

## 玩法說明

### Step 1：輸入名字

第一次進入地圖或遊戲頁，系統會要求輸入玩家名字（1–30 個字元）。

### Step 2：從地圖選擇房間

- ✅ 綠框 = 已完成
- 🔓 可進入 = 點擊進入
- 🔒 鎖定 = 需先完成前一關

**解鎖順序（線性）：**
```
Room 0 → Room 1 → Room 2 → ... → Room 11 → Final Boss
```
Secret Room A / B 分別在完成 Room 6 / Room 7 後解鎖。

### Step 3：在終端機裡解謎

進入房間後，左側是 **xterm.js 終端機**，就像真實的 Linux terminal。  
右側是任務說明、提示系統和 FLAG 提交欄。

### Step 4：提交 FLAG

找到 FLAG（格式：`EscapeDocker{xxxxxxxxxxxxxxxx}`），在右側欄位貼上並點擊「提交」。

---

## 關卡列表

| # | 房間 | 主題 | 核心技術 | 分數 |
|---|------|------|---------|------|
| 0 | Tutorial | 初入系統 | `ls` `cd` `cat` `man` | 50 |
| 1 | The Archive | 檔案搜尋 | `find` `base64` `strings` | 100 |
| 2 | The Vault | 權限提升 | `sudo` SUID path injection | 100 |
| 3 | The Process | 行程管理 | `ps` `/proc` `kill -USR1` | 150 |
| 4 | The Locksmith | SSH 金鑰 | `ssh-keygen` `authorized_keys` SSH tunnel | 150 |
| 5 | The Wire | 網路診斷 | `ss` `nc` `/etc/hosts` | 150 |
| 6 | The Shipyard | Docker 基礎 | `docker ps/logs/inspect/diff` | 200 |
| 7 | The Workshop | Docker Build | `Dockerfile` `docker build` image layers | 200 |
| 8 | The Fleet | Docker Compose | `docker-compose.yml` healthcheck | 200 |
| 9 | Network Maze | Docker 網路 | `docker network` internal DNS | 200 |
| 10 | The Evidence | 日誌分析 | `grep` `awk` `sed` 多步驟追蹤 | 250 |
| 11 | The Clockwork | 自動化 | `crontab` bash scripting | 250 |
| F | **The Escape** | **Final Boss** | `docker.sock` Docker REST API | 500 |
| S-A | The Leak | 🔮 Secret | ENV 洩漏 `docker inspect` | 300 |
| S-B | The Ghost | 🔮 Secret | Image layer 挖掘 `docker save` | 300 |

**成就加成**最高 **+2,600 pts**，總分理論上限 **3,500+ pts**。

---

## 提示系統

每個房間有 3 個等級的提示：

| 等級 | 費用 | 內容 |
|------|------|------|
| Level 1 | 免費 | 方向提示 |
| Level 2 | −25 pts | 具體步驟 |
| Level 3 | −50 pts | 完整解法 |

---

## 成就系統

| 成就 | 條件 | 加分 |
|------|------|------|
| ⚡ Speed Demon | 任一 Room 3 分鐘內完成 | +100 |
| 🧠 Pure Chapter 1 | Chapter 1 全部不用提示 | +150 |
| 💪 No Crutches | 所有主關不用提示 | +500 |
| 🩸 First Blood | 第一個完成任一關卡 | +200 |
| 🏆 All Clear | 完成全部 12 個主關 | +500 |
| 👻 Ghost Hunter | 找到兩個 Secret Room | +300 |
| 🌟 Completionist | 100% 完成（含 Secret） | +1000 |
| 🐳 Docker Master | 完成全部 Chapter 3 | +300 |
| 🔓 Escape Artist | 完成 Final Boss | +200 |
| 🔍 Log Detective | 完成 Room 10 | +100 |

---

## Admin Panel

前往 `http://localhost/admin.html`，輸入 `.env` 裡的 `ADMIN_TOKEN`。

- 即時排行榜
- 所有玩家的提交記錄與提示使用記錄
- **FLAG 答案清單**（方便 demo 驗證）

---

## 常用管理指令

```bash
# 查看所有容器狀態
docker compose ps

# 查看某個 room 的日誌
docker compose logs room1

# 重啟單一 room（謎題重置）
docker compose restart room1

# 完全停止
docker compose down

# 重新生成所有 FLAG（修改 FLAG_SEED 後）
docker compose down && bash start.sh

# 重置玩家進度（刪除資料庫）
rm scoreboard-api/data/scores.db
```

---

## 開發者指南

### Container 數量與資源

啟動後共有 **23 個常駐 container**（另有 3 個 ghost 容器跑完即停）：

| 類型 | 數量 | 資源消耗 |
|------|------|---------|
| 基礎設施（nginx / terminal-gateway / scoreboard-api）| 3 | 中等（Node.js + Python 常駐）|
| Room 容器（room0–11、final、secret-a/b、vault）| 17 | 極低（idle bash，各約 10–20 MB）|
| Helper（locked-server、secret-server）| 2 | 很低（SSH + Python HTTP）|
| Ghost 容器（alpha/beta/gamma）| 3 | 幾乎零（跑完立刻停止）|

整體記憶體約 **600–900 MB**，現代筆電不需擔心效能。

---

### 啟動 / 停止遊戲

```bash
# 啟動（第一次會 build image，約 10–15 min）
bash start.sh          # Linux / macOS
.\start.ps1            # Windows PowerShell

# 停止，保留容器狀態（之後 docker compose start 可快速恢復）
docker compose stop

# 停止 + 刪除所有容器（保留 image 和玩家資料）
docker compose down

# 停止 + 刪除容器 + 刪除玩家資料庫（完全重置）
docker compose down -v

# 重新啟動整個遊戲（不重 build）
docker compose restart
```

---

### 修改單一 Room 後重 build

每個 room 都是獨立 image，修改後只需重 build 那個 room，不影響其他 room：

```bash
# 重 build 並重啟單一 room
docker compose build --no-cache room1
docker compose up -d room1

# 同時 build 多個 room
docker compose build --no-cache room0 room1 room2
docker compose up -d room0 room1 room2
```

> **注意**：修改 `.sh` 腳本後務必用 `--no-cache`，否則 Docker 可能使用舊的快取 layer。

---

### 修改前端（HTML / CSS / JS）

前端是純靜態檔案，由 nginx 直接 serve，**不需要重 build image**：

1. 直接編輯 `frontend/` 下的檔案
2. 瀏覽器強制重新整理（`Ctrl+Shift+R`）即可看到變更

---

### 修改 scoreboard-api（Python）

```bash
# 重 build API
docker compose build --no-cache scoreboard-api
docker compose up -d scoreboard-api
```

資料庫檔案在 `scoreboard-api/data/scores.db`，重 build 不會刪除資料。  
若要重置所有玩家進度：

```bash
rm scoreboard-api/data/scores.db   # Linux / macOS
del scoreboard-api\data\scores.db  # Windows
docker compose restart scoreboard-api
```

---

### 查看日誌 / 除錯

```bash
# 查看所有服務狀態（確認哪些是 Up / Exited）
docker compose ps

# 即時查看某 room 的日誌
docker compose logs -f room1

# 進入 room 容器排查問題（以 root 身分）
docker exec -it --user root room1 bash

# 查看 terminal-gateway 連線日誌
docker compose logs -f terminal-gateway

# 查看 scoreboard-api 請求日誌
docker compose logs -f scoreboard-api
```

---

### FLAG 不對時的排查流程

FLAG 格式：`EscapeDocker{sha256(FLAG_SEED + "-" + roomId)[:16]}`

```bash
# 確認目前 .env 的 FLAG_SEED
grep FLAG_SEED .env

# 手動算某 room 的正確 FLAG（在任意 bash 裡）
echo "your_seed-room0" | sha256sum | cut -c1-16

# Admin Panel 查看所有正確 FLAG
# 瀏覽器開啟 http://localhost/admin.html
```

若 room 裡的 FLAG 與 admin 不符，表示那個 room 的 image 是用舊 seed build 的，執行：

```bash
docker compose build --no-cache <room_name>
docker compose up -d <room_name>
```

---

## 目錄結構

```
.
├── docker-compose.yml      ← 所有服務定義（20+ 個容器）
├── start.ps1               ← Windows 啟動腳本
├── start.sh                ← Linux / macOS 啟動腳本
├── .env.example            ← 環境設定範本
│
├── frontend/               ← 前端靜態頁面（xterm.js + 排行榜）
├── nginx/                  ← 反向代理設定
├── terminal-gateway/       ← Node.js：WebSocket → docker exec 橋接
├── scoreboard-api/         ← FastAPI：FLAG 驗證、排行榜、成就
│   └── data/               ← SQLite 資料庫（.gitignore 忽略）
│
└── rooms/
    ├── room0/ ~ room11/    ← 12 個主關
    ├── final/              ← Final Boss
    ├── secret-a/           ← Secret Room A
    ├── secret-b/           ← Secret Room B
    └── helpers/
        ├── locked-server/  ← Room 4 SSH 目標
        └── secret-server/  ← Room 9 隔離 API
```

---

## 技術架構

```
瀏覽器 (localhost:80)
    │
    ▼
  Nginx（反向代理）
  ├── /          → frontend（HTML / CSS / JS）
  ├── /ws        → terminal-gateway（Node.js + node-pty）
  └── /api/      → scoreboard-api（FastAPI + SQLite）
         │
    WebSocket
         │ docker exec -it <room> bash
         ▼
  Room 0~11, Final, Secret A/B（Ubuntu 22.04 容器）
```

---

## 常見問題

**Q：瀏覽器顯示空白或連不上？**  
等待 10 秒後重新整理，nginx 需要一點時間啟動。若仍無法連線，執行 `docker compose ps` 確認所有服務狀態。

**Q：終端機畫面不動（spinning）？**  
執行 `docker compose ps` 確認目標 room 的狀態為 `Up`。若非 `Up`，執行 `docker compose restart room0`。

**Q：想換一組新的 FLAG？**  
修改 `.env` 裡的 `FLAG_SEED` 為任意字串，然後 `docker compose down && bash start.sh`。

**Q：Secret Room 怎麼解鎖？**  
完成 Room 6 後，用 `docker inspect secret-a` 查看環境變數。  
完成 Room 7 後，用 `docker history` 查看 `secret-b` 的 image 歷史。

---

*Linux 與邊緣運算 期末專案*
