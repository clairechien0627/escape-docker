# docker.sock gid 不匹配導致 room6/room7/room9/final 對 player 無法使用問題排查報告

> **日期：** 2026-06-13

> 在撰寫 `lab/exploits/{room6,room7,room9,final}.sh` 時發現並修復。

## 1. 緣由

room6 / room7 / room9 / final 這四關的核心解法都依賴 `docker-compose.yml`
替它們掛載的 `/var/run/docker.sock`，讓 `player`（已透過
`usermod -aG docker player` 加入 `docker` group）可以直接用 `docker` CLI
或 `curl --unix-socket /var/run/docker.sock` 操作 host 的 Docker daemon：

- room6：`docker ps -a` / `docker logs` / `docker start` / `docker exec`
  讀取 `ghost-alpha/beta/gamma` 裡的提示碎片
- room7：`docker build` / `docker run` / `docker history`
- room9：`docker network connect` 跨網路存取 `secret-server`
- final：透過 Docker Engine API 在 `vault` 容器內 `exec cat /final_flag.txt`

撰寫對應 exploit 腳本時，以 `docker exec -u player <room> docker ps` 等指令
實測，四關全部回報：

```
permission denied while trying to connect to the docker API at
unix:///var/run/docker.sock: Get "http://%2Fvar%2Frun%2Fdocker.sock/...":
dial unix /var/run/docker.sock: connect: permission denied
```

## 2. 根因

```
$ docker exec -u player room9 ls -la /var/run/docker.sock
srw-rw---- 1 root root 0 ... /var/run/docker.sock

$ docker exec -u player room9 id
uid=1000(player) gid=1000(player) groups=1000(player),103(docker)
```

- host（本機 Windows 上的 Docker Desktop VM）的 `/var/run/docker.sock`
  擁有者是 `root:root`，權限 `srw-rw----`（mode 660）——只有 **gid 0**
  的成員才能透過 group 權限讀寫這個 socket。
- 但 room6/7/9/final 的 `Dockerfile` 都是用
  `apt-get install docker.io` 後 `usermod -aG docker player` 把 player
  加入容器內的 `docker` group，而這個 `docker` group 的 gid 是
  **103**（由 `docker.io` 套件的 postinst script 在 build time 建立），
  與 host socket 的 gid（0）完全對不上。

`player` 的有效群組是 `(1000, 103)`，不含 `0`，所以對一個
`root:root mode 660` 的檔案完全沒有 group 權限 → `connect()` 回
`permission denied`。

用 `-u root` 重新跑同樣的指令完全正常（root 永遠有權限），可確認
**四個關卡的 exploit 腳本邏輯本身都正確**，純粹是權限對應問題：

- room7：`EscapeDocker{c2ef3dffa8810934}`
- room9：`EscapeDocker{4273470c1898a7be}`
- final：`EscapeDocker{e78307053fd95ca8}`

## 3. 修復

在 room6 / room7 / room9 / final 的 `Dockerfile` 裡，建立 `player` 的那一
行 `RUN` 多加一個 `usermod -aG root player`，讓 `player` 額外加入
**gid 0（`root` 群組）**：

```diff
 RUN useradd -m -s /bin/bash -u 1000 player && \
-    usermod -aG docker player
+    usermod -aG docker player && \
+    usermod -aG root player
```

`root` 是 Ubuntu 上 gid 0 對應的群組名稱；把 `player` 加入這個群組，
就能透過檔案的 group 權限位（`rw-` for group）存取
`root:root mode 660` 的 `/var/run/docker.sock`，不需要、也不會給予
`player` 任何 sudo/root 權限——這正是這四關「可寫 docker.sock = 等同
host root」的題目設計本身想呈現的風險，並沒有額外放大。

重建並重啟：

```bash
docker compose up -d --build room6 room7 room9 final
```

驗證：

```bash
$ docker exec -u player room9 id
uid=1000(player) gid=1000(player) groups=1000(player),0(root),103(docker)
```

## 4. 最終結果

重建後重跑全部四個 exploit 腳本，皆回報 `status: "success"`：

| 房間 | flag |
|---|---|
| room6 | （三段提示碎片，非標準 flag 格式） |
| room7 | `EscapeDocker{c2ef3dffa8810934}` |
| room9 | `EscapeDocker{4273470c1898a7be}` |
| final | `EscapeDocker{e78307053fd95ca8}` |

## 5. 修改檔案清單

| 檔案 | 變更 |
|---|---|
| `rooms/room6/Dockerfile` | `useradd` 後加一行 `usermod -aG root player` |
| `rooms/room7/Dockerfile` | 同上 |
| `rooms/room9/Dockerfile` | 同上 |
| `rooms/final/Dockerfile` | 同上 |

## 6. 跨平台注意事項

此修復是針對「host `/var/run/docker.sock` 為 `root:root`（gid 0）」這個
情境（目前的 Windows + Docker Desktop 開發/評分環境正是如此）。若未來
部署到原生 Linux host，且該 host 的 `/var/run/docker.sock` 群組是某個
非 0 的 `docker` group gid：

- 若該 gid 恰好與容器內 `docker` group 的 gid（103）一致，原本的
  `usermod -aG docker player` 就已經足夠，本次新增的 `usermod -aG root
  player` 不影響（多一個無關群組，無副作用）。
- 若兩者 gid 都不一致，仍會出現同樣的 permission denied，需要改用
  更通用的做法（例如在 entrypoint 啟動時用
  `stat -c %g /var/run/docker.sock` 動態偵測並把 `player` 加入對應 gid
  的群組）。目前因為實際評分環境是 Windows Docker Desktop（gid 0），
  故先採用本文件的簡單修復；若改部署環境，請重新檢查本問題。
