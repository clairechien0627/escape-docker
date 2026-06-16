#!/bin/bash
set -e
cat > /etc/motd << 'MOTD'

  ╔═══════════════════════════════════════════════════╗
  ║   ⚙️  ESCAPE DOCKER  —  Room 3: The Process       ║
  ╚═══════════════════════════════════════════════════╝

  背景有個神秘的程序藏著 FLAG，但它不會主動告訴你。

  你需要：
  1. 找到那個程序的 PID
  2. 觸發它輸出 FLAG

  工具：
    ps aux                         # 列出所有程序
    ps aux | grep <keyword>        # 搜尋特定程序
    cat /proc/<PID>/cmdline        # 查看程序的完整指令
    kill -USR1 <PID>               # 發送 SIGUSR1 訊號
    strace -p <PID> -e write       # 監聽程序的 write 系統呼叫

  提示：找找有沒有 python 相關的程序...

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
