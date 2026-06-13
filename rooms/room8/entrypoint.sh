#!/bin/bash
set -e

export FLAG_SEED="${FLAG_SEED:-escape_docker_dev_seed}"
# 把 FLAG_SEED 寫入 challenge 目錄的 .env，讓 docker compose 對
# app service 的 ${FLAG_SEED} 做變數替換
echo "FLAG_SEED=${FLAG_SEED}" > /home/player/challenge/.env
chown player:player /home/player/challenge/.env

# 背景等待 dockerd 的 socket 出現後放寬權限，讓 player 不需 sudo 也能用 docker
( for i in $(seq 1 60); do
    if [ -S /var/run/docker.sock ]; then
      chmod 666 /var/run/docker.sock
      break
    fi
    sleep 0.5
  done ) &

# room8 專用的 Docker daemon（DinD）以 PID 1 在前景執行，維持 container 存活；
# 玩家透過 `docker exec -u player room8 bash` 進入操作。
# storage-driver 用 vfs 避免在 host 的 overlay2 檔案系統上巢狀 overlay2 造成相容性問題
exec dockerd --storage-driver=vfs
