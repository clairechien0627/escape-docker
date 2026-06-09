#!/bin/bash
set -e

# ── 生成大量假檔案（干擾用）──
generate_fake_files() {
    local BASE=$1
    mkdir -p "$BASE"
    for i in $(seq 1 80); do
        local DIR="$BASE/dir_$(printf '%03d' $i)"
        mkdir -p "$DIR"
        echo "This is file $i - nothing here" > "$DIR/data.txt"
        echo "Log entry $i: $(date -d "@$((RANDOM * 100))" 2>/dev/null || date)" > "$DIR/log_$(printf '%03d' $i).log"
    done
}

mkdir -p /home/player/archive
generate_fake_files /home/player/archive

# ── 把真正的 FLAG（base64 編碼）藏在一個 .encoded 檔案裡 ──
# 藏在比較深的路徑
HIDE_DIR="/home/player/archive/dir_037/backups/2023"
mkdir -p "$HIDE_DIR"
# FLAG 由 entrypoint.sh 在 runtime 動態寫入

# ── 在一個二進位檔裡用 strings 可以找到提示 ──
python3 -c "
import struct, os
data = b'\\x7fELF' + b'\\x00' * 60
hint = b'HINT: find encoded files in /home/player/archive - use find and base64'
data += hint + b'\\x00' * 20
with open('/home/player/binary_clue', 'wb') as f:
    f.write(data)
"

# ── 任務說明 ──
cat > /etc/motd << 'MOTD'

  ╔═══════════════════════════════════════════════════╗
  ║    📁  ESCAPE DOCKER  —  Room 1: The Archive      ║
  ╚═══════════════════════════════════════════════════╝

  有人把 FLAG 藏在成百上千個檔案中，並用 base64 加密。

  任務：找到那個被 base64 編碼的 FLAG 並解碼。

  工具提示：
    find <path> -name "*.encoded"      # 搜尋特定副檔名的檔案
    find <path> -type f | head -20     # 列出前 20 個檔案
    base64 -d <file>                   # 解碼 base64
    strings <binary_file>              # 從二進位檔取出字串
    file <filename>                    # 檢查檔案類型

  進階提示（試試看）：
    strings /home/player/binary_clue   # 這個二進位檔藏著提示

MOTD

# ── 假 flag（干擾） ──
echo "EscapeDocker{this_is_not_the_flag_keep_looking}" | base64 > /home/player/archive/dir_012/readme.encoded.fake
echo "NOT A FLAG" > /home/player/archive/dir_055/flag.txt

# ── .bashrc ──
cat >> /home/player/.bashrc << 'BASHRC'
alias mission='cat /etc/motd'
echo "  輸入 'mission' 查看任務說明"
BASHRC

chown -R player:player /home/player
