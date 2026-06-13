# Secret Room B（The Ghost）對玩家不可解：image 內藏的 FLAG 與 scoreboard 不一致 + walkthrough 沒說在哪台執行

> **日期：** 2026-06-13

## 1. 緣由

使用者在 `secret-b` 容器的終端機裡，照 `walkthrough.md` Secret Room B
的步驟執行：

```bash
player@secret-b:~$ docker history escape-docker-secret-b
failed to connect to the docker API at unix:///var/run/docker.sock; check if the path is correct and if the daemon is running: dial unix /var/run/docker.sock: connect: no such file or directory
player@secret-b:~$ docker save escape-docker-secret-b > /tmp/secret-b.tar
failed to connect to the docker API at unix:///var/run/docker.sock; check if the path is correct and if the daemon is running: dial unix /var/run/docker.sock: connect: no such file or directory
```

`secret-b` 容器完全沒有 Docker，所有 `docker` 指令都失敗。

進一步檢查發現：**即使換到有 Docker 的容器執行，正確抽出來的 FLAG
仍然是錯的**，因為 image 裡藏的 FLAG 字串本身就跟 scoreboard 預期的
不一致——這是比「在哪裡執行」更嚴重的根本問題。

## 2. 根因

### 2.1 walkthrough 沒說明要在哪個容器執行

`docker-compose.yml` 中只有 **room6 / room7 / room9 / final** 掛載了
`/var/run/docker.sock`（參考 [[docker-sock-gid-mismatch]]）。`secret-b`
（解鎖條件：完成 Room 7）本身**沒有**掛載 docker.sock，是設計上純粹
的「image 考古」題目，不該也不會有 Docker 存取權。

`walkthrough.md` 的「解題步驟」直接列出 `docker history` /
`docker save` 指令，沒有指明這些指令要在 **Room 7 的終端機**（它有
docker.sock，且完成 Room 7 後 `escape-docker-secret-b` image 已經
build 好，`docker images` 可見）執行，導致玩家在 `secret-b` 自己的
終端機嘗試而全部失敗。

### 2.2 image 裡藏的 FLAG 與 scoreboard 預期值不一致（核心 bug）

`rooms/secret-b/Dockerfile`：

```dockerfile
ARG FLAG_SEED=escape_docker_dev_seed
RUN SECRET=$(echo "${FLAG_SEED}-secret-b" | sha256sum | cut -c1-16) && \
    mkdir -p /tmp/ghost_layer && \
    echo "EscapeDocker{${SECRET}}" > /tmp/ghost_layer/deleted_secret.txt
RUN rm -rf /tmp/ghost_layer
```

這個 FLAG 是在 **image build 時**算好寫進一個之後會被 `rm -rf` 的
layer（題目的核心機制：layer 仍保留在 image 歷史裡）。但這裡有
**兩個獨立的 bug**，疊加造成 FLAG 完全不對：

**(a) `FLAG_SEED` 這個 ARG 從未從 `.env` 傳入**

`docker-compose.yml` 原本 `secret-b` 的 `build:` 只有：

```yaml
secret-b:
  build: ./rooms/secret-b
```

沒有 `args:`，所以 Dockerfile 裡 `ARG FLAG_SEED=escape_docker_dev_seed`
永遠用它自己的預設值 `escape_docker_dev_seed`，跟 `.env` 實際設定的
`FLAG_SEED=escape_docker_2024_change_me` 完全無關。其他所有房間的
FLAG 都是在 **container 啟動時**由 `entrypoint.sh` 讀取執行期的
`FLAG_SEED` 環境變數動態生成，只有 `secret-b` 是在 **build 時**
寫死，因此是唯一中這個 bug 的房間（`grep -rl "ARG FLAG_SEED"
rooms/*/Dockerfile` 只有 `secret-b`）。

**(b) `echo` 少了 `-n`**（與 [[walkthrough-echo-missing-n-flag-mismatch]] 同一類 bug）

`echo "${FLAG_SEED}-secret-b" | sha256sum` 會對字串結尾多出來的 `\n`
一起算 hash，跟後端 `_gen()` 的 `hashlib.sha256(f'{seed}-{suffix}'.encode())`
（無換行）不一致。

**兩個 bug 疊加的結果**：

```bash
# image 裡實際寫入 deleted_secret.txt 的內容（修復前）：
$ echo "escape_docker_dev_seed-secret-b" | sha256sum | cut -c1-16
8bf3c3ad1715fb08
→ EscapeDocker{8bf3c3ad1715fb08}

# scoreboard-api 用 .env 的 FLAG_SEED（escape_docker_2024_change_me）、
# 無換行算出來的 _gen("secret-b")：
$ echo -n "escape_docker_2024_change_me-secret-b" | sha256sum | cut -c1-16
a7e9cf69eb013b93
→ EscapeDocker{a7e9cf69eb013b93}
```

兩者完全不同。**就算玩家完全照題目設計把 `deleted_secret.txt` 從
image 的歷史 layer 挖出來，拿到的 `EscapeDocker{8bf3c3ad1715fb08}`
送到 scoreboard 也一定會被判定為錯誤**——Secret Room B 在修復前對
任何玩家都是不可解的。

## 3. 修復

### 3.1 `docker-compose.yml`：build 時把 `.env` 的 `FLAG_SEED` 傳入

```yaml
secret-b:
  build:
    context: ./rooms/secret-b
    args:
      - FLAG_SEED=${FLAG_SEED:-escape_docker_dev_seed}
  container_name: secret-b
  ...
```

### 3.2 `rooms/secret-b/Dockerfile`：`echo` 改 `echo -n`

```dockerfile
ARG FLAG_SEED=escape_docker_dev_seed
RUN SECRET=$(echo -n "${FLAG_SEED}-secret-b" | sha256sum | cut -c1-16) && \
    mkdir -p /tmp/ghost_layer && \
    echo "EscapeDocker{${SECRET}}" > /tmp/ghost_layer/deleted_secret.txt
RUN rm -rf /tmp/ghost_layer
```

（`echo "EscapeDocker{${SECRET}}" > ...` 這個 `echo` 寫進檔案的是
**輸出檔案內容**，多一個結尾換行字元無妨，不用改；只有「拿字串去算
hash」的那個 `echo` 需要 `-n`。）

### 3.3 `walkthrough.md`：補上「要在 Room 7 終端機執行」的說明

在 Secret Room B 的「解鎖線索」之後加上提示，並在「解題步驟」開頭
註明這些指令是在 Room 7 的終端機執行（Room 7 掛載了
`/var/run/docker.sock`，且 build 完後 `docker images` 能看到
`escape-docker-secret-b`）。

### 3.3b `rooms/secret-b/setup.sh`：`/etc/motd` 同步補上提示

`secret-b` 自己的 `/etc/motd` 原本也直接列出
`docker history` / `docker save` 等指令，沒說明這個容器本身沒有
Docker。在「任務」與「步驟」之間加入：

```
注意：這個容器本身沒有 Docker！
請回到 Room 7 的終端機（它掛載了 docker.sock，
且 escape-docker-secret-b 這個 image 已經 build 好），
在那裡執行以下步驟：
```

維持 docker.sock 只給 room6/room7/room9/final 的最小權限原則，不額外
給 `secret-b` 掛載 docker.sock。

### 3.4 重建並重新建立 `secret-b`

```bash
docker compose build secret-b
docker compose up -d --force-recreate secret-b
```

## 4. 驗證

從 Room 7（有 docker.sock）抽出修復後 image 裡 `deleted_secret.txt`
的內容：

```bash
$ docker save escape-docker-secret-b -o /tmp/sbtest2/secret-b.tar
$ tar xf secret-b.tar -C /tmp/sbtest2
$ # 在 blobs/sha256/ 裡找到含 ghost_layer 的 blob 並解開
EscapeDocker{a7e9cf69eb013b93}
```

對照 `scoreboard-api` 容器內以實際執行期 `FLAG_SEED`
（`escape_docker_2024_change_me`）跑 `_gen("secret-b")`：

```bash
$ docker exec scoreboard-api python3 -c "
import os, hashlib
seed = os.environ['FLAG_SEED']
print('EscapeDocker{' + hashlib.sha256(f'{seed}-secret-b'.encode()).hexdigest()[:16] + '}')
"
EscapeDocker{a7e9cf69eb013b93}
```

兩者一致，修復後 Secret Room B 可解。

## 5. 修改檔案清單

| 檔案 | 變更 |
|---|---|
| `docker-compose.yml` | `secret-b` 的 `build:` 改為帶 `args: - FLAG_SEED=${FLAG_SEED:-escape_docker_dev_seed}`，讓 build 時的 `ARG FLAG_SEED` 跟 `.env` 一致 |
| `rooms/secret-b/Dockerfile` | `echo "${FLAG_SEED}-secret-b"` 改為 `echo -n "${FLAG_SEED}-secret-b"` |
| `walkthrough.md` | Secret Room B 段落加註：相關指令要在 Room 7 的終端機執行（`secret-b` 自己沒有 docker.sock） |
| `rooms/secret-b/setup.sh` | `/etc/motd` 加入「這個容器本身沒有 Docker，請到 Room 7 終端機操作」的提示 |

## 6. 相關問題

- 與 [[walkthrough-echo-missing-n-flag-mismatch]] 同一類「`echo` 少
  `-n`」bug，但那篇是玩家**手動算 FLAG**的 walkthrough 範例，這篇是
  **image build 時就寫死了錯誤 FLAG**，影響範圍更嚴重（整個房間
  不可解，不是玩家算錯）。
- 與 [[room4-walkthrough-tunnel-host-confusion]] 同樣是「walkthrough
  沒說明指令要在哪台機器/容器執行」的文件缺漏模式。
