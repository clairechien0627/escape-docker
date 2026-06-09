#!/bin/bash
set -e
cat > /etc/motd << 'MOTD'

  ╔═══════════════════════════════════════════════════╗
  ║   👻  SECRET ROOM B: The Ghost                    ║
  ╚═══════════════════════════════════════════════════╝

  Docker image 是由多個 layer 堆疊而成的。
  即使你在 Dockerfile 裡刪除了一個檔案，
  它仍然存在於舊的 layer 裡！

  任務：從 image 的 layer 中找到被刪除的 FLAG。

  步驟：
    1. 看 image 的 build 歷史
       docker history escape-docker-secret-b

    2. 把 image 存成 tar 檔
       docker save escape-docker-secret-b -o /tmp/image.tar

    3. 解壓縮
       mkdir -p /tmp/layers && tar xf /tmp/image.tar -C /tmp/layers

    4. 在所有 layer 裡搜尋
       find /tmp/layers -name "*.tar" -exec tar tf {} \; 2>/dev/null | grep ghost
       # 或
       find /tmp/layers -name "layer.tar" | while read f; do
         tar xf "$f" -C /tmp/extract_$$ 2>/dev/null
       done
       grep -r "EscapeDocker" /tmp/extract_* 2>/dev/null

MOTD

cat >> /home/player/.bashrc << 'BASHRC'
alias mission='cat /etc/motd'
BASHRC
chown -R player:player /home/player
