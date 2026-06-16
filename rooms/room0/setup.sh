#!/bin/bash
set -e

# ── Welcome message (motd) ──
cat > /etc/motd << 'MOTD'

  ╔═══════════════════════════════════════════════════╗
  ║      🐳  ESCAPE DOCKER  —  Room 0: Tutorial       ║
  ╚═══════════════════════════════════════════════════╝

  你是一名系統管理員，剛進入了一個陌生的容器。
  凌晨三點，你收到了一封匿名訊息：

  「我把所有機密分散藏在 12 個容器裡。
   找到它們，才能解開最終密碼。」

  這是第一關，先熟悉環境。

  任務：找到這個容器裡藏著的 FLAG。

  提示：
    cat /home/player/welcome.txt    # 讀歡迎訊息
    man ls                          # 查指令說明
    ls, cd, cat, pwd                # 基本指令

MOTD

# ── Welcome file ──
cat > /home/player/welcome.txt << 'TXT'
歡迎來到 Escape Docker！

這是 Room 0：Tutorial（教學關）

=== 基本指令快速複習 ===

  pwd               → 顯示目前所在目錄
  ls                → 列出檔案
  ls -la            → 詳細列出（包含隱藏檔案）
  cd <dir>          → 切換目錄
  cat <file>        → 讀取檔案內容
  man <command>     → 查看指令說明書

=== 你的任務 ===

FLAG 就藏在這個系統裡。

提示：試試看 cat /etc/motd
      還有... 系統說明通常放在 /etc/

找到 FLAG 後，請到 http://localhost 提交！

TXT

# ── Hidden hint ──
mkdir -p /etc/escape-docker
echo "很好，你找到了進階提示！FLAG 就藏在 /etc/motd 裡面，仔細找找。" > /etc/escape-docker/hint.txt

# ── .bashrc 加入提示和工具函數 ──
cat >> /home/player/.bashrc << 'BASHRC'

# Escape Docker helper
alias hint='cat /etc/escape-docker/hint.txt 2>/dev/null || echo "沒有更多提示了"'
alias mission='cat /etc/motd'

submit_flag() {
    local FLAG="$1"
    if [ -z "$FLAG" ]; then echo "用法：submit_flag \"EscapeDocker{...}\""; return 1; fi
    echo ""
    echo "提交 FLAG 請到瀏覽器：http://localhost"
    echo "或使用 curl："
    echo "  curl -s -X POST http://scoreboard-api:8000/submit \\"
    echo "    -H 'Content-Type: application/json' \\"
    echo "    -d '{\"player_name\": \"你的名字\", \"flag\": \"$FLAG\"}'"
    echo ""
}

echo ""
echo "  輸入 'mission' 查看任務說明"
echo "  輸入 'hint' 查看進階提示"
echo ""
BASHRC

# ── 修正無換行指令後 prompt 黏行 ──
cat > /etc/profile.d/prompt-newline.sh << 'EOF'
PROMPT_COMMAND='printf "%${COLUMNS:-80}s\r\033[K" ""'
EOF

chown -R player:player /home/player
