#!/bin/bash
set -e

# ── Challenge：壞掉的 Dockerfile ──
mkdir -p /home/player/challenge/app

cat > /home/player/challenge/app/main.py << 'PY'
#!/usr/bin/env python3
import os, hashlib
seed = os.environ.get("FLAG_SEED", "escape_docker_dev_seed")
flag = "EscapeDocker{" + hashlib.sha256(f"{seed}-room7".encode()).hexdigest()[:16] + "}"
print(f"FLAG: {flag}")
PY

# 故意寫錯的 Dockerfile（有 bug 要修）
cat > /home/player/challenge/Dockerfile << 'DOCKERFILE'
FROM python:3.11-slim

WORKDIR /app
COPY app/ .

# BUG 1: 環境變數沒有傳入
# BUG 2: CMD 指令路徑錯誤
ENV FLAG_SEED=""

CMD ["python3", "main.py"]
DOCKERFILE

# 說明檔
cat > /home/player/challenge/MISSION.txt << 'TXT'
=== The Workshop Mission ===

目錄結構：
  challenge/
  ├── Dockerfile    ← 有問題，需要修正
  └── app/
      └── main.py   ← 程式本身是對的

問題：build 之後執行，FLAG_SEED 沒有正確傳入。

任務：
  1. 讀懂 Dockerfile 和 main.py
  2. 修正 Dockerfile 讓 FLAG_SEED 能正確傳入
  3. docker build -t fixed-room7 .
  4. docker run --rm fixed-room7

提示：
  - ENV 的值不能是空字串（需要傳入 build arg 或 run arg）
  - 試試：docker run --rm -e FLAG_SEED=xxx fixed-room7
  - 或使用 ARG + ENV 搭配 --build-arg

進階謎題：
  docker history fixed-room7
  → 找找看 build 歷史裡有沒有什麼秘密層？
TXT

cat > /etc/motd << 'MOTD'

  ╔═══════════════════════════════════════════════════╗
  ║  🏗️  ESCAPE DOCKER  —  Room 7: The Workshop       ║
  ╚═══════════════════════════════════════════════════╝

  /home/player/challenge/ 裡有個壞掉的 Dockerfile。

  任務：修正 Dockerfile，讓程式能正確輸出 FLAG。

  開始：
    cat /home/player/challenge/MISSION.txt
    cat /home/player/challenge/Dockerfile
    cat /home/player/challenge/app/main.py

MOTD

cat >> /home/player/.bashrc << 'BASHRC'
alias mission='cat /etc/motd'
echo "  輸入 'mission' 查看任務說明"
BASHRC

chown -R player:player /home/player
