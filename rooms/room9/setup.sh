#!/bin/bash
set -e
cat > /etc/motd << 'MOTD'

  ╔═══════════════════════════════════════════════════╗
  ║  🌐  ESCAPE DOCKER  —  Room 9: Network Maze       ║
  ╚═══════════════════════════════════════════════════╝

  secret-server.internal 藏著 FLAG，但它在隔離的 secret_net 裡。
  你現在連不到它。

  你需要：
    1. 找到正確的網路名稱
    2. 把 room9 容器加入那個網路
    3. 帶著正確的 Token 存取 API

  探索：
    docker network ls                    # 列出所有網路
    docker network inspect <name>        # 查看網路詳情
    ping secret-server.internal          # 先試試（會失敗）

  加入網路：
    docker network connect <network> room9

  存取 API：
    curl http://secret-server.internal/         # 看說明
    curl http://secret-server.internal/hint     # 取得提示
    curl -H "X-Token: room9_player" \
         http://secret-server.internal/secret   # 帶 Token 存取

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
