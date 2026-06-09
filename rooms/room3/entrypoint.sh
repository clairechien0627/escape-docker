#!/bin/bash
export FLAG_SEED="${FLAG_SEED:-escape_docker_dev_seed}"

# 啟動背景 flag daemon
python3 /flag_daemon.py &
DAEMON_PID=$!

# 讓玩家可以找到 daemon 的 PID（不直接給，讓他們自己找）
echo "$DAEMON_PID" > /var/run/flag_daemon.pid
chmod 000 /var/run/flag_daemon.pid  # 藏起來，讓他們用 ps 找

exec "$@"
