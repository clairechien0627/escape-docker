#!/bin/bash
export FLAG_SEED="${FLAG_SEED:-escape_docker_dev_seed}"

# 啟動 SSH daemon
/usr/sbin/sshd

# 啟動 flag server（只監聽 localhost）
python3 /flag_server.py &

# 保持容器存活
tail -f /dev/null
