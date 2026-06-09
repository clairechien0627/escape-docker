#!/bin/bash
export FLAG_SEED="${FLAG_SEED:-escape_docker_dev_seed}"
# 把 FLAG_SEED 寫入 challenge 目錄的 .env（讓 docker compose 可以用）
echo "FLAG_SEED=${FLAG_SEED}" > /home/player/challenge/.env
chown player:player /home/player/challenge/.env
exec "$@"
