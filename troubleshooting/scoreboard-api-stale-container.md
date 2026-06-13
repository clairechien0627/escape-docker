# scoreboard-api 與前端 API 不一致（container 沒跟著切換 branch 重建）

## 1. 緣由

切換到目前這個 branch 後，開 `http://localhost/map.html` 進不去，瀏覽器
console 報：

```
api/player/test:1  Failed to load resource: the server responded with a
status of 404 (Not Found)
```

## 2. 根因

`scoreboard-api` 的 image 是 6/12 09:25 build 的，當時的 `main.py` /
`database.py` 是另一個分支（EdgeRange Hub Phase 1，token/`student_id`
驗證）的版本，路由是 `/auth/register`、`/auth/me`、`/player/me`。

切回這個 branch 後，host 上的 `scoreboard-api/main.py` /
`database.py`（6/13 13:34）變回本分支版本，路由是 `/register`、
`/player/{name}`，與 `frontend/js/api.js` 呼叫的
`/api/player/<name>`、`/api/register` 一致。

但 **container 沒有跟著重建**——它仍在跑 6/12 build 的舊 image，裡面
根本沒有 `/player/{name}` 這個路由，所以 `/api/player/test` 在
scoreboard-api 內部就是 404（FastAPI 找不到對應 route）。

驗證方式：`docker exec scoreboard-api` 內看 `/app/main.py` 的路由
（`@app.get("/player/me")` 等），跟 host 上 `scoreboard-api/main.py`
（`@app.get("/player/{name}")`）的版本不同。

## 3. 修復

```bash
docker compose up -d --build scoreboard-api
```

重建後 container 內部 `/scoreboard` healthcheck 正常（200），但透過
nginx 打 `/api/...` 仍是 **502 Bad Gateway**——因為 nginx 的
`upstream scoreboard_api { server scoreboard-api:8000; }` 在啟動時就把
`scoreboard-api` 解析成「重建前」那個 container 的 IP 並快取住，
container 重建後換了新 IP，nginx 沒有重新解析 DNS。

```bash
docker restart escape-nginx
```

重啟 nginx 後恢復正常。

## 4. 驗證

```
curl http://localhost/api/player/test
-> 200 {"name":"test","flags":[],...,"rooms":[...]}

curl http://localhost/api/scoreboard
-> 200
```

`http://localhost/map.html` 可正常載入。

## 5. 修改檔案清單

無程式碼變更，純粹是 **重建 + 重啟既有 container**：

| 動作 | 對象 |
|---|---|
| `docker compose up -d --build` | `scoreboard-api`（套用切換 branch 後的最新 `main.py`/`database.py`） |
| `docker restart` | `escape-nginx`（重新解析 `scoreboard-api` 的新 IP，解決 502） |

## 6. 備註：以後切換 branch 的注意事項

若切換 branch 改到 `scoreboard-api/`、`terminal-gateway/`、
`room-manager/` 等任何「會被 build 進 image」的服務原始碼，記得對應
`docker compose up -d --build <service>` 重建；若該服務有被其他容器
透過 `upstream`/固定 IP 引用（這裡是 nginx → scoreboard-api），重建後
也要 `docker restart` 那個引用方，避免 502。
