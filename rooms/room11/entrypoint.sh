#!/bin/bash
export FLAG_SEED="${FLAG_SEED:-escape_docker_dev_seed}"

FLAG=$(echo "${FLAG_SEED}-room11" | sha256sum | cut -c1-16)
FLAG_VAL="EscapeDocker{${FLAG}}"

# 把 FLAG 寫入 /secret/data（root 只讀）
mkdir -p /secret
echo "$FLAG_VAL" > /secret/data
chmod 400 /secret/data
chown root:root /secret/data

# 設定 cron job（每分鐘執行 encrypt.sh）
echo "* * * * * root /usr/local/bin/encrypt.sh" > /etc/cron.d/encrypt_job
chmod 644 /etc/cron.d/encrypt_job

# 啟動 cron daemon
service cron start 2>/dev/null || cron

exec "$@"
