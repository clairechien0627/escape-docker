# Secret Room A：entrypoint.sh 用 `echo` 而非 `echo -n` 算 `REAL_FLAG`，導致房間自己的主要解法算出錯誤 FLAG

> **日期：** 2026-06-13

## 1. 緣由

在排查 [[secret-b-image-flag-mismatch-and-walkthrough-confusion]] 與
[[secret-b-oci-layer-format-mismatch]] 的過程中，順手核對
`lab/exploits/README.md` 記錄的 `secret-a.sh` 預期 flag
`EscapeDocker{7acfa24bbedf6d70}`，發現這個值剛好等於「`echo`（多一個換行）
算出來的錯誤 hash」——也就是 [[walkthrough-echo-missing-n-flag-mismatch]]
那篇文件中描述的同一種錯誤模式。這暗示問題不只在 walkthrough/scoreboard
提示文字裡，**Secret Room A 的 container 本身**可能也用同樣錯誤的方式算
`REAL_FLAG`。

## 2. 根因

`rooms/secret-a/entrypoint.sh`（修復前）：

```bash
#!/bin/bash
export FLAG_SEED="${FLAG_SEED:-escape_docker_dev_seed}"
export LEAKED_SECRET="${FLAG_SEED}"
FLAG=$(echo "${FLAG_SEED}-secret-a" | sha256sum | cut -c1-16)
export REAL_FLAG="EscapeDocker{${FLAG}}"
exec "$@"
```

第 4 行用 `echo "${FLAG_SEED}-secret-a"`（**沒有 `-n`**），會在字串結尾多一
個 `\n`，因此 `sha256sum` 實際雜湊的是 `"${FLAG_SEED}-secret-a\n"`。

但 `scoreboard-api/flags.py` 的 `_gen()` 用
`hashlib.sha256(f'{FLAG_SEED}-secret-a'.encode()).hexdigest()[:16]`，
**不含**結尾換行。兩者輸入不同 → hash 不同 → `REAL_FLAG` 與 scoreboard
預期值不一致。

**這是本次 session 第三個獨立發現的同類 bug**（`walkthrough.md` 兩處、
`rooms/secret-b/Dockerfile` 一處、現在又一處），但**嚴重性最高**：

- `walkthrough.md` 的兩處只是「手動計算範例」算錯，玩家仍可用
  `docker inspect` 等方式拿到正確 FLAG。
- `secret-b/Dockerfile` 的錯誤只影響 image 內建的隱藏 FLAG（次要解法）。
- 這次的 `secret-a/entrypoint.sh` 錯誤，影響的是**房間文件記載的唯一/主要
  解法**：玩家利用 `docker.sock` 對 `secret-a`（或任何能讀
  `/proc/<pid>/environ` 的容器）做
  `docker inspect` / 讀取 `REAL_FLAG` 環境變數，得到的就是這個算錯的值，
  **永遠對不上 scoreboard 期望的 `EscapeDocker{2a133e13be44ef89}`**。
  也就是說，修復前 Secret Room A **用文件記載的標準解法是無法通關的**。

## 3. 修復

`rooms/secret-a/entrypoint.sh` 第 4 行 `echo` → `echo -n`：

```bash
#!/bin/bash
export FLAG_SEED="${FLAG_SEED:-escape_docker_dev_seed}"
export LEAKED_SECRET="${FLAG_SEED}"
FLAG=$(echo -n "${FLAG_SEED}-secret-a" | sha256sum | cut -c1-16)
export REAL_FLAG="EscapeDocker{${FLAG}}"
exec "$@"
```

`entrypoint.sh` 是透過 `COPY` 在 build time 寫進 image 的，僅
`--force-recreate` 不會套用變更，需要先 `docker compose build`：

```bash
docker compose build secret-a
docker compose up -d --force-recreate secret-a
```

## 4. 驗證

```bash
$ MSYS_NO_PATHCONV=1 docker exec secret-a bash -c \
  "tr '\0' '\n' < /proc/1/environ | grep -E 'REAL_FLAG|LEAKED_SECRET'"
LEAKED_SECRET=escape_docker_dev_seed
REAL_FLAG=EscapeDocker{2a133e13be44ef89}
```

`2a133e13be44ef89` 與 `scoreboard-api` 的 `_gen("secret-a")` 結果一致。

另以 `lab/exploits/secret-a.sh`（讀取 `/proc/1/environ`，腳本本身不需修改）
重新執行，確認 `flag_found` 同步變為
`EscapeDocker{2a133e13be44ef89}`：

```json
{"type":"result","scenario_id":"secret-a","status":"success","steps":2,
 "final_privilege":"player (read REAL_FLAG via /proc/1/environ)",
 "flag_found":"EscapeDocker{2a133e13be44ef89}"}
```

## 5. 修改檔案清單

| 檔案 | 變更 |
|---|---|
| `rooms/secret-a/entrypoint.sh` | 第 4 行 `echo "${FLAG_SEED}-secret-a"` → `echo -n "${FLAG_SEED}-secret-a"` |

## 6. 相關問題

- 與 [[walkthrough-echo-missing-n-flag-mismatch]]、
  [[secret-b-image-flag-mismatch-and-walkthrough-confusion]] 是同一個錯誤
  模式（`echo` vs `echo -n` 造成的多一個換行字元）在本次 session 中第三次
  出現。建議之後若新增/修改任何「用 shell 算 FLAG hash」的程式碼
  （entrypoint.sh、Dockerfile、scoreboard-api 提示文字、walkthrough），
  一律檢查是否用了 `echo -n`，避免同一類錯誤再度發生。
- room0/1/2/11 的 `entrypoint.sh` 已確認原本就正確使用 `echo -n`，僅
  `secret-a` 受影響。
