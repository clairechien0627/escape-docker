#!/bin/bash
set -e

cat > /etc/motd << 'MOTD'

  ╔═══════════════════════════════════════════════════╗
  ║   📡  ESCAPE DOCKER  —  Room 5: The Wire          ║
  ╚═══════════════════════════════════════════════════╝

  有個服務在某個未知的 port 上監聽，等著你連線。

  你需要：
  1. 找到那個服務在哪個 port
  2. 連線並回答謎語

  工具：
    ss -tlnp                       # 列出監聽中的 TCP port
    netstat -tlnp                  # 也可以用這個（需要 net-tools）
    nc localhost <PORT>            # 用 netcat 連線
    curl localhost:<PORT>          # 或用 curl

  進階：
    cat /etc/hosts                 # 看看有沒有特別的 host 設定

MOTD

cat >> /home/player/.bashrc << 'BASHRC'
alias mission='cat /etc/motd'
echo "  輸入 'mission' 查看任務說明"
BASHRC

# ── 修正無換行指令後 prompt 黏行 ──
cat > /etc/profile.d/prompt-newline.sh << 'EOF'
PROMPT_COMMAND='printf "%$(( ${COLUMNS:-80} - 1 ))s\r\033[K" ""'
EOF

chown -R player:player /home/player
