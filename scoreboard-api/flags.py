import hashlib
import os

_SEED = os.environ.get("FLAG_SEED", "escape_docker_dev_seed")


def _gen(suffix: str) -> str:
    raw = hashlib.sha256(f"{_SEED}-{suffix}".encode()).hexdigest()[:16]
    return f"EscapeDocker{{{raw}}}"


# ── FLAG 清單（key = flag value, value = metadata） ──
FLAGS: dict[str, dict] = {
    _gen("room0"):    {"id": "FLAG0",  "room": "room0",   "chapter": 1, "name": "Tutorial",        "points": 50},
    _gen("room1"):    {"id": "FLAG1",  "room": "room1",   "chapter": 1, "name": "The Archive",      "points": 100},
    _gen("room2"):    {"id": "FLAG2",  "room": "room2",   "chapter": 1, "name": "The Vault",        "points": 100},
    _gen("room3"):    {"id": "FLAG3",  "room": "room3",   "chapter": 2, "name": "The Process",      "points": 150},
    _gen("room4"):    {"id": "FLAG4",  "room": "room4",   "chapter": 2, "name": "The Locksmith",    "points": 150},
    _gen("room5"):    {"id": "FLAG5",  "room": "room5",   "chapter": 2, "name": "The Wire",         "points": 150},
    _gen("room6"):    {"id": "FLAG6",  "room": "room6",   "chapter": 3, "name": "The Shipyard",     "points": 200},
    _gen("room7"):    {"id": "FLAG7",  "room": "room7",   "chapter": 3, "name": "The Workshop",     "points": 200},
    _gen("room8"):    {"id": "FLAG8",  "room": "room8",   "chapter": 3, "name": "The Fleet",        "points": 200},
    _gen("room9"):    {"id": "FLAG9",  "room": "room9",   "chapter": 3, "name": "Network Maze",     "points": 200},
    _gen("room10"):   {"id": "FLAG10", "room": "room10",  "chapter": 4, "name": "The Evidence",     "points": 250},
    _gen("room11"):   {"id": "FLAG11", "room": "room11",  "chapter": 4, "name": "The Clockwork",    "points": 250},
    _gen("final"):    {"id": "FINAL",  "room": "final",   "chapter": 5, "name": "The Escape",       "points": 500},
    _gen("secret-a"): {"id": "SECRETA","room": "secret-a","chapter": 0, "name": "The Leak",         "points": 300},
    _gen("secret-b"): {"id": "SECRETB","room": "secret-b","chapter": 0, "name": "The Ghost",        "points": 300},
}

# 房間元資料（不含 FLAG 答案，給前端用）
ROOM_META = [
    {"id": "room0",   "name": "Tutorial",        "chapter": 1, "points": 50,  "icon": "🌟", "locked_by": []},
    {"id": "room1",   "name": "The Archive",      "chapter": 1, "points": 100, "icon": "📁", "locked_by": ["FLAG0"]},
    {"id": "room2",   "name": "The Vault",        "chapter": 1, "points": 100, "icon": "🔐", "locked_by": ["FLAG1"]},
    {"id": "room3",   "name": "The Process",      "chapter": 2, "points": 150, "icon": "⚙️", "locked_by": ["FLAG2"]},
    {"id": "room4",   "name": "The Locksmith",    "chapter": 2, "points": 150, "icon": "🔑", "locked_by": ["FLAG3"]},
    {"id": "room5",   "name": "The Wire",         "chapter": 2, "points": 150, "icon": "📡", "locked_by": ["FLAG4"]},
    {"id": "room6",   "name": "The Shipyard",     "chapter": 3, "points": 200, "icon": "🐳", "locked_by": ["FLAG5"]},
    {"id": "room7",   "name": "The Workshop",     "chapter": 3, "points": 200, "icon": "🏗️", "locked_by": ["FLAG6"]},
    {"id": "room8",   "name": "The Fleet",        "chapter": 3, "points": 200, "icon": "🚢", "locked_by": ["FLAG7"]},
    {"id": "room9",   "name": "Network Maze",     "chapter": 3, "points": 200, "icon": "🌐", "locked_by": ["FLAG8"]},
    {"id": "room10",  "name": "The Evidence",     "chapter": 4, "points": 250, "icon": "📊", "locked_by": ["FLAG9"]},
    {"id": "room11",  "name": "The Clockwork",    "chapter": 4, "points": 250, "icon": "⏰", "locked_by": ["FLAG10"]},
    {"id": "final",   "name": "The Escape",       "chapter": 5, "points": 500, "icon": "💀", "locked_by": ["FLAG11"]},
    {"id": "secret-a","name": "The Leak",         "chapter": 0, "points": 300, "icon": "🔮", "locked_by": ["FLAG6"]},
    {"id": "secret-b","name": "The Ghost",        "chapter": 0, "points": 300, "icon": "👻", "locked_by": ["FLAG7"]},
]

HINTS: dict[str, list[dict]] = {
    "room0":  [
        {"level": 1, "cost": 0,  "text": "試試 man ls 或 man cat"},
        {"level": 2, "cost": 0,  "text": "查看 /etc/motd 這個檔案"},
        {"level": 3, "cost": 0,  "text": "cat /etc/motd"},
    ],
    "room1":  [
        {"level": 1, "cost": 0,  "text": "有些檔案的內容是 base64 編碼的"},
        {"level": 2, "cost": 25, "text": "用 find / -name '*.encoded' 2>/dev/null 找看看"},
        {"level": 3, "cost": 50, "text": "find /home -name '*.encoded' | xargs base64 -d"},
    ],
    "room2":  [
        {"level": 1, "cost": 0,  "text": "你沒辦法直接讀 /secret/flag.txt，試試看有什麼 sudo 權限"},
        {"level": 2, "cost": 25, "text": "sudo -l 看看，注意 backup.sh 的內容"},
        {"level": 3, "cost": 50, "text": "sudo /usr/local/bin/backup.sh /secret/flag.txt && cat /tmp/out"},
    ],
    "room3":  [
        {"level": 1, "cost": 0,  "text": "背景有個程序在執行，用 ps aux 找看看"},
        {"level": 2, "cost": 25, "text": "ps aux | grep flag，找到 PID 後看 /proc/<PID>/cmdline"},
        {"level": 3, "cost": 50, "text": "kill -USR1 <PID> 會觸發程序輸出 FLAG"},
    ],
    "room4":  [
        {"level": 1, "cost": 0,  "text": "有個 locked-server 只接受公鑰認證"},
        {"level": 2, "cost": 25, "text": "先 ssh-keygen 生成 key pair，再把公鑰加到 locked-server"},
        {"level": 3, "cost": 50, "text": "ssh-keygen -t ed25519 && ssh-copy-id -i ~/.ssh/id_ed25519.pub player@locked-server"},
    ],
    "room5":  [
        {"level": 1, "cost": 0,  "text": "有個服務在某個 port 上，但你不知道是哪個"},
        {"level": 2, "cost": 25, "text": "ss -tlnp 看開啟的 port，然後用 nc 連線"},
        {"level": 3, "cost": 50, "text": "PORT=$(ss -tlnp | grep LISTEN | awk '{print $4}' | cut -d: -f2 | tail -1) && nc localhost $PORT"},
    ],
    "room6":  [
        {"level": 1, "cost": 0,  "text": "有好幾個停止的容器，藏著跨容器洩漏的機密資訊，其中一個就是本關的 FLAG"},
        {"level": 2, "cost": 25, "text": "docker ps -a 找到 ghost-alpha/beta/gamma/delta，分別用 logs、inspect、exec 讀取"},
        {"level": 3, "cost": 50, "text": "docker logs ghost-delta 直接印出本關的 EscapeDocker{...}；其餘 ghost-alpha/beta/gamma 是 docker.sock 濫用的練習，跟 FLAG 無關"},
    ],
    "room7":  [
        {"level": 1, "cost": 0,  "text": "有個 Dockerfile 需要修正才能讓程式輸出 FLAG"},
        {"level": 2, "cost": 25, "text": "看看 /home/player/challenge/Dockerfile，找到 RUN 指令的錯誤"},
        {"level": 3, "cost": 50, "text": "修正 CMD 那行，然後 docker build -t fixed . && docker run --rm fixed"},
    ],
    "room8":  [
        {"level": 1, "cost": 0,  "text": "docker-compose.yml 有缺少的 depends_on 和 environment 設定"},
        {"level": 2, "cost": 25, "text": "服務 app 需要 DB_HOST=database 才能啟動"},
        {"level": 3, "cost": 50, "text": "補全 depends_on: [database] 和 environment: DB_HOST=database，然後 docker compose up"},
    ],
    "room9":  [
        {"level": 1, "cost": 0,  "text": "secret-server.internal 在一個隔離的網路裡，你現在連不到它"},
        {"level": 2, "cost": 25, "text": "docker network ls 找到 secret_net，然後把自己的容器加入那個網路"},
        {"level": 3, "cost": 50, "text": "docker network connect escape-docker_secret_net room9 && curl -H 'X-Token: room9_player' http://secret-server.internal/secret"},
    ],
    "room10": [
        {"level": 1, "cost": 0,  "text": "三個 log 檔案環環相扣，先從 auth.log 開始"},
        {"level": 2, "cost": 25, "text": "grep 'Failed' auth.log | awk '{print $11}' | sort | uniq -c | sort -rn | head -1"},
        {"level": 3, "cost": 50, "text": "ATTACKER_IP=$(grep 'Failed' auth.log | awk '{print $11}' | sort | uniq -c | sort -rn | head -1 | awk '{print $2}') && grep $ATTACKER_IP nginx.log | awk '{print $7}' | sort -u"},
    ],
    "room11": [
        {"level": 1, "cost": 0,  "text": "有個 cron job 每分鐘執行一個加密腳本"},
        {"level": 2, "cost": 25, "text": "crontab -l 看排程，找到腳本路徑後分析它"},
        {"level": 3, "cost": 50, "text": "cat /etc/cron.d/encrypt_job，分析腳本後在 /tmp/key 寫入正確的 key，等一分鐘"},
    ],
    "final":  [
        {"level": 1, "cost": 0,  "text": "ls /var/run/ 看看有什麼有趣的 socket"},
        {"level": 2, "cost": 25, "text": "curl --unix-socket /var/run/docker.sock http://localhost/containers/json | python3 -m json.tool"},
        {"level": 3, "cost": 50, "text": "用 Docker API 找到 vault 容器的 ID，然後用 exec endpoint 執行 cat /final_flag.txt"},
    ],
    "secret-a": [
        {"level": 1, "cost": 0,  "text": "這個容器的設定本身就有問題"},
        {"level": 2, "cost": 25, "text": "docker inspect secret-a | grep -i secret"},
        {"level": 3, "cost": 50, "text": "docker inspect secret-a | grep LEAKED_SECRET"},
    ],
    "secret-b": [
        {"level": 1, "cost": 0,  "text": "有個 image 的歷史裡藏著秘密"},
        {"level": 2, "cost": 25, "text": "docker history escape-docker-secret-b:latest"},
        {"level": 3, "cost": 50, "text": "docker save escape-docker-secret-b | tar x -C /tmp/layers && cd /tmp/layers/blobs/sha256 && for f in *; do tar tf \"$f\" 2>/dev/null | grep -q ghost_layer && tar xf \"$f\" -O tmp/ghost_layer/deleted_secret.txt; done"},
    ],
}
