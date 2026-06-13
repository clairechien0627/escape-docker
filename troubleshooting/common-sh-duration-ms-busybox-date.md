# `lab/exploits/lib/common.sh`：在 BusyBox `date`（lab-api 的 alpine 容器）上 `duration_ms` 永遠算成 0

> **日期：** 2026-06-13

## 1. 緣由

實作 `lab-api`（Phase 2 執行引擎）後，第一次透過
`POST /api/lab/runs` 在容器內執行 `lab/exploits/room2.sh`，回應的 JSON
結果正確（`status: success`、`flag_found` 正確），但所有 step 與最終
`result` 的 `duration_ms` 都是 `0`：

```json
{"type":"step","index":1,"name":"recon: sudo -l","exit_code":0,"duration_ms":0,"output":"..."}
...
{"type":"result","scenario_id":"room2","status":"success","steps":4,"duration_ms":0,...}
```

先前在 host（Windows Git Bash）直接執行同一支腳本時，`duration_ms`
都是合理的數值（數十到數千毫秒），因此這是「執行環境」造成的差異。

## 2. 根因

`lab/exploits/lib/common.sh` 用 `date +%s%3N` 取得「毫秒時間戳」：

```bash
REPORT_START_TS=$(date +%s%3N)
...
start_ts=$(date +%s%3N)
...
end_ts=$(date +%s%3N)
```

`%3N`（GNU date 的「取奈秒並截斷成 3 位」語法）只有 **GNU coreutils
date** 支援。Git Bash（MSYS2）與 WSL 上的 `date` 都是 GNU coreutils，
所以 host 端執行時 `%3N` 正常運作。

但 `lab-api` 的 Docker image 是 `node:20-alpine`，其 `date` 是
**BusyBox date**。BusyBox 的 `date` 不認識 `%3N` 這個格式碼，**靜默
忽略**它，所以 `date +%s%3N` 實際上等同 `date +%s`——回傳的是「秒」，
不是「毫秒」，但變數名稱與輸出欄位仍標示為 `_ms`：

```sh
$ docker exec lab-api date +%s%3N
1781367655          # 只有 10 位數的「秒」，%3N 被吃掉了
```

對於通常在 1 秒內完成的 step，`start_ts` 與 `end_ts`（單位皆為秒）
相減幾乎必為 `0`；對最終 `result` 的總耗時，若腳本跑超過 1 秒則會得到
「秒數」而非「毫秒數」（例如實際跑 4.5 秒會顯示 `duration_ms: 4` 或
`5`），仍是錯誤的單位。

## 3. 修復

改用 **bash 5+ 內建變數 `$EPOCHREALTIME`**（格式
`<10 位秒>.<6 位微秒>`，例如 `1781367674.824265`），它是 bash 的 shell
變數，不經過任何外部 `date` 指令，因此不受 BusyBox/GNU 差異影響。
新增 helper：

```bash
# lab/exploits/lib/common.sh
_epoch_ms() {
  local t="${EPOCHREALTIME/./}"   # 去掉小數點："1781367674824265"
  printf '%s' "${t:0:13}"         # 取前 13 位 = 秒(10位) + 毫秒(3位)
}
```

並把全部 3 處 `$(date +%s%3N)` 換成 `$(_epoch_ms)`
（`REPORT_START_TS` 初始化、`step()` 的 `start_ts`/`end_ts`、
`report_finish()` 的 `end_ts`）。

確認兩個執行環境的 bash 版本都 >= 5.0（`EPOCHREALTIME` 為 bash 5.0
新增的內建變數）：

```
# host（Git Bash）：bash 5.2.12
# lab-api（node:20-alpine + apk add bash）：bash 5.3.3
```

## 4. 驗證

**lab-api 容器內（透過 `POST /api/lab/runs`）**：

```bash
curl -s -X POST http://localhost/api/lab/runs \
  -H "Content-Type: application/json" -H "x-admin-token: $ADMIN_TOKEN" \
  -d '{"scenario_id":"room2"}'
```

修復前：所有 `duration_ms` 為 `0`。
修復後：

```
status= success flag= EscapeDocker{afcb8ee92a23974c} duration_ms= 1020
recon: sudo -l -> 177 ms
recon: read backup.sh -> 103 ms
exploit: sudo backup.sh /secret/flag.txt -> 119 ms
result: read /tmp/out -> 118 ms
```

**host（Git Bash，回歸測試確認沒有破壞既有行為）**：

```bash
MSYS_NO_PATHCONV=1 bash lab/exploits/room2.sh
```

```
duration_ms: 464 / 451 / 438 / 427（各 step），總計 4531（result）
```

兩個環境都得到合理的毫秒數值，且 `lab-api/test`（17 個測試）全數通過
（測試使用 fake `runExploit`，不受此變更影響，僅作為回歸確認）。

## 5. 修改檔案清單

| 檔案 | 變更 |
|---|---|
| `lab/exploits/lib/common.sh` | 新增 `_epoch_ms()` helper（以 `$EPOCHREALTIME` 取得毫秒時間戳）；`REPORT_START_TS`、`step()`、`report_finish()` 改用 `_epoch_ms` 取代 `date +%s%3N` |

## 6. 相關問題

此 bug 是在實作 `lab-api`（見 `lab-api/README.md`，Phase 2 執行引擎）
並第一次在 alpine 容器內跑 exploit 腳本時發現的——所有 15 支
`lab/exploits/*.sh` 共用 `common.sh`，因此影響全部場景的計時欄位，但
不影響 `status`/`final_privilege`/`flag_found` 等核心判定邏輯。
