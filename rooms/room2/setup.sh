#!/bin/bash
set -e

# ── 安裝 backup.sh ──
cp /scripts/backup.sh /usr/local/bin/backup.sh
chmod 755 /usr/local/bin/backup.sh
chown root:root /usr/local/bin/backup.sh

# ── Sudoers：player 只能執行 backup.sh ──
echo "player ALL=(root) NOPASSWD: /usr/local/bin/backup.sh" > /etc/sudoers.d/player
chmod 440 /etc/sudoers.d/player

# ── 建立 /secret 目錄（FLAG 由 entrypoint 動態寫入）──
mkdir -p /secret
chmod 700 /secret

# ── /tmp/out 初始（玩家可讀）──
touch /tmp/out
chmod 644 /tmp/out

# ── 教育說明檔（完成後閱讀）──
mkdir -p /home/player/education
cat > /home/player/education/README_after_solve.txt << 'TXT'
=== 為什麼 backup.sh 有漏洞？===

問題出在這行：
  cp $1 /tmp/out

正確的寫法應該是：
  cp "$1" /tmp/out   ← 加上引號

沒有引號的問題：
  1. 空格會被當作分隔符（可以注入多個參數）
  2. 路徑注入：攻擊者可以自由指定任何系統路徑
  3. 萬用字元展開（globbing）：* ? [] 都會被展開

修正方法：
  1. 一定要 quote 所有變數："$1" 而非 $1
  2. 加入輸入驗證：只允許特定目錄的檔案
  3. 使用 sudo 的 Cmnd_Alias 限制更嚴格的路徑

這個漏洞叫做「不安全的 shell script」，
在實際系統中非常常見，務必記住！
TXT

# ── 任務說明 ──
cat > /etc/motd << 'MOTD'

  ╔═══════════════════════════════════════════════════╗
  ║    🔐  ESCAPE DOCKER  —  Room 2: The Vault        ║
  ╚═══════════════════════════════════════════════════╝

  /secret/flag.txt 被鎖起來了。

    $ cat /secret/flag.txt
    cat: /secret/flag.txt: Permission denied

  你沒有直接讀取的權限。但這個系統有 sudo。

  任務：想辦法讀到 /secret/flag.txt 的內容。

  起點：
    sudo -l                        # 查看你的 sudo 權限
    cat /usr/local/bin/backup.sh   # 仔細看這個腳本

  完成後閱讀：/home/player/education/README_after_solve.txt

MOTD

# ── .bashrc ──
cat >> /home/player/.bashrc << 'BASHRC'
alias mission='cat /etc/motd'
echo "  輸入 'mission' 查看任務說明"
BASHRC

chown -R player:player /home/player
