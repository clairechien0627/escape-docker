# Room 3 walkthrough.md 解題步驟誤導，導致玩家卡關

> **日期：** 2026-06-13

## 1. 緣由

玩家照 `walkthrough.md` 的 Room 3 步驟操作：

```
ps aux               # 找到 PID 8 = python3 /flag_daemon.py
kill -USR1 8         # 文件說「終端機輸出會出現 ... FLAG: ...」
strace -p 8 2>&1 | head -20   # 進階解法
```

結果終端機完全沒有出現 FLAG，`strace` 也只看到週期性的
`[flag_daemon] Status OK (pid=8)`，玩家以為 room3 解不開、或
`kill` 之後程序就「結束」了。

## 2. 根因

`rooms/room3/flag_daemon.py` 收到 `SIGUSR1` 時：

```python
def on_usr1(sig, frame):
    print(f"\n[flag_daemon] SIGUSR1 received! FLAG: {flag}", flush=True)
```

這個 `print()` 寫到的是 **flag_daemon.py 自己的 stdout（fd 1）**——
由 `entrypoint.sh` 用 `python3 /flag_daemon.py &` 啟動，繼承的是
**container 主 process 的 stdout**（對應 host 端的 `docker logs
room3`），**不是**玩家透過 `docker exec -it room3 bash` 開出來的這個
pty。一般玩家沒有 host 權限執行 `docker logs`，所以單純
`kill -USR1 <PID>` 在玩家的終端機裡什麼都不會顯示——這是 by design
（題目本來就要玩家用 `strace` 截 syscall 引數，而不是看標準輸出），
但 walkthrough 卻寫成「終端機輸出會出現 FLAG」，誤導玩家。

第二個問題：`SIGUSR1` 的 handler 是**同步、立即**執行的——signal
送達後 `write()` 馬上發生並結束。walkthrough 的指令順序是
`kill -USR1 <PID>` 在前、`strace -p <PID>` 在後，等 `strace` attach
上去時，那次 `write()` 早就結束了，只能看到之後的
`Status OK` 訊息。

第三個問題：`strace -p <PID> 2>&1 | head -20`（沒有 `-e write -s 200`）
即使順序對了，預設字串也只顯示前 32 個字元，FLAG 會被截斷成
`"\n[flag_daemon] SIGUSR1 received!"...`，看不到完整 FLAG。

## 3. 驗證（在 room3 容器內以 player 身分實測）

```bash
pid=$(ps aux | awk '/python3 \/flag_daemon.py/ {print $2; exit}')
strace -p "$pid" -e write -s 200 &   # 先 attach（daemon 在 pselect6 裡 sleep，attach 只要幾毫秒）
kill -USR1 "$pid"                    # 再送訊號
```

輸出：

```
strace: Process 8 attached
--- SIGUSR1 {si_signo=SIGUSR1, si_code=SI_USER, si_pid=55, si_uid=1000} ---
write(1, "\n[flag_daemon] SIGUSR1 received! FLAG: EscapeDocker{541aeb0b53606cce}", 69) = 69
write(1, "\n", 1)                       = 1
strace: Process 8 detached
```

FLAG 出現在 `strace` 截獲的 `write()` 引數裡，與 fd 1 實際指向哪裡
無關——這正是題目設計的「signal-based information disclosure」解法
（與 `lab/exploits/room3.sh` 的攻擊鏈邏輯一致，只是該腳本因為有 host
權限，改用 `docker logs` 驗證；玩家走的是 `strace` 這條路）。

## 4. 修復

重寫 `walkthrough.md` 的 Room 3 章節：

- 「解題步驟」的 Step 3 改為「先背景 attach `strace -p <PID> -e write
  -s 200 &`，再 `kill -USR1 <PID>`」，並把預期輸出改成 `strace` 的
  `write()` 那一行（而不是「終端機輸出會出現 FLAG」）
- 移除「進階解法」裡順序錯誤、缺少 `-e write -s 200` 的 strace 範例
- 「注意事項」新增三點：(1) 解釋 daemon 的輸出去向是 container 主
  process 的 stdout / `docker logs`，玩家終端機看不到；(2) 強調
  attach strace 必須在 `kill -USR1` 之前；(3) 強調 `-s 200` 避免字串
  截斷

## 5. 修改檔案清單

| 檔案 | 變更 |
|---|---|
| `walkthrough.md` | Room 3 章節：解題步驟、進階解法、注意事項全面修正（見上） |

## 6. 待手動確認

- `rooms/room3/flag_daemon.py` 本身**不需要修改**——題目設計（FLAG 只
  在 `write()` syscall 引數中短暫出現，需要 `strace` 才能截獲）是
  intentional 的，問題完全在文件描述錯誤。
