#!/bin/bash
# ═══════════════════════════════════════════
#   Escape Docker — FLAG 一致性檢查腳本
# ═══════════════════════════════════════════
#
# 用途：驗證每個房間「實際存在的 FLAG」是否與依目前 .env 的
#       FLAG_SEED 計算出來的「期望 FLAG」一致。可在每次
#       docker compose build / up 後執行，作為 demo 前的健康檢查。
#
# 用法：./scripts/verify-flags.sh

cd "$(dirname "$0")/.."

# Git Bash 在 Windows 上會把 `/etc/motd` 這類「獨立的」絕對路徑參數
# 自動轉成 Windows 路徑（例如 C:/Program Files/Git/etc/motd），
# 導致傳給 docker exec 的容器內路徑被改寫。關閉這個轉換行為。
export MSYS_NO_PATHCONV=1

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
RESET='\033[0m'

# ── 載入 .env 的 FLAG_SEED ──
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs) 2>/dev/null || true
fi
FLAG_SEED="${FLAG_SEED:-escape_docker_dev_seed}"

PASS=0
FAIL=0

# 依公式計算期望 FLAG：EscapeDocker{sha256(FLAG_SEED-<suffix>)[:16]}
gen_flag() {
    local raw
    raw=$(echo -n "${FLAG_SEED}-$1" | sha256sum | cut -c1-16)
    echo "EscapeDocker{${raw}}"
}

# room-manager 預設會把閒置房間 stop 掉，檢查前先確保 container 是 running
ensure_running() {
    local container="$1"
    local state
    state=$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null)
    if [ "$state" != "true" ]; then
        docker start "$container" >/dev/null 2>&1
        sleep 2
    fi
}

# 直接比對：期望值 vs 從容器內取出的實際值
check_flag() {
    local room="$1" expected="$2" actual="$3"
    if [ -n "$actual" ] && [ "$actual" = "$expected" ]; then
        echo -e "${GREEN}✅ ${room}${RESET}：FLAG 一致"
        PASS=$((PASS + 1))
    else
        echo -e "${RED}❌ ${room}${RESET}：FLAG 不一致"
        echo -e "   期望：${expected}"
        echo -e "   實際：${actual:-<無法取得，容器可能未啟動>}"
        FAIL=$((FAIL + 1))
    fi
}

# 間接比對：容器內的 FLAG_SEED 是否與目前 .env 一致
# （room3/5/6/7/8/secret-a/secret-b 的 FLAG 是 entrypoint/腳本依 FLAG_SEED
#  在 runtime 動態計算，沒有單一靜態檔案可直接比對，因此改為確認容器拿到
#  的 FLAG_SEED 與目前 .env 相同——這正是過去 FLAG mismatch 的根因：
#  容器沒有用最新的 FLAG_SEED 重建）
check_seed() {
    local room="$1" container="$2"
    local actual_seed
    actual_seed=$(docker exec "$container" printenv FLAG_SEED 2>/dev/null)
    if [ -n "$actual_seed" ] && [ "$actual_seed" = "$FLAG_SEED" ]; then
        echo -e "${GREEN}✅ ${room}${RESET}：FLAG_SEED 一致（${container}）"
        PASS=$((PASS + 1))
    else
        echo -e "${RED}❌ ${room}${RESET}：FLAG_SEED 不一致（${container}）"
        echo -e "   期望：${FLAG_SEED}"
        echo -e "   實際：${actual_seed:-<無法取得，容器可能未啟動>}"
        echo -e "   ${YELLOW}→ 請執行 docker compose up -d --force-recreate ${container}${RESET}"
        FAIL=$((FAIL + 1))
    fi
}

echo -e "${BOLD}=== Escape Docker FLAG 一致性檢查 ===${RESET}"
echo "FLAG_SEED = ${FLAG_SEED}"
echo ""

# ── room0: FLAG 寫在 /etc/motd ──
ensure_running room0
check_flag "room0" "$(gen_flag room0)" \
    "$(docker exec room0 grep -oE 'EscapeDocker\{[a-f0-9]+\}' /etc/motd 2>/dev/null | head -1)"

# ── room1: base64 編碼藏在 archive 裡 ──
ensure_running room1
check_flag "room1" "$(gen_flag room1)" \
    "$(docker exec room1 sh -c 'base64 -d "/home/player/archive/dir_037/backups/2023/system_backup.encoded"' 2>/dev/null)"

# ── room2: /secret/flag.txt（root-only） ──
ensure_running room2
check_flag "room2" "$(gen_flag room2)" \
    "$(docker exec -u root room2 cat /secret/flag.txt 2>/dev/null)"

# ── room3: flag_daemon.py 依 FLAG_SEED 動態算，僅檢查 FLAG_SEED ──
ensure_running room3
check_seed "room3" "room3"

# ── room4: 由 locked-server 的 flag_server.py（127.0.0.1:9090）提供 ──
ensure_running locked-server
check_flag "room4" "$(gen_flag room4)" \
    "$(docker exec locked-server python3 -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:9090/flag').read().decode().strip())" 2>/dev/null)"

# ── room5: riddle_server.py 依 FLAG_SEED 動態算，僅檢查 FLAG_SEED ──
ensure_running room5
check_seed "room5" "room5"

# ── room6: FLAG 由 ghost-alpha/beta/gamma 三個容器組成，僅檢查 FLAG_SEED ──
ensure_running room6
check_seed "room6" "room6"

# ── room7: Docker build 練習，僅檢查 FLAG_SEED ──
ensure_running room7
check_seed "room7" "room7"

# ── room8: docker compose 練習，FLAG_SEED 寫入 challenge/.env，僅檢查 FLAG_SEED ──
ensure_running room8
check_seed "room8" "room8"

# ── room9: 由 secret-server（X-Token 驗證）提供 ──
ensure_running secret-server
check_flag "room9" "$(gen_flag room9)" \
    "$(docker exec secret-server python3 -c "
import urllib.request
req = urllib.request.Request('http://127.0.0.1/secret', headers={'X-Token': 'room9_player'})
print(urllib.request.urlopen(req).read().decode().strip())
" 2>/dev/null | sed -n 's/^FLAG: //p')"

# ── room10: FLAG 以 session token 形式藏在 /var/log/app.log ──
ensure_running room10
check_flag "room10" "$(gen_flag room10)" \
    "$(docker exec room10 grep -oE 'EscapeDocker\{[a-f0-9]+\}' /var/log/app.log 2>/dev/null | head -1)"

# ── room11: /secret/data（root-only） ──
ensure_running room11
check_flag "room11" "$(gen_flag room11)" \
    "$(docker exec -u root room11 cat /secret/data 2>/dev/null)"

# ── final: vault 容器的 /final_flag.txt ──
ensure_running vault
check_flag "final" "$(gen_flag final)" \
    "$(docker exec vault cat /final_flag.txt 2>/dev/null)"

# ── secret-a: REAL_FLAG 由 entrypoint export，僅檢查 FLAG_SEED ──
ensure_running secret-a
check_seed "secret-a" "secret-a"

# ── secret-b: FLAG 在 image build 階段就烘烤進 layer，僅檢查 FLAG_SEED ──
ensure_running secret-b
check_seed "secret-b" "secret-b"

echo ""
echo -e "${BOLD}=== 結果：${GREEN}${PASS} 通過${RESET} / ${RED}${FAIL} 失敗${RESET} ===${RESET}"

if [ "$FAIL" -gt 0 ]; then
    exit 1
fi
