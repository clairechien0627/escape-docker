#!/bin/bash
set -e
cat > /etc/motd << 'MOTD'

  ╔═══════════════════════════════════════════════════╗
  ║   🔮  SECRET ROOM A: The Leak                     ║
  ╚═══════════════════════════════════════════════════╝

  你發現了一個秘密房間！

  有人不小心把秘密放進了容器的環境變數裡。

  任務：
    docker inspect secret-a
    → 找出 REAL_FLAG 環境變數

  或：
    docker inspect secret-a | grep -i "flag\|secret\|leaked"

MOTD

cat >> /home/player/.bashrc << 'BASHRC'
alias mission='cat /etc/motd'
BASHRC
chown -R player:player /home/player
