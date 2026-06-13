# xterm.js 終端機滾動「破圖」與滾動失效

> **日期：** 2026-06-13

## 1. 緣由

在這次連續重建多個房間容器（造成 WebSocket 多次斷線重連）的過程中，
使用者在 room8 用 `vim docker-compose.yml` 時畫面出現滾動後「疊圖／
破圖」——畫面顯示混合了正常文字與類似 `5;5R`、vim ruler 殘影等亂碼，
且滑鼠滾輪在終端機內完全無法滾動。

## 2. 根因

兩個獨立問題疊加：

### 2.1 WebSocket 重連時，xterm.js 終端機物件沒有被重置

`frontend/js/terminal.js` 的 `EscapeTerminal` 在 WebSocket 斷線重連時
（`ws.onclose` → `setTimeout(() => this._connect(), 3000)`）**重複使用
同一個 `this.term`**（xterm.js `Terminal` 實例）。

如果舊的 pty session 是在 vim/less 等全螢幕程式、且正處於
**alternate screen buffer + 自訂 scroll region** 的 escape sequence
中途斷線，xterm.js 內部狀態（active buffer、scroll region、游標位置）
會殘留下來。新 session 的輸出（例如 bash prompt、新的 vim 畫面）會被
畫在這個被污染的舊狀態上，造成畫面疊圖/破圖。

### 2.2 `.xterm-viewport { overflow-y: hidden }` 讓 xterm.js 滾動機制失效

`frontend/play.html` 原本為了隱藏捲軸而設定：

```css
.xterm-viewport { overflow-y: hidden !important; }
```

但 xterm.js 的 scrollback 顯示是透過 `.xterm-viewport` 元素本身的
`scrollTop`（原生捲動）來實現的——`overflow-y: hidden` 讓這個元素
**完全不能捲動**，滑鼠滾輪事件雖然會被 xterm.js 攔截並嘗試呼叫
`scrollLines()`，但底層 DOM 元素無法捲動，畫面不會更新／或更新位置
錯誤，外觀上就是「滾動沒有反應」或「滾動後畫面錯位」。

## 3. 修復

### 3.1 WebSocket 重連時呼叫 `term.reset()`

`frontend/js/terminal.js` 的 `ws.onopen`：

```javascript
this.ws.onopen = () => {
  this.connected = true;
  this.reconnecting = false;
  this._hideDisconnectBanner();
  // 重置終端機狀態（alternate screen / scroll region / 游標等），避免上一個
  // session（可能斷線在 vim/less 等全螢幕程式的 escape sequence 中途）的殘留
  // 狀態污染新 pty session 的畫面，造成滾動時的疊圖/破圖
  this.term.reset();
  this._onResize();
};
```

### 3.2 `.xterm-viewport` 改用 `overflow-y: auto` + 隱藏捲軸

`frontend/play.html`：

```css
.xterm { height: 100% !important; }
/* 用 auto 保留 xterm.js 內部 scrollTop 捲動機制（overflow:hidden 會讓
   scrollback 無法捲動），改用 scrollbar-width/::-webkit-scrollbar 隱藏
   捲軸即可達到原本「看起來沒有捲軸」的效果 */
.xterm-viewport {
  overflow-y: auto !important;
  scrollbar-width: none;
}
.xterm-viewport::-webkit-scrollbar { display: none; }
```

## 4. 驗證

使用者重新整理頁面、重新進入 room8 後，確認：

- vim 編輯 `docker-compose.yml` 時上下捲動畫面正常，不再出現疊圖/破圖
- 滑鼠滾輪可正常捲動終端機內容（捲軸本身仍隱藏，視覺上無變化）

> 滾動後出現「滾一格跳 15 行」是 `lineHeight: 1.3 → 1`（先前 session
> 的改動）造成 cell 高度變小、單位 wheel-delta 對應的行數變多的副作用，
> 使用者確認可接受，未進一步調整 `scrollSensitivity`。

## 5. 修改檔案清單

| 檔案 | 變更 |
|---|---|
| `frontend/js/terminal.js` | `ws.onopen` 新增 `this.term.reset()` |
| `frontend/play.html` | `.xterm-viewport`：`overflow-y: hidden` → `overflow-y: auto` + `scrollbar-width: none` / `::-webkit-scrollbar { display: none }` |
