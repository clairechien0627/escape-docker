#!/bin/bash
set -e
cat > /etc/motd << 'MOTD'

  ╔═══════════════════════════════════════════════════╗
  ║   🚢  ESCAPE DOCKER  —  Room 8: The Fleet         ║
  ╚═══════════════════════════════════════════════════╝

  /home/player/challenge/ 有份不完整的 docker-compose.yml。

  任務：修正設定，讓 app 服務正確啟動並回傳 FLAG。

  問題：
    1. app 沒有等 database 就緒（缺少 depends_on）
    2. app 缺少必要的環境變數 DB_HOST

  操作：
    cd /home/player/challenge
    cat docker-compose.yml          # 讀懂設定
    docker compose up               # 嘗試啟動（會失敗）
    docker compose logs app         # 看錯誤訊息
    vim docker-compose.yml          # 修正
    docker compose up               # 再試一次
    curl localhost:8080             # 取得 FLAG

MOTD

cat >> /home/player/.bashrc << 'BASHRC'
alias mission='cat /etc/motd'
echo "  輸入 'mission' 查看任務說明"
BASHRC
chown -R player:player /home/player
