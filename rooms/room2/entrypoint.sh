#!/bin/bash
# 動態生成 FLAG（因為 FLAG_SEED 是 runtime env var）
FLAG=$(echo "${FLAG_SEED:-escape_docker_dev_seed}-room2" | sha256sum | cut -c1-16)
FLAG_VAL="EscapeDocker{${FLAG}}"

# 每次啟動都把 FLAG 寫入 /secret/flag.txt
mkdir -p /secret
echo "$FLAG_VAL" > /secret/flag.txt
chmod 400 /secret/flag.txt
chown root:root /secret/flag.txt

exec "$@"
