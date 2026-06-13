# Room 4 walkthrough.md 沒說明 SSH Tunnel 要在哪台機器執行

## 1. 緣由

修完 [[room4-unsolvable-no-pubkey-path]] 之後，玩家照
`walkthrough.md` 的步驟走到：

```bash
ssh locked-server      # Step 3，成功登入
```

登入成功後，直接在 **locked-server 裡面**接著打 Step 4：

```bash
ssh -f -L 8888:localhost:9090 locked-server -N
# Permission denied (publickey)
curl localhost:8888/flag
# curl: (7) Failed to connect ... Connection refused
```

兩個指令都失敗，玩家以為又是 bug。

## 2. 根因

`-L 8888:localhost:9090 locked-server -N` 的意思是「**從目前這台機器**
對 `locked-server` 建立 SSH 連線，並做 port forward」。Step 3 的
`ssh locked-server` 已經把玩家帶到 locked-server 裡面；如果在
locked-server 裡再對 `locked-server`（=自己）發起 SSH：

- locked-server 上沒有 room4 那把私鑰、也沒有
  `~/.ssh/config` 裡 `Host locked-server -> HostName locked-server`
  的設定 → `ssh ... locked-server` 變成「locked-server 連到自己」，
  公鑰認證找不到對應私鑰 → `Permission denied (publickey)`
- tunnel 沒建立成功，`curl localhost:8888` 自然
  `Connection refused`

這不是程式/設定的 bug，是 **walkthrough 的步驟排版讓 Step 3 → Step 4
看起來像「登入後接著打」**，沒有提示玩家 Step 4 要退回 room4 執行。

## 3. 修復

`walkthrough.md` Room 4 的 Step 3/4：

- Step 3 在 `ssh locked-server` 後加上 `exit`，提示先退回 room4
- Step 4 加註解說明 `-L` 的發起方必須是 room4（私鑰 + `~/.ssh/config`
  都在 room4），並解釋「在 locked-server 裡對自己 ssh」會得到的兩個
  錯誤訊息分別對應什麼原因

## 4. 修改檔案清單

| 檔案 | 變更 |
|---|---|
| `walkthrough.md` | Room 4 Step 3 加 `exit`；Step 4 加上「必須在 room4 執行」的說明與錯誤訊息解讀 |
