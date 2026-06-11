# Escape Docker — On-demand 房間生命週期管理（room-manager）設計

## Context

這是針對「Linux 與邊緣運算」期末專案 Escape Docker 的新功能設計（與先前的 `roadmap.md` 腦力激盪是不同主題，本次聚焦單一子方向深入設計）。

**目前架構的關鍵事實**（已透過 Explore agent 確認）：
- 12 個主關 + Final Boss + 2 個 Secret Room，每關都是 `docker-compose.yml` 裡**唯一一份、全程常駐**的 container
- `terminal-gateway/docker-exec.js` 在玩家連線時直接 `docker exec -it <room> bash`，沒有任何 container 啟動/關閉的管理邏輯
- `docker-compose.yml` 全部使用 `restart: unless-stopped`，`start.sh`/`start.ps1` 一次把 26 個服務全部 `up -d`
- room0/room1（以及其餘大多數房間）的 FLAG 已經是在 **entrypoint.sh runtime 動態生成**（依 `.env` 的 `FLAG_SEED`），這代表 **container 被 recreate 後會自動重新生成正確的 FLAG**——這是本次設計能「房間重置」的關鍵前提

**動機**（依優先順序）：
1. **資源效率**：沒人用的房間不該佔用記憶體/CPU
2. **教學展示亮點**：把「container 隨需求動態建立/回收」當成系統特色，呼應「邊緣運算」課程主題（資源排程、動態佈署）
3. **房間重置**：玩家把環境弄壞後卡關時，能自動或手動恢復成乾淨初始狀態
4. **Demo 穩定性**：降低一次啟動 26 個服務造成的複雜度與風險

**目標**：新增一個獨立的 `room-manager` 微服務，負責管理所有 room container 的啟動/停止/重置生命週期，並讓 terminal-gateway 與前端（map.html / admin.html）與其互動。

---

## 整體架構

```
瀏覽器
  │
  ├─ /ws  ──────────► terminal-gateway ──┬─► docker exec <room> bash（沿用現有方式）
  │                                       │
  │                                       └─► room-manager: POST /rooms/:id/ensure（連線前）
  │                                            room-manager: POST /rooms/:id/heartbeat（連線中，每 30s）
  │                                            room-manager: POST /rooms/:id/release（斷線時）
  │
  └─ /api/rooms ───────────────────────► room-manager（GET /status，map.html 輪詢顯示房間狀態）
                                           │
                                           ▼
                                     docker.sock（start / stop / compose up -d --force-recreate）
```

room-manager 是新的常駐 container，掛載 `docker.sock`（讀寫）與 `docker-compose.yml` + `.env`（唯讀），透過 `docker compose` CLI 操作其他 room container。

---

## 1. room-manager 服務（新增）

**位置**：`room-manager/`（與 `terminal-gateway/`、`scoreboard-api/` 同層）

**技術選型**：Node.js（與 terminal-gateway 一致，方便共用 docker 操作慣例），用 `dockerode` 查詢 container 狀態，用 `child_process` 呼叫 `docker compose` CLI 執行 start/stop/recreate（recreate 需要 compose context 才能正確套用 volume/network/env，直接用 dockerode 重建較複雜）。

**設定檔**：`room-manager/rooms-config.json`，定義每個房間的 container 名稱與「連動容器」（例如 room4 ↔ locked-server、room9 ↔ secret-server）：

```json
{
  "room0": { "containers": ["room0"] },
  "room4": { "containers": ["room4", "locked-server"] },
  "room9": { "containers": ["room9", "secret-server"] },
  "...": "..."
}
```

**REST API**（內部用，不直接暴露給玩家）：

| 方法 | 路徑 | 用途 |
|------|------|------|
| `GET /status` | 回傳所有房間目前狀態（`running` / `stopped` / `starting`） |
| `POST /rooms/:id/ensure` | 確保該房間（含連動容器）為 running，若是 stopped 則 `docker compose up -d <containers>`，輪詢直到 `docker exec <room> true` 成功（最多等 30 秒） |
| `POST /rooms/:id/heartbeat` | 更新該房間的 `lastActivity` 時間戳 |
| `POST /rooms/:id/release` | 標記該房間「無活躍連線」，開始閒置倒數 |
| `POST /rooms/:id/reset` | 強制 `docker compose up -d --force-recreate <containers>`（手動重置按鈕用） |

**閒置掃描器**（背景 `setInterval`，每 60 秒跑一次）：
- 對每個 `state == running` 且無活躍連線、且 `now - lastActivity > STOP_IDLE_MINUTES`（預設 10 分鐘）的房間 → `docker stop <containers>`，標記 `stopped`（保留檔案系統，下次 `docker start` 秒開）
- 對每個 `state == stopped` 且 `now - lastActivity > RESET_IDLE_MINUTES`（預設 60 分鐘）的房間 → `docker compose up -d --force-recreate <containers>`（重新跑 entrypoint.sh，FLAG 與初始檔案恢復乾淨狀態），完成後立刻 `docker stop`，並把 `lastActivity` 重設為現在（避免下個掃描週期重複 recreate）

兩個閾值透過 `.env` 設定：`ROOM_STOP_IDLE_MINUTES`、`ROOM_RESET_IDLE_MINUTES`。

---

## 2. terminal-gateway 整合（小改動）

**檔案**：`terminal-gateway/index.js`、`terminal-gateway/docker-exec.js`

- WebSocket 連線建立時、`docker exec` 之前，先呼叫 `POST room-manager:PORT/rooms/<roomId>/ensure`（await 完成；若逾時則回傳錯誤訊息給前端）
- 連線期間每 30 秒呼叫一次 `POST .../heartbeat`
- WebSocket `onclose` 時呼叫 `POST .../release`

room-manager 的 base URL 透過環境變數注入（`docker-compose.yml` 內部 service name，例如 `http://room-manager:4000`）。

---

## 3. docker-compose.yml 變更

- 新增 `room-manager` service：
  - build context `./room-manager`
  - volumes：`/var/run/docker.sock:/var/run/docker.sock`（rw）、`./docker-compose.yml:/app/docker-compose.yml:ro`、`./.env:/app/.env:ro`
  - 加入 `docker_net`（terminal-gateway 也要能連到它，視現有網路規劃調整）
  - `restart: unless-stopped`
- `terminal-gateway` service 新增環境變數 `ROOM_MANAGER_URL=http://room-manager:4000`
- room0~11 / final / secret-a/b / locked-server / secret-server **不需要改 restart policy**——初次 `docker compose up -d` 仍會啟動全部（確保 build 正確、image 存在），room-manager 開機後第一次掃描（約 1 分鐘內）會把無人使用的房間全部 stop，自然進入「待命」穩態

---

## 4. nginx 路由

新增一條 location block：

```nginx
location /api/rooms/ {
    proxy_pass http://room-manager:4000/;
    ...（比照現有 /api/ → scoreboard-api 的設定）
}
```

---

## 5. 前端變更

### 5.1 play.html / terminal.js — 啟動中提示

呼叫 `/api/rooms/:id/ensure` 期間（或偵測到 WS 連線建立時間較長），顯示與「斷線提示 banner」共用的 overlay 元件，文字改為「正在啟動房間環境，請稍候（約 5-10 秒）...」。完成後自動隱藏。

### 5.2 map.html — 房間狀態徽章（教學展示亮點）

每個房間圖示旁加上小徽章：
- 🟢 運行中
- ⚪ 待命中（已休眠，進入後自動喚醒）

每 10-15 秒輪詢 `GET /api/rooms/status` 更新。這個視覺呈現直接對應「邊緣運算」課程的資源排程主題，適合在 demo / 報告中展示。

### 5.3 admin.html — 手動控制（選用，工作量小可一併做）

每個房間一行：目前狀態 + 「啟動 / 停止 / 重置」按鈕，呼叫 room-manager 對應 API（沿用 admin token 驗證）。對 demo 前手動「全部喚醒」或排查問題很方便。

---

## 6. 連動容器與邊界情況

- **room4 ↔ locked-server**、**room9 ↔ secret-server**：在 `rooms-config.json` 中設為一組，ensure/stop/reset 一起處理
- **room6/7/9/final**（掛載 docker.sock 的房間）：room-manager 只管理這些房間「自己」的 container 啟停，不影響它們透過自己的 docker.sock 操作的 ghost-alpha/beta/gamma（那些維持現有 `restart: "no"` 的一次性機制，不歸 room-manager 管）
- **secret-a / secret-b**：視其解鎖機制（完成 room6/7 後才需要），先以獨立房間處理；若發現它們依賴 room6/7 的 image/輸出，再追加連動設定
- **readiness 檢查**：用 `docker inspect --format '{{.State.Running}}'` 確認 container 啟動 + 額外等待 1-2 秒讓 entrypoint.sh 跑完（目前各房 entrypoint.sh 都是 sub-second 的 sed/echo/sha256sum 操作，足夠）
- **ensure 逾時**：30 秒內未就緒則回傳錯誤，terminal-gateway 顯示「房間啟動失敗，請稍後再試或聯絡老師」而非無限等待

---

## 驗證方式

1. **基本啟停**：`docker compose up -d` 後等待約 1 分鐘，執行 `docker compose ps`，確認 room0~11 等房間已被 room-manager 自動 stop（room-manager / nginx / terminal-gateway / scoreboard-api 仍 running）
2. **On-demand 啟動**：瀏覽器開啟某個已 stop 的房間，確認出現「啟動中」提示，幾秒後 terminal 正常連上，`docker compose ps` 顯示該房間變回 running
3. **閒置 stop**：連線後關閉分頁，等待超過 `ROOM_STOP_IDLE_MINUTES`，確認該房間被自動 stop，且重新進入後檔案系統狀態（例如先前建立的測試檔）仍保留（驗證是 stop 不是 recreate）
4. **閒置 reset**：把 `ROOM_RESET_IDLE_MINUTES` 暫時調小（例如 1 分鐘）測試，確認超時後該房間被 `--force-recreate`，重新進入後 FLAG 與初始檔案恢復成乾淨狀態，且 admin panel 的 FLAG 答案仍與房間內 FLAG 一致
5. **連動容器**：對 room4 開啟連線，確認 `locked-server` 也一起被 ensure/啟動；斷線閒置後兩者一起被 stop
6. **map.html 徽章**：在地圖頁觀察房間狀態徽章是否隨上述操作即時更新
7. **錯誤處理**：模擬 room-manager 暫時無回應（手動 stop room-manager），確認 terminal-gateway 不會卡死，能顯示合理錯誤訊息
