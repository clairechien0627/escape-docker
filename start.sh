#!/bin/bash
# ═══════════════════════════════════════════
#   Escape Docker — 一鍵啟動腳本
# ═══════════════════════════════════════════
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

echo ""
echo -e "${GREEN}${BOLD}"
echo "  ╔═══════════════════════════════════════╗"
echo "  ║      🐳  Escape Docker  🐳             ║"
echo "  ║  Linux 與 Docker 互動式密室逃脫系統    ║"
echo "  ╚═══════════════════════════════════════╝"
echo -e "${RESET}"

# ── 建立 .env（如果不存在）
if [ ! -f .env ]; then
    echo -e "${YELLOW}[!] .env 不存在，從 .env.example 複製...${RESET}"
    cp .env.example .env
    echo -e "${GREEN}[✓] 已建立 .env，你可以修改 FLAG_SEED 來重新生成所有 FLAG${RESET}"
fi

# ── 載入 .env
export $(grep -v '^#' .env | xargs) 2>/dev/null || true

echo ""
echo -e "${BLUE}[1/3] Building images...${RESET}"
docker compose build --parallel

echo ""
echo -e "${BLUE}[2/3] Starting services...${RESET}"
docker compose up -d

echo ""
echo -e "${BLUE}[3/3] Waiting for services to be ready...${RESET}"
sleep 3

# ── 確認服務狀態
echo ""
echo -e "${BOLD}=== Service Status ===${RESET}"
docker compose ps

# ── 完成訊息
echo ""
echo -e "${GREEN}${BOLD}✅ Escape Docker 已啟動！${RESET}"
echo ""
echo -e "${CYAN}  🌐 遊戲入口：    ${BOLD}http://localhost${RESET}"
echo -e "${CYAN}  📊 排行榜：      ${BOLD}http://localhost/scoreboard.html${RESET}"
echo -e "${CYAN}  🗺️  房間地圖：    ${BOLD}http://localhost/map.html${RESET}"
echo -e "${CYAN}  🔴 Admin Panel：  ${BOLD}http://localhost/admin.html${RESET}"
echo ""
echo -e "${YELLOW}  Admin Token: $(grep ADMIN_TOKEN .env | cut -d= -f2)${RESET}"
echo ""
echo -e "  停止系統：${BOLD}docker compose down${RESET}"
echo ""
