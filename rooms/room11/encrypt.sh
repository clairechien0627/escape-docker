#!/bin/bash
# Room 11 — cron 每分鐘執行此腳本
# 邏輯：讀 /tmp/key，XOR 加密 /secret/data，輸出到 /tmp/result

KEY_FILE="/tmp/key"
DATA_FILE="/secret/data"
OUTPUT="/tmp/result"

if [ ! -f "$KEY_FILE" ]; then
    echo "[encrypt] Key file not found at $KEY_FILE" >> /var/log/encrypt.log
    exit 0
fi

KEY=$(cat "$KEY_FILE" | tr -d '\n')
DATA=$(cat "$DATA_FILE" 2>/dev/null)

if [ -z "$DATA" ]; then
    echo "[encrypt] Data file not found" >> /var/log/encrypt.log
    exit 0
fi

# 簡單的 XOR：如果 key = "unlock"，直接輸出解密結果
if [ "$KEY" = "unlock" ]; then
    echo "$DATA" > "$OUTPUT"
    chmod 644 "$OUTPUT"
    echo "[encrypt] Decrypted! Result written to $OUTPUT" >> /var/log/encrypt.log
else
    echo "[encrypt] Wrong key '$KEY'" >> /var/log/encrypt.log
fi
