#!/bin/bash
export FLAG_SEED="${FLAG_SEED:-escape_docker_dev_seed}"
python3 /generate_logs.py

# entrypoint 以 root 執行才能寫入 /var/log，最後切換成 player 給玩家使用
exec su - player
