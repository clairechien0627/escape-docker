#!/usr/bin/env python3
"""生成三個相互關聯的 log 檔案"""
import os, random, hashlib

seed = os.environ.get("FLAG_SEED", "escape_docker_dev_seed")
flag = "EscapeDocker{" + hashlib.sha256(f"{seed}-room10".encode()).hexdigest()[:16] + "}"

# 攻擊者 IP（玩家要找到這個）
ATTACKER_IP = "192.168.1.100"
NORMAL_IPS = ["10.0.0.5", "10.0.0.8", "172.16.0.200", "172.16.0.201"]

# 1. auth.log：SSH 登入記錄
auth_lines = []
dates = ["Jun  9", "Jun  9", "Jun  9", "Jun  9", "Jun  9", "Jun  9"]
times = ["10:00:01", "10:00:02", "10:00:05", "10:00:10", "10:00:15", "10:00:20",
         "10:00:25", "10:00:30", "10:00:35", "10:01:00", "10:01:05", "10:01:10"]

# 大量失敗登入（攻擊者）
for i, t in enumerate(times[:8]):
    auth_lines.append(f"Jun  9 {t} server sshd[1234]: Failed password for root from {ATTACKER_IP} port {54000+i} ssh2")
# 一些正常失敗
auth_lines.append(f"Jun  9 10:01:15 server sshd[1234]: Failed password for admin from {NORMAL_IPS[0]} port 12345 ssh2")
auth_lines.append(f"Jun  9 10:01:20 server sshd[1234]: Failed password for ubuntu from {NORMAL_IPS[1]} port 23456 ssh2")
# 攻擊者成功登入
auth_lines.append(f"Jun  9 10:02:00 server sshd[1234]: Accepted password for www-data from {ATTACKER_IP} port 54321 ssh2")
auth_lines.append(f"Jun  9 10:02:01 server sshd[1234]: pam_unix(sshd:session): session opened for user www-data by (uid=0)")

# 2. nginx.log：Web 存取記錄（攻擊者登入後的操作）
SECRET_PATH = "/api/v1/users/export"
nginx_lines = []
for ip in NORMAL_IPS:
    nginx_lines.append(f'{ip} - - [09/Jun/2024:10:00:00 +0000] "GET /index.html HTTP/1.1" 200 1234')
    nginx_lines.append(f'{ip} - - [09/Jun/2024:10:00:30 +0000] "GET /about HTTP/1.1" 200 567')
# 攻擊者存取敏感路徑
nginx_lines.append(f'{ATTACKER_IP} - - [09/Jun/2024:10:02:10 +0000] "GET /login HTTP/1.1" 200 890')
nginx_lines.append(f'{ATTACKER_IP} - - [09/Jun/2024:10:02:15 +0000] "POST /login HTTP/1.1" 302 0')
nginx_lines.append(f'{ATTACKER_IP} - - [09/Jun/2024:10:02:20 +0000] "GET {SECRET_PATH} HTTP/1.1" 200 9999')
nginx_lines.append(f'{ATTACKER_IP} - - [09/Jun/2024:10:02:25 +0000] "GET /admin/config HTTP/1.1" 403 123')

# 3. app.log：應用程式日誌（包含 FLAG session token）
app_lines = []
for ip in NORMAL_IPS:
    app_lines.append(f"[2024-06-09 10:00:00] INFO  Request from {ip}: GET /index.html → 200")
# 攻擊者的 session token = FLAG 的一部分
session_token = flag
app_lines.append(f"[2024-06-09 10:02:20] INFO  User export requested from {ATTACKER_IP}")
app_lines.append(f"[2024-06-09 10:02:20] INFO  Session token: {session_token}")
app_lines.append(f"[2024-06-09 10:02:20] WARN  Sensitive data exported: 1247 user records")

# Shuffle 讓順序不那麼明顯
random.shuffle(auth_lines[:-4])
auth_content = "\n".join(sorted(auth_lines[:8]) + auth_lines[8:]) + "\n"
nginx_content = "\n".join(nginx_lines) + "\n"
app_content = "\n".join(app_lines) + "\n"

os.makedirs("/var/log", exist_ok=True)
with open("/var/log/auth.log", "w") as f:
    f.write(auth_content)
with open("/var/log/nginx.log", "w") as f:
    f.write(nginx_content)
with open("/var/log/app.log", "w") as f:
    f.write(app_content)

print(f"[generate_logs] Logs generated. Attacker IP: {ATTACKER_IP}")
