#!/usr/bin/env python3
"""Room 5: 謎語服務，回答正確才給 FLAG"""
import os, socket, hashlib, threading

seed = os.environ.get("FLAG_SEED", "escape_docker_dev_seed")
flag = "EscapeDocker{" + hashlib.sha256(f"{seed}-room5".encode()).hexdigest()[:16] + "}"
PORT = 7777

RIDDLE = """
==================================
  The Wire Challenge — Port 7777
==================================

謎語：
  我是每個容器的身份識別，
  在 Docker 網路裡，我負責定位，
  不是 IP，但能解析出 IP。
  我是什麼？

請輸入答案（小寫，一個單詞）：
""".encode("utf-8")

ANSWER = b"hostname"

def handle(conn):
    try:
        conn.sendall(RIDDLE)
        data = conn.recv(256).strip().lower()
        if data in (b"hostname", b"hostname\n", b"container name", b"name"):
            conn.sendall(f"\n正確！🎉\nFLAG: {flag}\n".encode())
        else:
            conn.sendall("\n不對，再想想... 連線已關閉。\n".encode("utf-8"))
    except Exception:
        pass
    finally:
        conn.close()

sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
sock.bind(('0.0.0.0', PORT))
sock.listen(5)
print(f"[riddle_server] Listening on :{PORT}", flush=True)
while True:
    conn, addr = sock.accept()
    threading.Thread(target=handle, args=(conn,), daemon=True).start()
