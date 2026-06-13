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
