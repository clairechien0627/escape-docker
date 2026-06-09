#!/bin/bash
set -e

# SSH config
mkdir -p /home/player/.ssh
chmod 700 /home/player/.ssh
cat > /home/player/.ssh/config << 'SSHCONF'
Host locked-server
    HostName locked-server
    User player
    Port 22
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
SSHCONF
chmod 600 /home/player/.ssh/config

cat > /etc/motd << 'MOTD'

  ╔═══════════════════════════════════════════════════╗
  ║   🔑  ESCAPE DOCKER  —  Room 4: The Locksmith     ║
  ╚═══════════════════════════════════════════════════╝

  有個 locked-server 藏著 FLAG，但它只接受 SSH 公鑰認證。

  密碼登入已被停用。你需要生成自己的 SSH 金鑰對。

  步驟：
    1. 生成金鑰對
       ssh-keygen -t ed25519 -C "ctf_player" -f ~/.ssh/id_ed25519

    2. 把公鑰安裝到 locked-server
       ssh-copy-id -i ~/.ssh/id_ed25519.pub player@locked-server
       （或手動複製到 locked-server 的 ~/.ssh/authorized_keys）

    3. SSH 登入
       ssh locked-server

  進階任務：
    FLAG 在 locked-server 的 localhost:9090
    需要建立 SSH tunnel 才能存取：
       ssh -L 8888:localhost:9090 locked-server
       curl localhost:8888/flag

MOTD

cat >> /home/player/.bashrc << 'BASHRC'
alias mission='cat /etc/motd'
echo "  輸入 'mission' 查看任務說明"
BASHRC

chown -R player:player /home/player
