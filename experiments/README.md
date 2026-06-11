# 資源使用量對照實驗

比較「全部房間常駐運行（baseline）」與「room-manager 動態調度（dynamic）」兩種模式下，
17 個房間相關 container（`room0`~`room11`、`final`、`secret-a`、`secret-b`、`locked-server`、`secret-server`）的
CPU / 記憶體使用量與 running 容器數量。

## 安裝

```bash
pip install -r experiments/requirements.txt
```

## 步驟

### 模式 A：Baseline（全部常駐）

1. 在 `.env` 把 `ROOM_STOP_IDLE_MINUTES` 設成一個非常大的值（例如 `99999`），讓 room-manager
   不會自動 stop 任何房間。
2. `docker compose up -d --build`，等所有容器都進入 running。
3. 開始記錄（不操作任何房間，建議跑 5-10 分鐘）：

   ```bash
   python experiments/monitor_resources.py experiments/baseline.csv --interval 5 --duration 300
   ```

### 模式 B：Dynamic（room-manager 動態調度）

1. 把 `.env` 的 `ROOM_STOP_IDLE_MINUTES` 改回較小的值（例如 `1`），方便短時間內看到自動 stop。
2. `docker compose up -d --build`（或 `restart room-manager` 套用新設定）。
3. 開始記錄：

   ```bash
   python experiments/monitor_resources.py experiments/dynamic.csv --interval 5 --duration 600
   ```

4. 在記錄期間：
   - 前 1-2 分鐘不操作，等待房間因閒置被自動 stop（觀察 running container 數量下降）。
   - 之後透過瀏覽器（或呼叫 terminal-gateway WebSocket）進入 2-3 個房間，
     觀察 room-manager `ensure` 喚醒房間時的資源回升與冷啟動延遲。

## 畫圖

```bash
python experiments/plot_resources.py \
  experiments/baseline.csv experiments/dynamic.csv \
  --labels "Baseline (always-on)" "Dynamic (room-manager)" \
  -o experiments/resource_comparison.png
```

輸出 `resource_comparison.png` 包含三張子圖（依時間軸對齊）：

1. 總 CPU 使用率（%）
2. 總記憶體使用量（MB）
3. running 容器數量

## CSV 格式

`monitor_resources.py` 輸出為長格式（tidy format），每筆樣本對應一個 container：

| 欄位 | 說明 |
|------|------|
| `timestamp` | UTC ISO8601 時間戳 |
| `container` | 容器名稱 |
| `state` | `running` 或 `stopped` |
| `cpu_percent` | CPU 使用率（`docker stats` 原始值） |
| `mem_usage_mb` | 記憶體用量（MB） |

容器清單自動讀取自 `room-manager/rooms-config.json`，新增/刪除房間時不需修改腳本。
