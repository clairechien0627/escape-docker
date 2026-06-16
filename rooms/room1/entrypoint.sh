#!/bin/bash
FLAG=$(echo -n "${FLAG_SEED:-escape_docker_dev_seed}-room1" | sha256sum | cut -c1-16)
FLAG_VAL="EscapeDocker{${FLAG}}"
FLAG_B64=$(printf '%s\n' "$FLAG_VAL" | base64)

HIDE_DIR="/home/player/archive/dir_037/backups/2023"
mkdir -p "$HIDE_DIR"
echo "$FLAG_B64" > "$HIDE_DIR/system_backup.encoded"

exec "$@"
