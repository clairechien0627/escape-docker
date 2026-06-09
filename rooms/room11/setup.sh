#!/bin/bash
set -e
mkdir -p /var/log
touch /var/log/encrypt.log
chmod 666 /var/log/encrypt.log

cat > /etc/motd << 'MOTD'

  ╔═══════════════════════════════════════════════════╗
  ║  ⏰  ESCAPE DOCKER  —  Room 11: The Clockwork     ║
  ╚═══════════════════════════════════════════════════╝

  /secret/data 裡藏著 FLAG，但你沒有讀取權限。

  有個 cron job 每分鐘執行一個腳本，它可以幫你解密。

  你需要：
    Step 1：找到那個 cron job
      crontab -l                        # 使用者 cron
      cat /etc/cron.d/*                 # 系統 cron

    Step 2：分析加密腳本
      cat /usr/local/bin/encrypt.sh

    Step 3：寫入正確的 key
      echo "<key>" > /tmp/key

    Step 4：等 cron 執行（最多 1 分鐘），讀取結果
      watch cat /tmp/result             # 或
      tail -f /var/log/encrypt.log      # 看 cron 日誌

MOTD

cat >> /home/player/.bashrc << 'BASHRC'
alias mission='cat /etc/motd'
echo "  輸入 'mission' 查看任務說明"
BASHRC
chown -R player:player /home/player
