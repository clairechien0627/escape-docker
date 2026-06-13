# room8 challenge docker-compose.yml 的 YAML 語法錯誤排查報告

> 在撰寫 `lab/exploits/room8.sh` 時發現並修復。

## 1. 緣由

room8 的題目是「修復 `rooms/room8/challenge/docker-compose.yml` 裡的
BUG1（缺少 `depends_on`）和 BUG2（缺少 `DB_HOST` 環境變數）」，玩家修好
後執行 `docker compose up -d` 應該能看到 `app` 服務正確連上
`database` 並回傳 FLAG。

撰寫 `room8.sh` 時，第一步 `docker compose config` 驗證這個檔案本身的
YAML 語法，結果發現：

```
yaml: line 28: could not find expected ':'
```

也就是說，**這個檔案在 BUG1/BUG2 之外，還有一個讓它完全無法被
docker compose 解析的 YAML 語法錯誤**——不管玩家有沒有正確修好
BUG1/BUG2，`docker compose up` 一定會直接失敗在「讀不懂這個檔案」，
題目本身是不可解的。

## 2. 根因

`app` service 原本的 `command` 寫法：

```yaml
  app:
    image: python:3.11-slim
    command: >
      sh -c "
        python3 -c \"
import os, hashlib, time, http.server

db_host = os.environ.get('DB_HOST', '')
...
\"
      "
```

`command: >` 是 YAML 的**折疊式區塊純量（folded block scalar）**，它的
縮排基準由區塊內**第一個非空行**決定——這裡是 `sh -c "`，縮排 6 個
空白，所以基準縮排 = 6。

但緊接著的 python 程式碼（`import os, hashlib, ...` 開始的整段）完全
**沒有縮排**（縮排 = 0 < 6）。根據 YAML 規範，一旦某行的縮排小於區塊
純量的基準縮排，這個區塊純量就**結束**了；YAML 解析器接著把
`import os, hashlib, time, http.server` 這一行當成「`command:` 之後的
新一個 YAML 對映（mapping）」來解析，但這一行不含 `:`，於是報錯
`could not find expected ':'`。

## 3. 修復

### 3.1 改用文字式區塊純量（`|`）並修正縮排

把 `command: >`（folded）改成 `command: |`（literal），並把整段
python 程式碼縮排到 >= 基準縮排（6 個空白），同時保留 python 程式碼
原本的相對縮排（4 空白一級），讓 if/class/def 區塊在 python 端的縮排
仍然正確：

```yaml
    command: |
      sh -c "
        python3 -c \"
      import os, hashlib, time, http.server

      db_host = os.environ.get('DB_HOST', '')
      seed = os.environ.get('FLAG_SEED', 'dev')

      if not db_host:
          print('ERROR: DB_HOST not set! Fix the docker-compose.yml')
          exit(1)
      ...
        \"
      "
```

`docker compose config` 確認可正常解析（`version: "3.9"` 的 deprecation
warning與本問題無關，未處理）。

### 3.2 第二個隱藏問題：`\n` 在 compose 的字串轉指令陣列時被吃掉一層

修好縮排後實際跑起來，HTTP 回應變成：

```
Connected to DB: testdbnFLAG: EscapeDocker{3731de696fb31405}n
```

——`\n`（換行）變成了字面上的字元 `n`，少了一個換行。

原因：`command:` 若給的是一個字串（而不是 YAML list），
`docker compose` 會用類似 shell 的規則把這個字串切成
`["sh", "-c", "<...>"]` 三個元素；在這個切分過程中，**任何
`\X`（反斜線 + 任意字元）都會被處理成只剩 `X`**（這與 `\"` 被還原成
`"` 是同一套規則）。

所以 YAML 裡寫的 `\"`（給 python f-string前的 shell 引號）被消耗成
`"`（正確、預期的行為：讓它成為 `python3 -c "..."` 的引號），但 YAML
裡寫的 `\n`（python f-string 的換行符）也被消耗成了 `n`（非預期：
python 收到的是字面字元 `n`，不是換行）。

**修復**：在 YAML 裡把 python f-string 中的 `\n` 改寫成 `\\n`
（兩個反斜線）。經過 compose 那一層「消耗一個反斜線」之後，python
實際收到的就是 `\n`，f-string 才能正確解讀成換行：

```diff
-              self.wfile.write(f'Connected to DB: {db_host}\nFLAG: {flag}\n'.encode())
+              self.wfile.write(f'Connected to DB: {db_host}\\nFLAG: {flag}\\n'.encode())
```

## 4. 驗證

```bash
cd rooms/room8/challenge
docker compose run -d --rm -e DB_HOST=testdb -e FLAG_SEED=testseed \
  -p 18080:8080 --name room8_yaml_test app
curl -s http://localhost:18080
```

```
Connected to DB: testdb
FLAG: EscapeDocker{3731de696fb31405}
```

換行正確，FLAG 格式正確。

另外確認 BUG1/BUG2（題目原本要玩家修的部分）行為不受影響——不設
`DB_HOST` 時，仍會印出原本設計的提示並 `exit(1)`：

```bash
docker compose run --rm -e FLAG_SEED=testseed app
```

```
ERROR: DB_HOST not set! Fix the docker-compose.yml
exit status 1
```

## 5. 修改檔案清單

| 檔案 | 變更 |
|---|---|
| `rooms/room8/challenge/docker-compose.yml` | `app` service 的 `command`：`>` → `\|`，重新縮排內嵌的 python 程式碼，並把 f-string 裡的 `\n` 改為 `\\n` |
