# Troubleshooting 索引

每篇文件記錄一個 bug 的緣由、根因、修復方式與驗證結果，依日期排序。

## 2026-06-11

- [room-manager-recreate-and-routing.md](room-manager-recreate-and-routing.md) — room-manager recreate 卡住、readiness 永遠 timeout、`/api/rooms/*` 路由錯誤
- [flag-consistency.md](flag-consistency.md) — FLAG 一致性問題排查報告
- [crlf-line-endings.md](crlf-line-endings.md) — CRLF / LF 換行符問題（`.gitattributes`）

## 2026-06-13

- [scoreboard-api-stale-container.md](scoreboard-api-stale-container.md) — scoreboard-api 與前端 API 不一致（container 沒跟著切換 branch 重建）
- [docker-sock-gid-mismatch.md](docker-sock-gid-mismatch.md) — docker.sock gid 不匹配導致 room6/room7/room9/final 對 player 無法使用
- [room5-riddle-syntaxerror.md](room5-riddle-syntaxerror.md) — room5 riddle_server.py SyntaxError
- [room8-challenge-yaml-syntax.md](room8-challenge-yaml-syntax.md) — room8 challenge docker-compose.yml 的 YAML 語法錯誤
- [room3-walkthrough-strace-order.md](room3-walkthrough-strace-order.md) — Room 3 walkthrough.md 解題步驟誤導（strace/signal 順序）
- [room4-unsolvable-no-pubkey-path.md](room4-unsolvable-no-pubkey-path.md) — Room 4 修復前對玩家不可解（無法植入 SSH 公鑰）
- [room4-walkthrough-tunnel-host-confusion.md](room4-walkthrough-tunnel-host-confusion.md) — Room 4 walkthrough.md 沒說明 SSH Tunnel 要在哪台機器執行
- [room6-flag6-missing.md](room6-flag6-missing.md) — Room 6 沒有任何方式可以取得 FLAG6（progression-blocking）
- [rooms-missing-utf8-locale.md](rooms-missing-utf8-locale.md) — 所有房間缺少 UTF-8 locale，導致 vim 顯示中文亂碼
- [room8-no-docker-daemon-unsolvable.md](room8-no-docker-daemon-unsolvable.md) — Room 8 對玩家不可解（無 Docker daemon、challenge 唯讀、walkthrough 與實際檔案不符），改為容器內 DinD
- [xterm-scroll-corruption-and-overflow.md](xterm-scroll-corruption-and-overflow.md) — xterm.js 終端機 WebSocket 重連後疊圖/破圖、滾動失效
- [terminal-gateway-dropped-keystrokes.md](terminal-gateway-dropped-keystrokes.md) — terminal-gateway 把純數字/true/false/null 按鍵誤判為控制訊息並丟棄
- [final-exec-stream-header.md](final-exec-stream-header.md) — Final Boss walkthrough 的 `/exec/{id}/start` 缺少跳過 8 bytes stream header，導致看不到 FLAG
- [walkthrough-echo-missing-n-flag-mismatch.md](walkthrough-echo-missing-n-flag-mismatch.md) — walkthrough.md 用 `echo` 而非 `echo -n` 算 FLAG hash，多了換行字元導致 FLAG 不一致
- [secret-b-image-flag-mismatch-and-walkthrough-confusion.md](secret-b-image-flag-mismatch-and-walkthrough-confusion.md) — Secret Room B 對玩家不可解（image 內建 FLAG 與 scoreboard 不一致 + walkthrough 沒說要在 Room 7 終端機執行）
- [secret-b-oci-layer-format-mismatch.md](secret-b-oci-layer-format-mismatch.md) — Secret Room B walkthrough 的 `find -name "*.tar"` 對現代 Docker 的 OCI 匯出格式找不到任何 layer
- [secret-a-entrypoint-echo-missing-n.md](secret-a-entrypoint-echo-missing-n.md) — Secret Room A entrypoint.sh 用 `echo` 算 `REAL_FLAG`，導致房間主要解法算出錯誤 FLAG
- [room8-dind-stale-pid-restart-loop.md](room8-dind-stale-pid-restart-loop.md) — Room 8 DinD 被 OOM-kill 後以 `docker start` 重啟卡在 `/var/run/docker.pid` 重啟迴圈
- [falco-startup-config-bugs.md](falco-startup-config-bugs.md) — Falco 監控容器首次啟動的 3 個設定/規則問題（--modern-bpf、fd.sip CIDR 語法、engine.kind）
- [falco-container-context-not-resolved.md](falco-container-context-not-resolved.md) — Falco smoke test：`docker exec` 短命子行程的 container context 大多解析不到，導致多條規則未觸發（已知限制，未修復）
