# Lab「▶ 執行」需要 Admin Token，輸入錯誤後永久卡住無法重試

> **日期：** 2026-06-14

## 1. 緣由

使用者開啟 `frontend/lab/index.html`，點擊任一場景的「▶ 執行」按鈕，
被 `window.prompt` 要求輸入 Admin Token。使用者不知道目前的
token 值（`.env` 裡的 `ADMIN_TOKEN=admin_secret_change_me`，與
`lab-api/README.md` 文件中寫的預設值 `admin_dev_token` 不同），
輸入了一次錯誤的值之後，後續再點「▶ 執行」就完全沒有反應、
頁面也無法「重新打開」輸入框。

## 2. 根因

兩個問題疊加：

### 2.1 錯誤 token 會被永久快取，且沒有重試入口

`frontend/lab/index.html` 的 `getAdminToken()`：

```js
function getAdminToken() {
  let token = localStorage.getItem('escape_docker_admin_token');
  if (!token) {
    token = window.prompt('執行實驗需要 Admin Token：');
    if (token) localStorage.setItem('escape_docker_admin_token', token);
  }
  return token;
}
```

只要 `localStorage` 裡有任何非空字串（即使是錯誤的 token），
`window.prompt` 就再也不會出現——之後每次點「▶ 執行」都會用同一個
錯誤的 token 呼叫 `POST /api/lab/runs`，後端回 `401`，前端只彈一個
`toast`（容易被忽略），看起來就像「按鈕完全失效、打不開」。

### 2.2 設計上不需要這層驗證

`lab-api/lib/app.js` 的 `POST /api/lab/runs` 原本套用
`requireAdmin` middleware（檢查 `x-admin-token` header）。但
Edge Container Security Lab 的設計目的，就是讓使用者自行選擇場景、
觸發攻擊腳本、觀察 Falco 偵測結果的**實驗模擬平台**——「執行」
與「查看歷史/分析」一樣應該是公開操作，不應該有登入關卡。
這層驗證是從 `admin.html`（記分板管理面板）沿用過來的模式，但
並不適用於 Lab 的使用情境，是設計上的不一致而非單純的前端 bug。

## 3. 修復

- `lab-api/lib/app.js`：移除 `requireAdmin` middleware 與
  `POST /api/lab/runs` 上的驗證；`createApp()` 不再需要 `adminToken`
  參數（`lab-api/index.js` 的 `ADMIN_TOKEN` 仍保留，僅用於 lab-api
  → room-manager 內部 reset 呼叫）
- `frontend/lab/index.html`：移除 `getAdminToken()`、
  `localStorage.escape_docker_admin_token`，`runScenario()` 直接呼叫
  `POST /api/lab/runs`，不再附加 `X-Admin-Token` header
- 同步更新 `lab-api/README.md`、`frontend/lab/README.md`、
  `docs/edge-container-security-lab-proposal.md`：「執行」改為
  不需登入，`ADMIN_TOKEN` 僅作為 lab-api 內部呼叫 room-manager 用

## 4. 驗證

- `node --test`（`lab-api/`）：30/30 通過（移除原本驗證 401 的測試，
  其餘測試改為不帶 `x-admin-token` header 仍可正常執行）
- `docker compose build lab-api && docker compose up -d lab-api` 後：
  - `curl -X POST http://localhost/api/lab/runs -d '{"scenario_id":"does-not-exist"}'`
    回傳 `404`（場景不存在），而非 `401`（未授權），確認驗證已移除
  - 瀏覽器開啟 `frontend/lab/index.html`，點擊任一場景的「▶ 執行」
    不再彈出 Admin Token 輸入框，直接跳轉到 `run.html?id=...`
    即時觀看執行過程

## 5. 修改檔案清單

| 檔案 | 變更 |
|---|---|
| `lab-api/lib/app.js` | 移除 `requireAdmin`、`/api/lab/runs` 的驗證、`createApp()` 的 `adminToken` 參數 |
| `lab-api/index.js` | `createApp()` 呼叫不再傳入 `adminToken`（`ADMIN_TOKEN` 常數保留供 room-manager client 使用） |
| `lab-api/test/app.test.js` | 移除 401 測試，其餘 `POST /api/lab/runs` 測試不再帶 `x-admin-token` header |
| `frontend/lab/index.html` | 移除 `getAdminToken()` 與 admin token 相關的 prompt/localStorage/header |
| `lab-api/README.md` | `POST /api/lab/runs` 說明改為「無需登入」；`ADMIN_TOKEN` 說明改為僅供內部 room-manager 呼叫 |
| `frontend/lab/README.md` | 移除「執行需要 admin token」相關段落 |
| `docs/edge-container-security-lab-proposal.md` | 設計原則第 4 點改為「開放執行」；Phase 3/4 備註更新 |
