#!/bin/bash
set -e
ssh-keygen -A
cat > /home/player/README.txt << 'TXT'
你成功登入了 locked-server！

FLAG 藏在本機的 port 9090，但只能從 localhost 存取。
你需要在連線建立時設定 SSH tunnel。

試試：從 room4 執行：
  ssh -L 8888:localhost:9090 locked-server -N &
  curl http://localhost:8888/flag

或是：
  ssh -L 8888:localhost:9090 locked-server "curl http://localhost:9090/flag"
TXT
chown player:player /home/player/README.txt
