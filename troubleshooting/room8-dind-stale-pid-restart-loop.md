# Room 8：DinD 容器被 OOM-kill 後以 `docker start` 重啟會卡在重啟迴圈（殘留 docker.pid）

> **日期：** 2026-06-13

## 1. 緣由

在評估「這次 session 改動的房間是否影響 `lab/exploits/*.sh`」時，對全部
15 支 exploit 腳本做了一輪批次回歸測試（在 90 秒 timeout 下依序執行
room0~11、final、secret-a、secret-b）。測完後檢查 `docker ps -a`，發現
`room7`、`room8`、`secret-b` 都已 `Exited (137)`（SIGKILL / OOM-kill），
`room11` 也處於 exited 狀態（更早之前就已停止，與本次無關）。

對 `room7`、`secret-b`、`room11` 直接 `docker compose up -d` 即可正常重啟。
但 `room8` 重啟後狀態變成 `restarting (1)`，陷入重啟迴圈，`docker logs
room8` 顯示：

```
INFO ... API listen on /var/run/docker.sock
INFO ... Starting up
failed to start daemon, ensure docker is not running or delete /var/run/docker.pid: process with PID 1 is still running
INFO ... Starting up
failed to start daemon, ensure docker is not running or delete /var/run/docker.pid: process with PID 1 is still running
... (重複)
```

## 2. 根因

`rooms/room8/entrypoint.sh`（修復前）以
`exec dockerd --storage-driver=vfs` 收尾，讓 dockerd 成為 container 的
PID 1。

正常關閉時 dockerd 會自行清除 `/var/run/docker.pid`。但被 **SIGKILL
（OOM-kill，exit 137）** 終止時，dockerd 沒有機會清理，`docker.pid`
（內容是上一個 dockerd 行程的 PID，也就是「1」）被留在 container 的
可寫層裡。

`docker compose up -d`（沒有 `--force-recreate`）對一個 `Exited`
container 等同於 `docker start`——**沿用同一個 container 與其可寫層**，
檔案系統狀態不會重置。因此：

1. 新的 dockerd 行程啟動，同樣以 PID 1 執行
2. dockerd 啟動時檢查 `/var/run/docker.pid`，發現裡面寫著 `1`
3. dockerd 檢查「PID 1 是否還活著」——而現在 PID 1 正是**它自己**，檢查
   結果永遠是「活著」
4. dockerd 因而判定「已有 dockerd 在跑」，啟動失敗並退出
5. container 的 restart policy 讓它不斷重試，永遠卡在同一個迴圈

換句話說：**任何造成 room8 非正常終止（OOM-kill、host 重啟、手動
`docker kill` 等）後若用 `docker start`／`docker compose up -d`（而非
`--force-recreate`）重啟，都會觸發這個迴圈**，唯一的恢復方式是
`--force-recreate`（丟棄舊的可寫層，但連帶也會重置房間內的所有玩家進度與
challenge 狀態）。對於 demo 穩定性與「房間意外重啟後自動恢復」的需求而言，
這是一個會讓 room8 整關卡死、且修復成本（重新通關）很高的潛在問題。

## 3. 修復

`rooms/room8/entrypoint.sh` 在 `exec dockerd` 前加一行，清掉殘留的
`docker.pid`：

```bash
# 清除上次非正常關閉（如 OOM-kill）殘留的 pid 檔。
# 若不清，container 用 `docker start`（非 recreate）重啟時，舊的
# /var/run/docker.pid 仍存在於可寫層；新 dockerd 同樣是 PID 1，
# 自我檢查會誤判「PID 1 還在跑」而拒絕啟動，陷入重啟迴圈。
rm -f /var/run/docker.pid

exec dockerd --storage-driver=vfs
```

`entrypoint.sh` 是 build time `COPY` 進 image 的，需要
`docker compose build room8` 才會套用，再 `--force-recreate` 一次套用
新 image（之後的非正常重啟就不再需要 `--force-recreate` 了）。

## 4. 驗證

```bash
docker compose build room8
docker compose up -d --force-recreate room8

# 模擬 OOM-kill：SIGKILL 後用 docker start（非 recreate）重啟
docker kill room8
docker start room8
docker ps --format "{{.Names}}\t{{.State}}\t{{.Status}}" | grep room8
# room8  running  Up 2 seconds

docker logs room8 --tail 3
# ... Daemon has completed initialization
# ... API listen on /var/run/docker.sock
```

dockerd 正常啟動，未再出現「process with PID 1 is still running」。

進一步以 `lab/exploits/room8.sh` 完整跑一次（含修 challenge 的
`docker-compose.yml`、`docker compose up -d`、`curl localhost:8080`），
確認整個攻擊流程在「`docker kill` + `docker start`」之後仍可正常走完：

```json
{"type":"step","index":6,"name":"result: curl localhost:8080","exit_code":0,
 "output":"Connected to DB: database\nFLAG: EscapeDocker{e860c9d049fd3fbf}"}
{"type":"result","scenario_id":"room8","status":"success","steps":6,
 "flag_found":"EscapeDocker{e860c9d049fd3fbf}"}
```

## 5. 修改檔案清單

| 檔案 | 變更 |
|---|---|
| `rooms/room8/entrypoint.sh` | 在 `exec dockerd --storage-driver=vfs` 前新增 `rm -f /var/run/docker.pid`，避免非正常關閉後重啟卡在迴圈 |

## 6. 相關問題

- 與 [[room8-no-docker-daemon-unsolvable]] 是 room8 DinD 化過程中先後
  發現的兩個獨立問題：前者是「room8 原本沒有 Docker daemon、無法照
  walkthrough 操作」，這篇是「DinD 化之後，daemon 在非正常重啟時的
  健康度」問題。
- 觸發本次發現的根本原因是**批次回歸測試對 Docker Desktop 造成記憶體壓力**
  （同時/連續跑 room8 的 DinD 與 secret-b 的 700MB `docker save`）。若之後
  要把這 15 支 exploit 腳本排入自動化測試（例如配合
  `room-manager`／`lab-api`），建議避免在短時間內密集啟動多個重型房間
  （room8、room6/7/9/final 等掛載 docker.sock 的房間），或提高 Docker
  Desktop 的記憶體配額。
