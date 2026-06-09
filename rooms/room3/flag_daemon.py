#!/usr/bin/env python3
"""
Room 3 背景 daemon：
- 接收 SIGUSR1 訊號時印出 FLAG
- 平時每 30 秒印一次加密版本（干擾用）
"""
import os, signal, sys, time, hashlib

seed = os.environ.get("FLAG_SEED", "escape_docker_dev_seed")
flag = "EscapeDocker{" + hashlib.sha256(f"{seed}-room3".encode()).hexdigest()[:16] + "}"

def on_usr1(sig, frame):
    print(f"\n[flag_daemon] SIGUSR1 received! FLAG: {flag}", flush=True)

signal.signal(signal.SIGUSR1, on_usr1)

# 每 30 秒輸出假訊息
counter = 0
while True:
    counter += 1
    xor_val = "".join(chr(ord(c) ^ 0x0A) for c in flag)
    if counter % 3 == 0:
        print(f"[flag_daemon] Status OK (pid={os.getpid()})", flush=True)
    time.sleep(10)
