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
