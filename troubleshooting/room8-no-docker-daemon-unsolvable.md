# Room 8（The Fleet）對玩家不可解：無 Docker daemon、challenge 唯讀、walkthrough 與實際檔案不符

> **日期：** 2026-06-13

## 1. 緣由

使用者貼出 `rooms/room8/challenge/docker-compose.yml` 的實際內容（alpine
`database` + python `app`，內嵌 HTTP server 計算 FLAG8），詢問「我看到的
為上面，但是好像和 walkthrough 不同？」。

檢查 `walkthrough.md` 的 Room 8 段落，發現它描述的是**完全不同的一份
postgres 版設定**（`POSTGRES_PASSWORD=secret`、`PORT=8080` 環境變數），
跟實際題目檔案毫無關係——這本身就是一個 walkthrough 過期/誤導的問題。

但繼續往下查發現問題遠不止 walkthrough 過期：room8 在目前的設定下
**對玩家完全不可解**。

## 2. 根因

room8 的核心機制是「玩家修好 `docker-compose.yml` 後執行
`docker compose up`，再用 `curl localhost:8080` 取得 FLAG」，但實際環境
有三個疊加的結構性問題：

### 2.1 `/home/player/challenge` 是 `:ro` 唯讀掛載

根 `docker-compose.yml` 裡：

```yaml
  room8:
    ...
    volumes:
      - ./rooms/room8/challenge:/home/player/challenge:ro
```

玩家用 `vim docker-compose.yml` 編輯後存檔會直接失敗
（`E212: Can't open file for writing`），題目「修正設定」的核心動作做
不到。

### 2.2 room8 完全沒有 Docker daemon 可用

room8 的 `Dockerfile` 只裝了 `docker-compose-v2`（提供 `docker` CLI 與
`docker compose` 子指令），但：

- 根 `docker-compose.yml` 沒有幫 room8 掛載 `/var/run/docker.sock`
- room8 容器內也沒有自己的 dockerd

實測：

```bash
$ docker exec -u player room8 docker version
Client: Version 29.1.3 ...
$ docker exec -u player room8 ls -la /var/run/docker.sock
ls: cannot access '/var/run/docker.sock': No such file or directory
```

任何 `docker compose up` 都會直接報
`Cannot connect to the Docker daemon at unix:///var/run/docker.sock.
Is the docker daemon running?`——題目唯一的「驗證手段」完全無法執行。

`lab/exploits/room8.sh` 與 `lab/scenarios/room8.json` 裡其實已經有
「已知基礎設施缺口，待補上 docker.sock（或容器內 dockerd）」的註記，
證實這是已知但尚未處理的問題。

### 2.3 `entrypoint.sh` 的 `.env` 寫入因 `:ro` 靜默失敗

`entrypoint.sh` 會把 `FLAG_SEED` 寫入
`/home/player/challenge/.env`（給 `docker compose` 做變數替換用），但因
`:ro` 掛載，這個 `echo > .env` 靜默失敗（沒有 `set -e` 也不會報錯），
容器內確認 `.env` 不存在。即使 (1)(2) 都修好，FLAG_SEED 仍傳不進
`app` service。

### 2.4 為什麼不能直接掛 host 的 `/var/run/docker.sock`（像 room6/7/9/final）

room6/7/9/final 都是掛載 **host** 的 `/var/run/docker.sock`
（見 [[docker-sock-gid-mismatch]]）。但若 room8 也這麼做：

- 玩家 `docker compose up` 建立的 `app`/`database` 會是 **host** 上的
  sibling container，`-p 8080:8080` 會綁在 **host** 的網路上
- room8 容器本身的網路命名空間跟 host 不同，room8 內的
  `curl localhost:8080` **連不到** host 上的 8080
- motd 與 `lab/exploits/room8.sh` 都寫的是 `curl localhost:8080`

要讓這條指令照原樣可行，room8 必須有**自己專屬**的 Docker daemon，讓
`-p 8080:8080` 綁在 room8 自己的網路命名空間上。

## 3. 修復

### 3.1 room8 改為 Docker-in-Docker（DinD）

`docker-compose.yml`：room8 加上 `privileged: true`（移除原本的
`:ro` volume 掛載）。

`rooms/room8/Dockerfile`：

```diff
-    docker-compose-v2 python3 \
+    docker.io docker-compose-v2 iptables python3 \
```

並移除 `USER player`（entrypoint 需要 root 權限啟動 dockerd；玩家仍透過
`docker exec -u player room8 bash` 以一般使用者操作）。

`rooms/room8/entrypoint.sh`：以 `dockerd --storage-driver=vfs` 作為
PID 1 在前景執行（維持 container 存活），背景等待
`/var/run/docker.sock` 出現後 `chmod 666`，讓 `player` 不需 sudo 即可
使用 room8 自己的 Docker daemon：

```bash
#!/bin/bash
set -e
export FLAG_SEED="${FLAG_SEED:-escape_docker_dev_seed}"
echo "FLAG_SEED=${FLAG_SEED}" > /home/player/challenge/.env
chown player:player /home/player/challenge/.env

( for i in $(seq 1 60); do
    if [ -S /var/run/docker.sock ]; then
      chmod 666 /var/run/docker.sock
      break
    fi
    sleep 0.5
  done ) &

exec dockerd --storage-driver=vfs
```

選用 `--storage-driver=vfs`：避免在 host 已是 overlay2 的檔案系統上巢狀
overlay2 造成相容性問題（vfs 較慢但相容性最穩，題目所需的
`alpine:3.19` + `python:3.11-slim` image 都很小，影響可忽略）。

`chmod 666 /var/run/docker.sock` 只放寬 **room8 容器內、room8 自己的**
Docker daemon 的 socket 權限——風險侵限在 room8 容器本身，跟
room6/7/9/final 掛載 **host** docker.sock（等同 host root，見
[[docker-sock-gid-mismatch]]）相比，安全影響範圍小很多。

### 3.2 `:ro` 掛載問題：改為由 image 內建 challenge 檔案

移除 bind mount，改成 `rooms/room8/setup.sh`（build time）用 heredoc
把 `docker-compose.yml` 寫入 `/home/player/challenge/`（與 room7 的
`MISSION.txt`/`Dockerfile` 做法一致）。容器重建（`--force-recreate`）
時會自動還原成乾淨初始狀態，原本 `rooms/room8/challenge/` 目錄已刪除
（內容已搬進 `setup.sh`）。

### 3.3 FLAG_SEED 傳遞問題：直接內建在 compose 檔裡

新的 `/home/player/challenge/docker-compose.yml` 在 `app` service 預先
加上：

```yaml
  app:
    image: python:3.11-slim
    environment:
      - FLAG_SEED=${FLAG_SEED}
    # BUG 1: 缺少 depends_on
    # BUG 2: 缺少必要的環境變數 DB_HOST
    command: |
      ...
```

`entrypoint.sh` 寫入 `/home/player/challenge/.env`（現在可寫），
`docker compose` 會自動讀取同目錄的 `.env` 對 `${FLAG_SEED}` 做變數
替換——玩家完全不需要額外處理 FLAG_SEED，跟 motd/hints 原本描述的
「只有 BUG1（depends_on）和 BUG2（DB_HOST）」一致。

## 4. 驗證

```bash
docker compose build room8
docker compose up -d --force-recreate room8

# dockerd 正常啟動
docker logs room8 | tail -3
# API listen on /var/run/docker.sock

# /home/player/challenge 可寫、docker server 可連線
docker exec -u player room8 bash -c \
  "ls -la /var/run/docker.sock && docker version --format '{{.Server.Version}}'"
# srw-rw-rw- 1 root docker 0 ... /var/run/docker.sock
# 29.1.3
```

完整 exploit 腳本（`lab/exploits/room8.sh`，已同步更新移除
`/tmp/challenge` workaround 與過期註記）：

```bash
bash lab/exploits/room8.sh
```

```json
{"type":"result","scenario_id":"room8","status":"success","steps":6,
 "final_privilege":"player (fixed docker-compose.yml, app exposes FLAG via HTTP)",
 "flag_found":"EscapeDocker{e860c9d049fd3fbf}"}
```

與 `_gen("room8")`（`FLAG_SEED=escape_docker_2024_change_me`）算出的
`EscapeDocker{e860c9d049fd3fbf}` 一致。

另外確認 UTF-8 locale（[[rooms-missing-utf8-locale]]）與 `vim` 編輯/存檔
正常：

```bash
docker exec -u player room8 bash -c "echo LANG=\$LANG; cd /home/player/challenge && echo '# test' >> docker-compose.yml && tail -1 docker-compose.yml"
# LANG=C.utf8
# # test
```

## 5. walkthrough.md 同步更新

`walkthrough.md` 的 Room 8 段落原本描述一份不存在的 postgres 版設定，
已重寫為符合實際 `docker-compose.yml`（alpine `database` + python
`app`），並補充「room8 內建獨立 dockerd，`docker compose` 操作的是
room8 自己內部的 Docker，與 host 無關」的說明。

## 6. 修改檔案清單

| 檔案 | 變更 |
|---|---|
| `docker-compose.yml`（根目錄） | room8：加上 `privileged: true`，移除 `volumes: - ./rooms/room8/challenge:/home/player/challenge:ro` |
| `rooms/room8/Dockerfile` | 安裝 `docker.io`、`iptables`（取代僅 `docker-compose-v2`），移除 `USER player` |
| `rooms/room8/entrypoint.sh` | 改為以 `dockerd --storage-driver=vfs` 作為 PID 1 前景執行，背景 `chmod 666 /var/run/docker.sock` |
| `rooms/room8/setup.sh` | 新增 heredoc 把 `docker-compose.yml`（含 `FLAG_SEED=${FLAG_SEED}`）寫入 `/home/player/challenge/` |
| `rooms/room8/challenge/docker-compose.yml` | 已刪除（內容搬進 `setup.sh`），`rooms/room8/challenge/` 目錄一併移除 |
| `walkthrough.md` | 重寫 Room 8 段落，符合實際 alpine+python 設定與 DinD 說明 |
| `lab/exploits/room8.sh` | 移除 `/tmp/challenge` workaround（改直接編輯可寫的 `/home/player/challenge`）、移除過期的「已知基礎設施缺口」註記、`docker compose up` → `up -d`（`database` 是無限迴圈，attach 模式會卡住） |
| `lab/scenarios/room8.json` | 更新 `notes`，移除「需先確認是否有 Docker daemon」的待辦註記 |

## 7. 待手動確認

- 本修復在「Windows + Docker Desktop」環境下驗證（同
  [[docker-sock-gid-mismatch]] 的環境前提）。`privileged: true` +
  `dockerd --storage-driver=vfs` 在原生 Linux host 上應該同樣可行，但
  若未來改用其他容器執行環境（例如不支援 `privileged` 的受限平台），
  需重新評估 DinD 方案。
