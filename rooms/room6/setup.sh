#!/bin/bash
set -e
cat > /etc/motd << 'MOTD'

  ╔═══════════════════════════════════════════════════╗
  ║   🐳  ESCAPE DOCKER  —  Room 6: The Shipyard      ║
  ╚═══════════════════════════════════════════════════╝

  有好幾個停止的容器，藏著跨容器洩漏的機密資訊：
    ghost-alpha  → 用 docker logs 找
    ghost-beta   → 用 docker inspect 找（ENV 裡）
    ghost-gamma  → 需要 start 後用 docker exec 讀
    ghost-delta  → 用 docker logs 找（這裡才是本關真正的 FLAG！）

  工具：
    docker ps -a                              # 列出所有容器（包含停止的）
    docker logs ghost-alpha                   # 查看容器日誌
    docker inspect ghost-beta                 # 詳細資訊（JSON）
    docker inspect ghost-beta | grep FLAG     # 過濾 FLAG 相關
    docker start ghost-gamma                  # 啟動停止的容器
    docker exec ghost-gamma cat /app/secret/fragment.txt  # 讀取檔案
    docker diff ghost-gamma                   # 查看容器檔案變化
    docker logs ghost-delta                   # 讀取真正的 FLAG（EscapeDocker{...}）

  把 ghost-delta 印出的 EscapeDocker{...} 提交到 scoreboard 即可過關！

MOTD

cat >> /home/player/.bashrc << 'BASHRC'
alias mission='cat /etc/motd'
echo "  輸入 'mission' 查看任務說明"
BASHRC

# ── 修正無換行指令後 prompt 黏行 ──
cat > /etc/profile.d/prompt-newline.sh << 'EOF'
PROMPT_COMMAND='printf "%${COLUMNS:-80}s\r\033[K" ""'
EOF

chown -R player:player /home/player
