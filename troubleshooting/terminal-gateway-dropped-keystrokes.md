# terminal-gateway 將部分按鍵（純數字/true/false/null）誤判為控制訊息並丟棄

> **日期：** 2026-06-13

## 1. 緣由

在排查 room8 終端機問題時檢視 `terminal-gateway/index.js` 與
`frontend/js/terminal.js` 的 WebSocket 訊息協定，發現兩端對「控制訊息
（resize）vs. 終端機輸入」的判斷邏輯不對稱，存在會讓玩家按鍵被靜默
丟棄的 bug。

## 2. 根因

`frontend/js/terminal.js` 的 `ws.onmessage`：

```javascript
let msg = null;
try {
  msg = JSON.parse(ev.data);
} catch {
  // 非 JSON：原始終端機輸出
}
if (msg && msg.type === 'status' ...) { ... return; }
if (msg && msg.type === 'ready') { ... return; }
if (msg && msg.type === 'error') { ... return; }

this._hideLoadingOverlay();
this.term.write(ev.data);   // ← 不管 JSON.parse 成功與否，最後都會 write
```

client 端永遠有 fallthrough：只有 `type` 是 `status`/`ready`/`error`
時才會被特殊處理並 `return`，其餘情況（包含 `JSON.parse` 成功但
`type` 不在這三者）都會落到 `term.write()`。

但 `terminal-gateway/index.js` 原本的 `ws.on('message', ...)`：

```javascript
ws.on('message', (msg) => {
  try {
    const parsed = JSON.parse(msg);
    if (parsed.type === 'resize') {
      resizeTerminal(pty, parsed.cols, parsed.rows);
      return;
    }
  } catch {
    pty.write(msg.toString());
  }
});
```

**沒有對稱的 fallthrough**：如果 `JSON.parse(msg)` 成功、但
`parsed.type !== 'resize'`，這個 if 區塊什麼都不做，也不會落到
`catch` 裡的 `pty.write()`——訊息被靜默丟棄，永遠不會寫入 pty。

玩家在終端機裡輸入的單個字元，若剛好是合法 JSON 的字面值，就會中這個
bug，**永遠打不出來**：

- 數字鍵（`0`-`9`）：`JSON.parse("5")` → `5`（number），`5.type` 是
  `undefined` ≠ `'resize'` → 丟棄
- 在某些情境下輸入的 `true` / `false` / `null` 字串同理會被
  `JSON.parse` 成功解析成 boolean/null，一樣被丟棄

也就是說，**room8（Room 8: The Fleet）這種需要打 port 號 `8080`、
`localhost:8080` 之類含數字指令的房間，玩家輸入數字鍵時可能會發現
數字打不出來**。

## 3. 修復

`terminal-gateway/index.js`：明確檢查 `parsed` 必須是
**帶 `type` 欄位的物件**才當成 resize 控制訊息處理；其餘所有情況
（包含剛好是合法 JSON 的單一數字/布林/null，以及非 JSON 字串）一律
寫入 pty：

```javascript
ws.on('message', (msg) => {
  let parsed = null;
  try {
    parsed = JSON.parse(msg);
  } catch {
    // 非 JSON，當成終端機輸入
  }

  if (parsed && typeof parsed === 'object' && parsed.type === 'resize') {
    resizeTerminal(pty, parsed.cols, parsed.rows);
    return;
  }

  if (pty) pty.write(msg.toString());
});
```

## 4. 驗證

```bash
docker compose up -d --build terminal-gateway
docker compose ps terminal-gateway room-manager
# 兩者皆 Up / Up (healthy)
```

重建後重新整理終端機頁面，數字鍵與 `true`/`false`/`null` 等輸入皆能
正常寫入 pty（不再被靜默丟棄）。

## 5. 修改檔案清單

| 檔案 | 變更 |
|---|---|
| `terminal-gateway/index.js` | `ws.on('message', ...)`：改用 `typeof parsed === 'object' && parsed.type === 'resize'` 判斷 resize 控制訊息，其餘一律 `pty.write()` |
