#!/bin/bash
export FLAG_SEED="${FLAG_SEED:-escape_docker_dev_seed}"
export LEAKED_SECRET="${FLAG_SEED}"
FLAG=$(echo "${FLAG_SEED}-secret-a" | sha256sum | cut -c1-16)
export REAL_FLAG="EscapeDocker{${FLAG}}"
exec "$@"
