#!/bin/bash
export FLAG_SEED="${FLAG_SEED:-escape_docker_dev_seed}"
echo "172.22.0.50  mystery.internal" >> /etc/hosts
python3 /riddle_server.py &
exec "$@"
