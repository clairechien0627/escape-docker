# Room 8：`docker compose up -d` 後立即 `curl localhost:8080` 出現競態，app 尚未就緒就被判定為 failed

> **日期：** 2026-06-14

## 1. 緣由

完成 Phase A/B 後，使用者要求清除 `data/runs.json` 的歷史紀錄並依序重跑全部
15 個場景，產生一份「乾淨」的 detection-matrix 資料（不含 Phase A 修復前的
舊資料）。15 個場景依序執行完畢後，14 個 `status=success`，唯獨
`room8-1781432543428` 回報 `status=failed`、`flag_found` 為空，耗時
97.3 秒（其餘場景多在數秒到數十秒之間）。

檢視該次 run 的 step 紀錄：

```
step 5: docker compose down; docker compose up -d（修正後的 docker-compose.yml）
  ... Container challenge-app-1  Started
step 6: curl -s http://localhost:8080
  output: ""   exit_code: 56
```

`curl` exit code 56 = `CURLE_RECV_ERROR`（接收資料失敗，連線被對方重置）。
`run.alerts` 中也確實有 `Docker Compose Executed In Container` 規則命中
（`rule_coverage` 不受影響），代表 `docker compose up -d` 本身成功執行，
問題只發生在「`up -d` 回傳後立刻 `curl`」這一步。

## 2. 根因

`lab/exploits/room8.sh`（修復前）：

```bash
step "exploit: docker compose up -d (修正後)" room_exec "$CONTAINER" bash -c \
  "cd /home/player/challenge && docker compose down 2>&1 | tail -3; docker compose up -d"
step "result: curl localhost:8080" room_exec "$CONTAINER" curl -s http://localhost:8080
```

`docker compose up -d` 在 compose 事件流印出 `Container challenge-app-1
Started` 時就回傳——這只代表 **container 行程已被建立並啟動**，不代表
`app` service 裡的 `python3 -c "..."`（解析一段含 `import` 與
`http.server` 的多行內聯程式碼）已經執行到
`HTTPServer(...).serve_forever()` 並完成對 `0.0.0.0:8080` 的 bind/listen。

在這兩個事件之間有一段「視窗期」：

- Docker 的 port-mapping（`docker-proxy` 或 iptables DNAT）在 container
  網路 namespace 建好時就已經生效，host/container 對 `:8080` 的連線會被
  接受並轉發進 container
- 但 container 內尚未有任何行程 `listen()` 在 8080，連線進來後立即被
  TCP RST，呈現為 curl 的 `ECONNRESET`（exit 56）

平常（單獨重跑 room8、Docker Desktop 較空閒）這段視窗期短到 `room_exec`
本身的行程啟動延遲就足以蓋過去，所以幾乎不會踩到。但本次是**緊接著
room0~room7 依序跑完之後**才執行 room8，此時：

- room8 是 DinD（`storage-driver=vfs`），每個 container 都要把整份 image
  layer 複製一份到可寫層，加上同時段 Docker Desktop 因前面 7 個場景的
  container 還在收尾而處於較高負載
- `python3 -c "<多行內聯腳本>"` 的 parse + import + bind 時間被放大到
  超過 `room_exec` 的啟動延遲

於是 `curl` 比 app 的 `listen()` 早執行，得到 `ECONNRESET`、空輸出，
腳本判定 `flag` 為空字串 → `report_finish "failed" "player" ""`。

這與 [[room8-dind-stale-pid-restart-loop]] 是同一個 `room8` DinD
（`storage-driver=vfs` 速度慢、易受 host 負載影響）衍生出的**另一個**
獨立問題：前者是「容器層級」的重啟迴圈，這篇是「應用層級」的啟動競態。

## 3. 修復

`lab/exploits/room8.sh` 把最後一步的單次 `curl` 改成最多重試 15 秒的
輪詢（沿用 `room11.sh` 的 `wait_for_result` 重試迴圈寫法）：

```bash
# docker compose up -d 回傳時容器雖已 Started，但 app 容器內的
# python3 -c "..." 仍需時間完成解析/啟動才會 bind port 8080；
# 在 Docker daemon 負載較高（例如連續跑多個場景）時，立即 curl
# 會得到 ECONNRESET（curl exit 56），導致誤判為 failed。
# 改為重試最多 15 秒，等 app 真正就緒。
wait_for_app() {
  local out=""
  for i in $(seq 1 15); do
    out=$(room_exec "$CONTAINER" curl -s http://localhost:8080)
    if [[ -n "$out" ]]; then
      printf '%s' "$out"
      return 0
    fi
    sleep 1
  done
  printf '%s' "$out"
  return 1
}

step "result: curl localhost:8080 (最多重試 15 秒等待 app 啟動)" wait_for_app
```

`lab/` 以 `:ro` 掛載進 `lab-api` container，修改後不需重建 image 即可生效。

## 4. 驗證

對 `room8` 重新發起一次 run（緊接在前一輪 15 場景全部跑完之後，DinD
仍處於同一個負載較高的狀態）：

```
step 6: curl localhost:8080 (最多重試 15 秒等待 app 啟動)
  exit_code: 0
  output: "Connected to DB: database\nFLAG: EscapeDocker{e860c9d049fd3fbf}"

status: success
flag_found: EscapeDocker{e860c9d049fd3fbf}
duration_ms: 60575
```

`/api/lab/analytics/detection-matrix` 中 `room8` 變成 `runs: 2`
（修復前的 1 次 `failed` + 修復後的 1 次 `success`），
`rule_coverage`／`triggered_rules`（`Docker Compose Executed In Container`）
兩次皆相同、不受影響——只有 `success_rate`/`flag_rate` 從 0 變成 0.5，
忠實反映「同一份腳本，修復前必失敗、修復後必成功」。若要讓
detection-matrix 呈現每個場景剛好 1 次的乾淨資料，需再次
`DELETE /api/lab/runs` 並重跑全部 15 個場景（修復後 room8 應穩定
`success`）。

## 5. 修改檔案清單

| 檔案 | 變更 |
|---|---|
| `lab/exploits/room8.sh` | 最後一步 `curl localhost:8080` 改為 `wait_for_app`：最多重試 15 秒（每秒一次），等 app 容器內的 HTTP server 完成啟動並 bind port 8080 後才讀取回應，避免在 Docker daemon 負載較高時被 `ECONNRESET` 誤判為 failed |

## 6. 相關問題

- [[room8-dind-stale-pid-restart-loop]] — 同樣源自 room8 DinD
  （`storage-driver=vfs`）在 host 負載/非正常終止時的脆弱性，但作用層級
  不同（容器重啟迴圈 vs. 應用啟動競態）
- [[strace-ground-truth-pilot]] — 同一輪「清除歷史並重跑 15 場景」流程
  發現的另一個問題（Ptrace 告警量），可一併參考當時的執行脈絡
