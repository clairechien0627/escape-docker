#!/bin/bash
set -e

mkdir -p /home/player/challenge

cat > /home/player/challenge/docker-compose.yml << 'YAML'
# ============================================
# Room 8 Challenge: The Fleet
# 這份 docker-compose.yml 有幾個問題需要修正
# ============================================

version: "3.9"
services:

  database:
    image: alpine:3.19
    command: >
      sh -c "
        echo 'Database is ready' &&
        while true; do
          echo 'DB: heartbeat' >> /var/log/db.log
          sleep 10
        done
      "
    # TODO: 加入 healthcheck 確保 app 等 database 就緒後才啟動

  app:
    image: python:3.11-slim
    environment:
      - FLAG_SEED=${FLAG_SEED}
    # BUG 1: 缺少 depends_on
    # BUG 2: 缺少必要的環境變數 DB_HOST
    command: |
      sh -c "
        python3 -c \"
      import os, hashlib, time, http.server

      db_host = os.environ.get('DB_HOST', '')
      seed = os.environ.get('FLAG_SEED', 'dev')

      if not db_host:
          print('ERROR: DB_HOST not set! Fix the docker-compose.yml')
          exit(1)

      flag = 'EscapeDocker{' + hashlib.sha256(f'{seed}-room8'.encode()).hexdigest()[:16] + '}'

      class H(http.server.BaseHTTPRequestHandler):
          def log_message(self, *a): pass
          def do_GET(self):
              self.send_response(200)
              self.send_header('Content-Type', 'text/plain')
              self.end_headers()
              self.wfile.write(f'Connected to DB: {db_host}\\nFLAG: {flag}\\n'.encode())

      print(f'App started! DB_HOST={db_host}')
      http.server.HTTPServer(('0.0.0.0', 8080), H).serve_forever()
        \"
      "
    ports:
      - "8080:8080"
YAML

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
# ── 修正無換行指令後 prompt 黏行 ──
cat > /etc/profile.d/prompt-newline.sh << 'EOF'
PROMPT_COMMAND='printf "%${COLUMNS:-80}s\r\033[K" ""'
EOF

chown -R player:player /home/player
