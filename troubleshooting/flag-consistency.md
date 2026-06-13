# FLAG 一致性問題排查報告

> **日期：** 2026-06-11

> 對應 `roadmap.md` 任務 2.2「FLAG 一致性檢查腳本」。
> 工具：[`scripts/verify-flags.sh`](scripts/verify-flags.sh)

## 1. 緣由

每個房間的 FLAG 理論上都是依同一條公式，由 `.env` 的 `FLAG_SEED` 在 **runtime** 動態算出：

```
EscapeDocker{ sha256("${FLAG_SEED}-<roomId>")[:16] }
```

`scoreboard-api/flags.py` 用這條公式計算「正確答案」來驗證玩家提交的 FLAG。
但各房間 `entrypoint.sh` 是各自獨立撰寫的腳本，理論上算出來的 FLAG 應該與
`flags.py` 一致——**實際上並不一致**。`verify-flags.sh` 第一次執行的結果是
**8 通過 / 7 失敗**，本文件記錄這 7 個失敗背後的根因與修復過程。

## 2. 發現的問題與修復

### 問題 A：`locked-server`（room4）完全沒有讀到 `FLAG_SEED`

`docker-compose.yml` 裡 `locked-server` 這個 service **沒有 `environment:` 區塊**，
而 `flag_server.py` 是用：

```python
seed = os.environ.get("FLAG_SEED", "escape_docker_dev_seed")
```

容器內 `FLAG_SEED` 永遠是空的，所以永遠 fallback 成預設 seed
`escape_docker_dev_seed`，跟 `.env` 目前設定的 `escape_docker_2024_change_me`
完全對不上。

**修復**：在 `docker-compose.yml` 的 `locked-server` 補上

```yaml
environment:
  - FLAG_SEED=${FLAG_SEED:-escape_docker_dev_seed}
```

並 `docker compose up -d --force-recreate locked-server`。

---

### 問題 B：`echo` 少了 `-n`，FLAG 多算進一個換行符

`flags.py` 用 Python f-string（不含換行）算 hash：

```python
hashlib.sha256(f"{seed}-{suffix}".encode()).hexdigest()[:16]
```

但 room0 / room1 / room2 / room11 的 `entrypoint.sh` 與
`docker-compose.yml` 裡 `vault`（final flag）的指令，全都寫成：

```bash
FLAG=$(echo "${FLAG_SEED}-room0" | sha256sum | cut -c1-16)
```

`echo`（沒加 `-n`）會在字串結尾多一個 `\n`，等於對
`"${FLAG_SEED}-room0\n"` 取雜湊——**算出來的 FLAG 跟 `flags.py` 不同**。

**結果就是：玩家在房間裡找到的 FLAG 是「錯的」，拿去 `/api/submit` 一定會被
判定錯誤**，是會直接擋住關卡進度的嚴重 bug。

實際驗證範例（seed = `escape_docker_2024_change_me`）：

| 房間 | `echo`（含換行，房間裡實際顯示的） | `echo -n`（`flags.py` 認定的正確答案） |
|---|---|---|
| room0 | `6e8a4139736dcd74` | `893cf8840fa54da6` |
| room1 | `fde03374502674e6` | `0378b0376026196d` |
| final | `7f7fca47b7cba151` | `e78307053fd95ca8` |

**修復**：把這 5 處的 `echo "..."` 全部改成 `echo -n "..."`，
然後 `docker compose up -d --build room0 room1` +
`docker compose up -d --force-recreate vault`（room2/room11 一併在問題 C 重建）。

---

### 問題 C：room2 / room10 / room11 的 FLAG 檔案根本沒被建立

這是三個房間最隱蔽的 bug：`docker exec` 進去看起來一切正常（`player` 可以
登入、看得到任務說明），但 FLAG 檔案**從來沒有被寫出來過**。

**根因**：這三個房間的 `Dockerfile` 在 `ENTRYPOINT` 之前就執行了
`USER player`，導致 `entrypoint.sh`（PID 1）是以 **非 root 的 `player`
身份**執行。但腳本裡卻要：

- room2：寫入 `/secret/flag.txt`（目錄在 build 階段建立為 `root:root, 0700`）
- room10：`python3 /generate_logs.py` 寫入 `/var/log/*.log`（`/var/log`
  是 `root:root, 0755`，player 沒有寫入權限）
- room11：寫入 `/secret/data`，並設定 `/etc/cron.d/encrypt_job` + 啟動
  `cron daemon`（同樣需要 root）

`player` 對這些路徑都沒有寫入權限，且腳本沒有 `set -e`，所以這些指令
**靜默失敗**，container 仍正常啟動，但：

- room2 的 `/secret/flag.txt`、room11 的 `/secret/data` → 檔案不存在
- room10 的 `/var/log/auth.log`、`nginx.log`、`app.log` → 三個檔案都不存在

也就是說，**這三關在修復前是無解的**——FLAG 根本不存在於容器裡的任何地方。

**修復**：
1. 移除這三個 `Dockerfile` 裡 `ENTRYPOINT` 之前的 `USER player`，
   讓 `entrypoint.sh` 以 **root** 執行，完成 FLAG 寫入 / `chmod 400` /
   `chown root:root` / 啟動 cron 等需要 root 權限的操作。
2. 在 `entrypoint.sh` 結尾把 `exec "$@"` 改成 `exec su - player`，
   設定完成後切回 `player` 身份再進入互動 shell（玩家依然是無權限的
   `player`，看到的環境跟修復前完全一樣，只是 FLAG 檔案這次真的存在）。
3. 因為 image 預設使用者變成 root，`terminal-gateway/docker-exec.js` 原本
   `docker exec -it <container> bash`（依賴 image 預設使用者）會讓玩家
   變成 root shell，**必須補上 `-u player`**：
   ```js
   pty.spawn('docker', ['exec', '-it', '-u', 'player', container, 'bash'], ...)
   ```
4. Rebuild：`docker compose up -d --build room2 room10 room11 terminal-gateway`

修復後驗證：
- `docker exec room2 whoami` → `root`（image 預設）
- `docker exec -u player room2 whoami` → `player`（玩家連進終端機看到的身份，與修復前一致）
- `docker exec -u player room2 cat /secret/flag.txt` → `Permission denied`（符合題目設計）
- `docker exec -u root room2 cat /secret/flag.txt` → 正確 FLAG
- room10 的三個 log 檔已正確生成且 `player` 可讀

---

### 問題 D：`verify-flags.sh` 在 Windows Git Bash 下的路徑轉換 bug

開發過程中發現腳本對 room0 / room2 / room10 / room11 都回報
「`<無法取得，容器可能未啟動>`」，但容器其實是 running 的。

**根因**：Git Bash（MSYS）會把獨立出現的絕對路徑參數（例如 `/etc/motd`）
自動轉成 Windows 路徑（`C:/Program Files/Git/etc/motd`）才傳給
`docker.exe`，導致容器內找不到該路徑。

**修復**：在 `verify-flags.sh` 開頭加上

```bash
export MSYS_NO_PATHCONV=1
```

關閉這個自動轉換行為（只影響獨立的絕對路徑參數，包在 `sh -c '...'` 或
`python3 -c "..."` 字串裡的路徑本來就不受影響）。

## 3. 最終結果

修復上述 A～D 後，重新執行 `bash scripts/verify-flags.sh`：

```
=== Escape Docker FLAG 一致性檢查 ===
✅ room0   ✅ room1   ✅ room2   ✅ room3
✅ room4   ✅ room5   ✅ room6   ✅ room7
✅ room8   ✅ room9   ✅ room10  ✅ room11
✅ final   ✅ secret-a ✅ secret-b

=== 結果：15 通過 / 0 失敗 ===
```

## 4. 修改檔案清單

| 檔案 | 變更 |
|---|---|
| `scripts/verify-flags.sh`（新增） | FLAG 一致性檢查腳本，含 `MSYS_NO_PATHCONV=1` |
| `docker-compose.yml` | `locked-server` 補 `FLAG_SEED`；`vault` 的 `echo` → `echo -n` |
| `rooms/room0/entrypoint.sh` | `echo` → `echo -n` |
| `rooms/room1/entrypoint.sh` | `echo` → `echo -n` |
| `rooms/room2/entrypoint.sh` | `echo` → `echo -n`；結尾改 `exec su - player` |
| `rooms/room2/Dockerfile` | 移除 `ENTRYPOINT` 前的 `USER player` |
| `rooms/room10/entrypoint.sh` | 結尾改 `exec su - player` |
| `rooms/room10/Dockerfile` | 移除 `ENTRYPOINT` 前的 `USER player` |
| `rooms/room11/entrypoint.sh` | `echo` → `echo -n`；結尾改 `exec su - player` |
| `rooms/room11/Dockerfile` | 移除 `ENTRYPOINT` 前的 `USER player` |
| `terminal-gateway/docker-exec.js` | `docker exec` 補上 `-u player` |

## 5. 待手動確認

room2 的提權解謎流程（`sudo -l` → 利用 `backup.sh` 的引號漏洞讀出
`/secret/flag.txt`）相關設定（`sudoers`、`backup.sh`）本次**沒有變動**，
理論上不受影響，但建議實際在網頁上玩一次 room2 完整流程做最終確認。
