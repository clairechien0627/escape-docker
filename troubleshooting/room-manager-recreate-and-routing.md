# room-manager：recreate 卡住 / readiness 永遠 timeout / `/api/rooms/*` 路由錯誤

> **日期：** 2026-06-11

> 對應修復：`room-manager/lib/docker.js`、`nginx/nginx.conf`（commit `7f03847`）

room-manager 上線（房間 on-demand 啟停／重置）後，測試「閒置自動 stop →
進入時自動喚醒 → 強制重置」這條流程時，發現三個各自獨立的問題。

## 1. `--force-recreate` 後容器網路設定跑掉

### 問題

`recreateContainer()` 是用 dockerode 手動重做一次
「拿舊容器設定 → 刪除 → 用相同設定建立新容器 → 重新接上所有網路」，
取代 `docker compose up -d --force-recreate`（因為 compose CLI 在
container 內呼叫會比較麻煩）。

舊寫法：

```js
const createOptions = {
  ...
  HostConfig: { ...info.HostConfig, NetworkMode: 'none' },
};

await container.remove({ force: true });
const newContainer = await docker.createContainer(createOptions);

// 建立後再把舊容器的所有網路一個一個接回去
for (const [netName, netInfo] of Object.entries(networks)) {
  const aliases = (netInfo.Aliases || []).filter((a) => a !== oldShortId);
  await docker.getNetwork(netName).connect({ Container: newContainer.id, ... });
}
```

也就是：建立新容器時先把網路設成 `none`（完全沒有網路），
之後再用 `network.connect()` 把「所有」網路（含原本的主要網路）
一個一個接上去。

### 根因

Docker container 的 **主要網路**（`HostConfig.NetworkMode` 指到的那個
網路）是在 **建立容器當下**由 Docker 依 `NetworkingConfig` 自動接上、
套用 alias 的；它跟「之後再用 `network.connect()` 手動接」走的是不同
路徑。把主要網路設成 `none` 之後，再用 `connect()` 補接同一個網路，
要嘛拿不到原本的 alias，要嘛跟 Docker 內部已經幫這個 `NetworkMode`
做的隱性處理打架——導致重建後的容器網路狀態不正確（DNS/別名失效），
後續 `docker exec` 進去這個容器要嘛連不上其他服務、要嘛整個
recreate 流程卡住不動。

### 修復

把「主要網路」獨立出來，**在 `createContainer` 當下就透過
`NetworkingConfig.EndpointsConfig` 帶入**（讓 Docker 用它原本的自動
接上機制處理），其餘的「次要網路」才用迴圈 `connect()` 補接：

```js
const oldShortId = info.Id.substring(0, 12);
const networks = info.NetworkSettings.Networks || {};
const primaryNetName = info.HostConfig.NetworkMode;

const networkingConfig = { EndpointsConfig: {} };
if (networks[primaryNetName]) {
  const netInfo = networks[primaryNetName];
  networkingConfig.EndpointsConfig[primaryNetName] = {
    IPAMConfig: netInfo.IPAMConfig,
    Aliases: (netInfo.Aliases || []).filter((a) => a !== oldShortId),
  };
}

const createOptions = {
  ...
  HostConfig: info.HostConfig,       // 不再強制改成 'none'
  NetworkingConfig: networkingConfig,
};

await container.remove({ force: true });
const newContainer = await docker.createContainer(createOptions);

for (const [netName, netInfo] of Object.entries(networks)) {
  if (netName === primaryNetName) continue;   // 主要網路已在建立時處理，跳過
  const aliases = (netInfo.Aliases || []).filter((a) => a !== oldShortId);
  await docker.getNetwork(netName).connect({ Container: newContainer.id, ... });
}
```

## 2. `waitUntilReady()` 永遠等到 timeout 才返回

### 問題

容器重新啟動後，`waitUntilReady()` 用 `docker exec` 執行 `true`
來確認容器內的 process 已經可以接受指令：

```js
const exec = await container.exec({ Cmd: ['true'], AttachStdout: true, AttachStderr: true });
const stream = await exec.start({});
await new Promise((resolve, reject) => {
  stream.on('end', resolve);
  stream.on('error', reject);
});
```

實測發現：就算容器早就 ready 了，這個 `Promise` 還是要等到外層的
30 秒 timeout 才會結束，每次「進入一個被 stop 掉的房間」玩家都要
**乾等 30 秒**。

### 根因

dockerode／底層 `stream.Duplex` 回傳的 exec output stream
**預設是 paused 狀態**——在沒有人讀取（`.read()` / `.resume()` /
掛 `'data'` listener）之前，stream 不會開始流動，
也就**永遠不會 emit `'end'`**。舊程式碼只掛了 `'end'` 跟
`'error'` listener，沒有讓 stream 開始流動，所以 `'end'` 永遠不會
觸發，`Promise` 因此卡住，直到外層整體的 30 秒 timeout 才放棄。

### 修復

呼叫 `stream.resume()` 把 stream 的內容「排掉」（這裡不關心
`true` 指令的輸出內容，只關心它何時執行完畢），並額外加上單次
exec 的 5 秒 timeout 當保險，避免單次卡住又拖累整個重試迴圈：

```js
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('exec stream timeout')), 5000);
  stream.on('end', () => { clearTimeout(timer); resolve(); });
  stream.on('error', (err) => { clearTimeout(timer); reject(err); });
  stream.resume();   // 關鍵：drain 這個 stream，'end' 才會被觸發
});
```

修復後，房間「喚醒」的等待時間從固定 30 秒，變成容器實際就緒所需的
時間（通常 1-2 秒）。

## 3. nginx `/api/rooms/*` 只有 `/status` 能用，`ensure`／`reset` 都 404

### 問題

room-manager 提供的 API 是：

- `GET  /status`
- `POST /rooms/:id/ensure`
- `POST /rooms/:id/reset`
- ...

舊的 nginx 設定是單一 prefix proxy：

```nginx
location /api/rooms/ {
    proxy_pass http://room_manager/;
}
```

`proxy_pass` 結尾帶 `/` 時，nginx 會把 `location` 比對到的 prefix
（`/api/rooms/`）從原始路徑中整段去掉，再接到 `proxy_pass` 後面。結果：

| 前端請求 | 實際轉發到 | 結果 |
|---|---|---|
| `/api/rooms/status` | `http://room_manager/status` | ✅ 正常 |
| `/api/rooms/room0/ensure` | `http://room_manager/room0/ensure` | ❌ 404（少了 `/rooms` 前綴） |

map.html 的房間狀態徽章（輪詢 `/status`）看起來一切正常，但玩家進入
房間時呼叫的 `ensure` / `reset` / `heartbeat` / `release` 全部 404，
on-demand 喚醒功能形同沒作用。

### 修復

拆成兩條規則，分別處理「整段替換」和「保留 `/rooms/` 前綴」：

```nginx
# /api/rooms/status -> room-manager:/status
location = /api/rooms/status {
    proxy_pass         http://room_manager/status;
    proxy_http_version 1.1;
    proxy_set_header   Host $host;
    proxy_set_header   X-Real-IP $remote_addr;
}

# /api/rooms/<id>/ensure (reset、heartbeat、release 同理)
# -> room-manager:/rooms/<id>/ensure
location ~ ^/api/rooms/(.+)$ {
    proxy_pass         http://room_manager/rooms/$1;
    proxy_http_version 1.1;
    proxy_set_header   Host $host;
    proxy_set_header   X-Real-IP $remote_addr;
}
```

## 4. 經驗教訓

- 用 dockerode 重建容器時，**主要網路（`HostConfig.NetworkMode`）
  一定要在 `createContainer` 的 `NetworkingConfig` 裡一次到位**，
  不要先設 `none` 再事後 `connect()` 補回去
- dockerode 的 exec stream 預設是 paused，只掛 `end`/`error`
  listener而不 `resume()`/讀取資料的話，`end` 永遠不會觸發——
  這個坑很隱蔽，因為程式碼「看起來」邏輯完全正確
- nginx `proxy_pass` 帶不帶結尾 `/`、`location` 用 prefix 還是
  regex，會直接決定路徑怎麼被改寫；後端 API 如果路徑前綴不規則
  （`/status` vs `/rooms/:id/...`），就需要拆成多條 `location`
  分別處理，不能只用一條籠統的 prefix proxy
