#!/bin/bash
export FLAG_SEED="${FLAG_SEED:-escape_docker_dev_seed}"
python3 /generate_logs.py
exec "$@"
