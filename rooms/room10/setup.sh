#!/bin/bash
set -e
cat > /etc/motd << 'MOTD'

  ╔═══════════════════════════════════════════════════╗
  ║  📊  ESCAPE DOCKER  —  Room 10: The Evidence      ║
  ╚═══════════════════════════════════════════════════╝

  /var/log/ 下有三個關聯的 log 檔案：
    auth.log   → SSH 登入記錄
    nginx.log  → Web 存取記錄
    app.log    → 應用程式日誌

  任務（多步驟）：
    Step 1：從 auth.log 找出暴力破解次數最多的 IP
    Step 2：從 nginx.log 找出該 IP 存取的敏感路徑
    Step 3：從 app.log 找出 session token

  工具：
    grep "Failed" /var/log/auth.log | awk '{print $11}' | sort | uniq -c | sort -rn
    grep "<ATTACKER_IP>" /var/log/nginx.log | awk '{print $7}'
    grep "<PATH>" /var/log/app.log

  Session token 就是 FLAG！

MOTD

cat >> /home/player/.bashrc << 'BASHRC'
alias mission='cat /etc/motd'
echo "  輸入 'mission' 查看任務說明"
BASHRC
# ── 修正無換行指令後 prompt 黏行 ──
cat > /etc/profile.d/prompt-newline.sh << 'EOF'
PROMPT_COMMAND='printf "%${COLUMNS:-80}s\r\033[K" ""'
EOF

chown -R player:player /home/player
