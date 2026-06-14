# 兩波房間容器 mass OOM-kill：Falco 累積告警洪水 + 重啟 eBPF probe 都會觸發 host 記憶體壓力

> **日期：** 2026-06-15

## 1. 緣由

完成 15 個場景的 Baseline（`POST /api/lab/baseline-runs`，each 20s）批次
執行（[[run-all-baselines.js 暫存腳本]]，已刪除）後，例行檢查
`docker ps -a` 時發現：

- **第一波**：全部 15 個房間容器（room0-room11）以及
  `secret-a`/`secret-b`/`final`/`locked-server`/`secret-server` 皆顯示
  `Exited (137)`，`docker inspect` 顯示 `OOMKilled: false`、容器本身
  `mem_limit` 為 `0`（無限制）。

用 `docker compose up -d` 恢復後，為了排查另一個問題（room1 攻擊腳本
變異測試，見 [[room1-mutation-test-falco-alert-lag]]——尚待補充）執行了
`docker restart escape-falco`。重啟後約 2 分鐘：

- **第二波**：`room1`/`room5`/`room7` 顯示 `Exited (137)`，
  `room10`/`room11` 顯示 `Exited (143)`；其餘容器（包含
  `secret-a/b`、`final`、`locked-server`、`secret-server`、
  `room0/2/3/4/6/8/9`）維持 `Up`。

兩波都不是「程式碼 bug」造成容器自身 crash——`docker logs <room>`
沒有應用程式錯誤，純粹是被外部訊號（137 = SIGKILL，143 = SIGTERM）
終止。

## 2. 根因

### 2.1 Falco 告警處理嚴重積壓（約 37 分鐘延遲、14 萬筆日誌）

排查時發現 `escape-falco`（已連續運行 7 小時）的 `docker logs` 總行數高達
**141,820 行**。比對「dockerd 寫入該行的時間」（`docker logs --timestamps`
的前綴）與「該行 JSON 內 Falco 自己記錄的事件時間 `time` 欄位」：

```
docker 寫入時間 2026-06-14T16:09:04Z
↔ 該行 output_fields.time  2026-06-14T15:31:51Z   （落後 ~37 分鐘）
```

`docker exec escape-falco date -u` 與 host `date -u` 完全一致
（無時鐘飄移），證實這不是時區/時鐘問題，而是 **Falco 的事件處理/輸出
管線本身有約 37 分鐘的積壓**，且消化速度極慢（觀察 20 秒內，積壓只縮短
約 10 秒，換算需 70+ 分鐘才能清空）。

`docker restart escape-falco` 印出的關閉統計證實積壓內容的組成：

```
Ptrace Attach To Other Process: 121525
Unexpected Child Process In Container Via Docker Exec: 1614
Docker Socket Accessed From Container: 808
Cron Spawned Root Process: 228
...（其餘規則均為個位數~數百筆）
```

`Ptrace Attach To Other Process` 高達 **121,525 筆**，是總量
141,820 行的絕大多數。對照
[[strace-ground-truth-pilot.md]] 的記錄：room6 的 `step_traced`
（4 個步驟，每步驟用 `strace -f` 包裝）單次執行即可產生
**最多 8857 筆** `Ptrace Attach To Other Process`；這些
`Ptrace` 規則為 `Informational`/`Notice` 等級，Falco 仍會逐筆輸出 JSON
到 stdout。在 Falco 7 小時運行期間，多次對 room6 的 exploit/baseline
執行（含本次「執行全部場景 (15)」批次）累積出 12 萬+ 筆，遠超 Falco
userspace 輸出 pipeline 的處理速率，形成持續增長的積壓。

**對 RQ2 量測方法的連帶影響**：`lab-api`/手動排查常用
`docker logs escape-falco --since "<時間點>"` 依「dockerd 寫入時間」
過濾告警，但告警內容的 `time`（事件實際發生時間）落後 37 分鐘——
於是「since 某時間點之後寫入的行」可能包含 `time` 早於該時間點的
**陳舊告警**。實測案例：對 room1 執行「recon 改用 `ls`/glob 取代
`find`」的變異測試時，`--since "2026-06-14T16:05:26Z"` 抓到一筆
`Recursive Find Under Archive Directory`（`proc.cmdline:
"find /home/player/archive -name *.encoded"`，`time:
"2026-06-14T15:28:26Z"`）——這是 15:28 時（更早的批次執行）真正執行過
的**未變異** `find` 指令的陳舊告警，並非本次變異後的 `ls`/glob 指令
觸發。這延伸了
[[falco-container-context-not-resolved.md]] 第 8.2 節已知的「`run.alerts`
以時間窗口而非 container 關聯」限制：**當 Falco 有處理積壓時，時間窗口
本身也會把陳舊告警錯誤歸因到當前時間窗口**。

### 2.2 房間容器無記憶體限制，成為 host 記憶體壓力下的 OOM 受害者

`docker-compose.yml` 的 `x-room-defaults` 沒有設定
`mem_limit`/`deploy.resources.limits.memory`，所有 15 個房間 +
`secret-a/b`/`final`/`locked-server`/`secret-server` 皆無記憶體上限。
`docker stats escape-falco --no-stream` 顯示 Falco 本身僅用
**91.84MiB / 7.368GiB（1.22%）**，並非記憶體大戶——OOM 受害者是
**沒有設限的房間容器**，而非 Falco 自己。

兩波事件的觸發點不同，但根因一致：

- **第一波**：15×2 場景 Baseline 批次（每場景 20 秒，room8/room9 各產生
  200 筆告警）在短時間內疊加在 Falco 既有的積壓負載上，推高
  Docker Desktop/WSL2 VM 整體記憶體/CPU 使用率，觸發 host 端 OOM-killer。
- **第二波**：`docker restart escape-falco` 讓 Falco 的 modern_eBPF probe
  重新對 **整個 `pid: host`** namespace 的所有行程重新 attach + 為目前
  運行中的 15+ 個 container 重新建立 enrichment 對照表，這個「重新掛載」
  瞬間造成的 CPU/記憶體尖峰，同樣足以觸發 OOM-killer——即使此時 Falco
  自身的 log 積壓已被清空（重啟後新告警延遲降回 ~10 秒）。

兩波受害容器集合不同（第一波 15+5、第二波僅 5 個），與「OOM-killer 依
當下記憶體用量/oom_score 挑選犧牲者，而非固定名單」一致：兩次事件中
`lab-api`/`room-manager`/`terminal-gateway`/`vault`/`escape-nginx` 等
核心服務皆未被殺，房間容器（短命、無限制、且常處於 idle）優先被選中。

## 3. 修復

1. **容器恢復**（兩波皆採用同一指令，皆成功）：
   ```bash
   docker compose up -d
   ```
   會自動重建/啟動所有 `Exited` 的房間容器（`ghost-alpha/beta/gamma/delta`
   設計上本就會 `Exited (0)`，不在恢復範圍內，為正常現象）。

2. **清空 Falco 積壓**：
   ```bash
   docker restart escape-falco
   ```
   重啟後新告警的 `time` 與 dockerd 寫入時間差從 ~37 分鐘降至 ~10 秒
   （驗證見第 4 節）。**注意**：本次操作本身誘發了第二波 OOM-kill，
   重啟後務必再跑一次 `docker compose up -d` 確認房間容器存活。

3. **本次未調整 `docker-compose.yml` 的記憶體限制**——是否要為 15 個房間
   容器加上 `mem_limit`（避免被無差別 OOM-kill，但也可能讓房間容器自己
   先被殺、影響玩家體驗）需要更完整的資源規劃，列為後續工作（見第 5 節）。

## 4. 驗證

- `docker compose up -d`（兩次）後 `docker ps -a`：
  - 第一波恢復後：所有房間 + `secret-a/b`/`final`/`locked-server`/
    `secret-server` 皆 `Up`，僅 `ghost-*` 維持 `Exited (0)`（預期行為）
  - 第二波恢復後（等待 20 秒）：`room1/5/7/10/11` 皆變為 `Up X seconds`，
    其餘維持 `Up`
- `docker restart escape-falco` 後，用 `cat /etc/motd` 觸發一筆新告警，
  `docker logs escape-falco --timestamps --tail 3`：
  ```
  docker 寫入時間 2026-06-14T16:12:41Z
  ↔ output_fields.time      2026-06-14T16:12:31Z   （延遲降至 ~10 秒）
  ```
- 系統穩定後 `docker stats escape-falco --no-stream`：
  `91.84MiB / 7.368GiB（1.22%）`、CPU 1.40%，6 PIDs——Falco 本身資源
  使用正常

## 5. 後續建議（RQ3 相關，未在本次 session 實作）

1. 為 15 個房間 + `secret-*`/`final`/`locked-server`/`secret-server`
   容器加上合理的 `mem_limit`（例如 256-512MB），讓 OOM-killer 的影響
   範圍可預期，並避免單一房間吃光 host 記憶體影響其他房間
2. 評估是否該為 `room6` 的 `step_traced`（strace ground-truth pilot）
   加上 `Ptrace` 規則的 rate-limit 或 Falco
   side-effect（例如 `-o stdout_output.rate=...`），避免長時間運行後
   累積成數十萬筆積壓
3. **避免在非必要時重啟 `escape-falco`**——重啟本身（eBPF probe
   重新 attach `pid: host`）就是一次資源尖峰，本次直接造成第二波
   OOM-kill；若未來需要清積壓，建議改為「降低告警量的根因」（第 5.2
   點）而非定期重啟

## 6. 修改檔案清單

本次純粹是發現、排查與操作層級修復（`docker compose up -d` +
`docker restart escape-falco`），**沒有程式碼或設定檔變更**。

## 7. 相關問題

- [[falco-container-context-not-resolved.md]] 第 8.2 節：`run.alerts`
  以時間窗口（而非 container）關聯告警的已知限制——本文件第 2.1 節是
  該限制在「Falco 有處理積壓」情境下的延伸案例
- [[strace-ground-truth-pilot.md]]：room6 `step_traced` 觸發的
  `Ptrace Attach To Other Process` 告警量（單次最高 8857 筆）是本次
  141,820 行積壓的主要組成
