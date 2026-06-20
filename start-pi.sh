#!/bin/bash
# ═══════════════════════════════════════════
#   Escape Docker — Raspberry Pi 啟動腳本
#   資源最小化：基礎設施常駐，room 按需啟動
# ═══════════════════════════════════════════

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
GRAY='\033[0;90m'
NC='\033[0m'

echo ""
echo -e "${GREEN}  ╔═══════════════════════════════════════╗${NC}"
echo -e "${GREEN}  ║      Escape Docker — Pi Mode          ║${NC}"
echo -e "${GREEN}  ║  基礎設施常駐，Room 閒置自動停止       ║${NC}"
echo -e "${GREEN}  ╚═══════════════════════════════════════╝${NC}"
echo ""

# ── 確認在正確目錄
if [ ! -f "docker-compose.yml" ]; then
    echo -e "${RED}❌ 請在專案根目錄執行此腳本${NC}"
    exit 1
fi

# ── 建立 .env（如果不存在）
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}[!] .env 不存在，從 .env.example 複製...${NC}"
    cp .env.example .env
    echo -e "${GREEN}[✓] 已建立 .env${NC}"
fi

# ── 確認 Docker 是否在跑
echo -e "${CYAN}Checking Docker...${NC}"
if ! docker info > /dev/null 2>&1; then
    echo ""
    echo -e "${RED}❌ Docker 沒有在執行！${NC}"
    echo -e "${YELLOW}   請先執行：sudo systemctl start docker${NC}"
    echo ""
    exit 1
fi
echo -e "${GREEN}[✓] Docker is running${NC}"

# ── Build 所有 images（Pi 上限制 2 個平行，避免 OOM）
echo ""
echo -e "${CYAN}[1/3] Building images (Pi 首次約需 20-30 分鐘)...${NC}"
BUILDKIT_MAX_PARALLELISM=2 docker compose build \
    nginx terminal-gateway room-manager scoreboard-api lab-api \
    room0 room1 room2 room3 room4 room5 room6 \
    room7 room8 room9 room10 room11 final \
    locked-server secret-server secret-a secret-b
echo -e "${GREEN}[✓] Build 完成${NC}"

# ── 啟動基礎設施（常駐）
# falco 在 Pi 上需要特定 kernel eBPF 支援，預設略過
# 如需啟用：docker compose up -d falco
echo ""
echo -e "${CYAN}[2/3] 啟動基礎設施服務...${NC}"
docker compose up -d nginx terminal-gateway room-manager scoreboard-api lab-api
echo -e "${GREEN}[✓] 基礎設施已啟動${NC}"

# ── 建立 room containers（stopped 狀態，等 room-manager 按需 docker start）
echo ""
echo -e "${CYAN}[3/3] 建立 Room containers（stopped，待玩家連線時啟動）...${NC}"
docker compose create \
    room0 room1 room2 room3 room4 room5 room6 \
    room7 room8 room9 room10 room11 final \
    locked-server secret-server secret-a secret-b \
    vault ghost-alpha ghost-beta ghost-gamma ghost-delta
echo -e "${GREEN}[✓] Room containers 已建立${NC}"

# ── 等待服務就緒
sleep 3

# ── 狀態摘要
echo ""
echo "=== Service Status ==="
docker compose ps nginx terminal-gateway room-manager scoreboard-api lab-api
echo ""
echo -e "${GRAY}--- Rooms (stopped, on-demand) ---${NC}"
docker compose ps room0 room1 room2 room3 room4 room5 \
    room6 room7 room8 room9 room10 room11 final 2>/dev/null | tail -n +2 || true

# ── 取得 Pi 的 IP
PI_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
PI_IP="${PI_IP:-localhost}"

# ── 讀取 ADMIN_TOKEN
ADMIN_TOKEN="admin_secret_change_me"
if [ -f ".env" ]; then
    TOKEN_LINE=$(grep "^ADMIN_TOKEN=" .env 2>/dev/null || true)
    if [ -n "$TOKEN_LINE" ]; then
        ADMIN_TOKEN="${TOKEN_LINE#ADMIN_TOKEN=}"
    fi
fi

echo ""
echo -e "${GREEN}✅ Escape Docker (Pi Mode) 已啟動！${NC}"
echo ""
echo -e "${CYAN}  遊戲首頁：    http://${PI_IP}${NC}"
echo -e "${CYAN}  排行榜：      http://${PI_IP}/scoreboard.html${NC}"
echo -e "${CYAN}  房間地圖：    http://${PI_IP}/map.html${NC}"
echo -e "${CYAN}  Admin Panel： http://${PI_IP}/admin.html${NC}"
echo ""
echo -e "${YELLOW}  Admin Token: ${ADMIN_TOKEN}${NC}"
echo ""
echo -e "${GRAY}  Room 在玩家連線時自動啟動，閒置 ${ROOM_STOP_IDLE_MINUTES:-10} 分鐘後自動停止${NC}"
echo -e "${GRAY}  停止所有服務：docker compose down${NC}"
echo -e "${GRAY}  查看記憶體用量：docker stats --no-stream${NC}"
echo ""
