#!/bin/bash
FLAG=$(echo -n "${FLAG_SEED:-escape_docker_dev_seed}-room0" | sha256sum | cut -c1-16)
FLAG_VAL="EscapeDocker{${FLAG}}"

# 清掉舊的 FLAG 行，重新寫入正確的（idempotent）
sed -i '/FLAG:/d;/─────/d' /etc/motd
printf '\n  ─────────────────────────────────────────────────\n  FLAG: %s\n  ─────────────────────────────────────────────────\n\n' "$FLAG_VAL" >> /etc/motd

exec "$@"
