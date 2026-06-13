# Falco smoke test：`docker exec <room> bash -c "..."` 產生的事件，container context 大多解析不到（已知限制，未修復）

> **日期：** 2026-06-13

## 1. 緣由

完成 [[falco-startup-config-bugs]] 三個啟動問題的修復後，Falco
（`falcosecurity/falco-no-driver:latest`，0.39.2，`engine.kind:
modern_ebpf`）已能穩定運作並輸出 JSON 告警。為驗證 `falco/README.md`
第 2 節「Scenario ↔ Falco 規則對照表」的規則是否真的會在實際攻擊流程中
觸發，依序執行了：

- `lab/exploits/room6.sh`、`lab/exploits/secret-b.sh`（完整 exploit
  腳本，內部透過 `lib/common.sh` 的 `room_exec` 以
  `docker exec <container> bash -c "<cmd>"` 模式操作房間）
- 人工指令：`docker exec -u player room6 docker ps`、
  `docker exec -u player room6 cat /var/run/docker.sock`、以及在
  room7 對 `/tmp/probe.tar` 做 `tar`/`grep` 的探測指令

同時用 `docker logs -f escape-falco` 即時 tail 並收集 JSON 輸出
（`falco_dump.jsonl`、`falco_live.jsonl`、`falco_live2.jsonl`，皆為
本次 smoke test 的暫存分析檔，未納入版本控制）。

**結果**：對照表中標記給 room6/room7/room9/final/secret-a/secret-b 的多條
規則——`Docker Socket Accessed From Container`、
`Docker Save Or History Executed`、`Tar Extraction Into Tmp Directory`、
`Recursive Grep Under Tmp` 等——在上述操作期間**完全沒有觸發**，即使
對應的指令本身確認執行成功（例如 `docker ps` 正常列出 4 個 container、
`cat /var/run/docker.sock` 正常讀到 socket 檔案的 `srw-rw----` 屬性）。

## 2. 觀察與根因（假設）

對收集到的 JSON 告警逐筆檢查 `container.id`／`container.name` 欄位，
發現：

- 絕大多數告警（包含「DAC Read Search Capability Used」、「Drop and
  execute new binary in container」等高頻背景雜訊）的
  `container.id`／`container.name` 都是 `null`，或是一個不屬於任何
  top-level room container 的 ID `1085f6199000`（後續確認為 room8
  內層 DinD daemon 的內部 container，host 端 `docker ps -a` 看不到）。
- **唯一例外**：default 規則「Terminal shell in container」在 room6/
  secret-b 的測試期間各觸發一次，且 `container.id` 正確帶出
  **真實值**——`secret-b` = `3588c38b871e`、`room6` = `4b3766ec8d4d`
  （以 `docker inspect <name> --format '{{.Id}}'` 核對一致），對應
  `proc.name=bash pname=containerd-shim cmd="bash --login"`。這組
  `proc`/`pname`/`cmd` 特徵符合 terminal-gateway 對玩家開啟的**長駐**
  互動式 `docker exec -it <room> bash` session，而非本次測試指令本身。

由以上兩點推斷的根因假設：

> Falco 的 container enrichment（把 syscall 事件對應到
> `container.id`/`container.name`）對**長駐**的 process（Falco 啟動時
> 該 process 已存在於 container 的 cgroup 中）能正常運作；但對
> `docker exec <container> <cmd>` 產生的**短命**子行程，在 Docker
> Desktop（WSL2 VM）+ modern eBPF 驅動的組合下，enrichment 來不及完成
> 或無法完成，導致 `container.id` 解析為 `null`。

凡是 condition 中包含 `container`（即 macro `container.id != host`）
的規則，在 `container.id` 為 `null` 時，這個 macro 為 false，**規則
整體不成立**——即使對應的 `connect`/`open`/`execve` 等 syscall 事件
本身確實發生且被 Falco 看到了（背景雜訊規則的大量輸出證明 Falco 確實
在持續攔截這些短命行程的 syscall，只是 enrichment 沒附上正確的
container 資訊）。

`lab/exploits/*.sh` 全部 15 支腳本透過 `lib/common.sh` 的 `room_exec`
一律採用 `docker exec <container> bash -c "<cmd>"` 模式，因此**對照表中
所有依賴 `container` macro 的規則，在目前的 exploit 自動化流程下都不會
觸發**——這不是規則命名或對照錯誤，而是 container context 解析本身的
環境限制。

## 3. 額外發現：`Unexpected Child Process In Container Via Docker Exec` 的獨立邏輯缺口

即使上述 container context 問題解決，這條規則仍有第二個獨立問題。
condition（`falco/rules/lab_rules.yaml`）：

```yaml
condition: >
  spawned_process and container and
  proc.pname in (containerd-shim, runc) and
  not proc.name in (bash, sh)
```

`docker exec <container> bash -c "<cmd>"` 模式下，直接被
`containerd-shim`/`runc` spawn 的行程是 `bash`（執行
`bash -c "<cmd>"`），而 `<cmd>` 裡真正的指令（`tar`、`grep`、`docker`
等）的 `pname` 是 `bash`，不是 `containerd-shim`/`runc`。因此
`not proc.name in (bash, sh)` 這個排除條件，**把所有 15 支 exploit 腳本
共用的呼叫模式都排除在外**，使這條規則對「外部 `docker exec` 注入」這個
它原本要偵測的場景實質上永遠不會命中。

## 4. 影響範圍（smoke test 期間未觸發的規則）

| 規則 | 對應 scenario | 涉及問題 |
|---|---|---|
| `Docker Socket Accessed From Container` | room6/7/9/final/secret-a | container context（第 2 節） |
| `Docker Save Or History Executed` | secret-b | container context（第 2 節） |
| `Tar Extraction Into Tmp Directory` | secret-b | container context（第 2 節） |
| `Recursive Grep Under Tmp` | secret-b | container context（第 2 節） |
| `Unexpected Child Process In Container Via Docker Exec` | room6/7/final | container context + bash 排除（第 2、3 節，雙重問題） |

## 5. 目前狀態：未修復，列為後續工作

本次 smoke test 的目的是驗證現有 Falco 部署與規則設定，找出問題範圍，
**不在本次 session 內修復**。根因屬於 Docker Desktop / WSL2 + modern
eBPF 驅動的環境限制，修復成本與風險（例如改用 `proc.pid` 搭配 host 端
`docker top` 結果做事後關聯，繞過 Falco 自身的 `container.id`）較高，
需要更完整的設計討論。

**建議後續方向**：

1. 在 Raspberry Pi（真實 Linux，可能改用 kernel module 驅動）上重跑本
   smoke test，確認是否為 Docker Desktop/WSL2 特有的問題。
2. 若 lab-api 需要把 Falco 告警與「目前正在跑哪個房間的 exploit」做關聯，
   考慮不依賴 `container.id`，改用時間窗口 + `proc.pid`/`proc.vpid` 對照
   `docker top <room>` 的結果。
3. 修訂 `Unexpected Child Process In Container Via Docker Exec` 的
   `not proc.name in (bash, sh)` 排除條件（第 3 節），但需注意放寬後
   可能大幅增加誤報（一般互動式 shell 也會符合 `pname=containerd-shim
   proc.name=bash`）。

## 6. 修改檔案清單

本次純粹是發現與記錄，**沒有程式碼修改**。`falco/README.md` 第 4 節
已加入對應的 smoke test 結果摘要與本文件的連結。

## 7. 相關問題

- 與 [[falco-startup-config-bugs]] 同屬本次 falco smoke test 的產出，
  但前者是「Falco 啟動不起來」的阻擋性問題（已修復），這篇是「Falco
  跑起來之後，規則沒有如預期觸發」的環境限制（未修復）。
