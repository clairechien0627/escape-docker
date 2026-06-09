#!/bin/bash
set -e
cat > /etc/motd << 'MOTD'

  ╔═══════════════════════════════════════════════════╗
  ║   🐳  ESCAPE DOCKER  —  Room 6: The Shipyard      ║
  ╚═══════════════════════════════════════════════════╝

  有三個停止的容器，每個藏著 FLAG 的一部分：
    ghost-alpha  → 用 docker logs 找
    ghost-beta   → 用 docker inspect 找（ENV 裡）
    ghost-gamma  → 需要 start 後用 docker exec 讀

  工具：
    docker ps -a                              # 列出所有容器（包含停止的）
    docker logs ghost-alpha                   # 查看容器日誌
    docker inspect ghost-beta                 # 詳細資訊（JSON）
    docker inspect ghost-beta | grep FLAG     # 過濾 FLAG 相關
    docker start ghost-gamma                  # 啟動停止的容器
    docker exec ghost-gamma cat /app/secret/fragment.txt  # 讀取檔案
    docker diff ghost-gamma                   # 查看容器檔案變化

  三個部分合起來就是完整的 FLAG！

MOTD

cat >> /home/player/.bashrc << 'BASHRC'
alias mission='cat /etc/motd'
echo "  輸入 'mission' 查看任務說明"
BASHRC

chown -R player:player /home/player
