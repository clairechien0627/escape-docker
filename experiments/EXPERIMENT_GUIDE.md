# 實驗教學：room-manager 資源節省效果驗證

這份文件是給你照著一步步操作的詳細教學，目標是產出一張圖，證明「room-manager 動態啟停房間」
比「26 個服務全部常駐運行」更省資源。

---

## 0. 這個實驗在做什麼？

簡單說：

- **模式 A（Baseline）**：模擬「沒有 room-manager」的情況——所有房間 container 一直開著，不管有沒有人玩
- **模式 B（Dynamic）**：room-manager 正常運作——沒人用的房間會被自動關閉（stop），有人進入時才喚醒

兩種模式下，我們都用 `docker stats` 每隔幾秒記錄一次「目前所有房間 container 加起來吃了多少 CPU/記憶體」，
存成 CSV，最後畫成折線圖，比較兩條線的差異。

**預期結果**：模式 B 的資源使用曲線會在「沒人用」的時段明顯低於模式 A，因為房間都被關掉了；
而當你進入房間時，曲線會短暫回升（喚醒房間），之後又因為其他房間持續閒置而維持低點。

---

## 1. 前置準備

1. 確認 Docker Desktop 已啟動，並且專案可以正常 `docker compose up`
2. 安裝 Python 套件：

   ```bash
   pip install -r experiments/requirements.txt
   ```

3. 找到專案的 `.env` 檔案（沒有的話從 `.env.example` 複製一份）：

   ```bash
   cp .env.example .env   # 如果還沒有 .env
   ```

4. 用編輯器打開 `.env`，找到這兩行（如果沒有就自己加上去）：

   ```
   ROOM_STOP_IDLE_MINUTES=10
   ROOM_RESET_IDLE_MINUTES=60
   ```

   這兩個值控制 room-manager 多久沒人用就把房間關掉/重置。實驗中我們會分別把它們調成
   「超大」（模式 A，等於關閉自動停止功能）和「很小」（模式 B，方便短時間內看到效果）。

---

## 2. 模式 A：Baseline（全部常駐）

**目的**：建立一個「room-manager 不介入」的對照組。

### 2.1 修改 `.env`

把 `ROOM_STOP_IDLE_MINUTES` 改成一個非常大的數字，讓 room-manager 永遠不會自動關閉房間：

```
ROOM_STOP_IDLE_MINUTES=99999
ROOM_RESET_IDLE_MINUTES=999999
```

### 2.2 啟動所有服務

```bash
docker compose up -d --build
```

等待約 30 秒～1 分鐘，讓所有 container 都進入 `running` 狀態。可以用以下指令確認：

```bash
docker compose ps
```

確認 `room0` ~ `room11`、`final`、`secret-a`、`secret-b`、`locked-server`、`secret-server`
這 17 個都是 `Up` / `running`。

### 2.3 開始記錄資源使用

**這個階段請不要操作任何房間**（不要開瀏覽器進去玩），讓系統保持 idle 狀態。

```bash
python experiments/monitor_resources.py experiments/baseline.csv --interval 5 --duration 300
```

- `--interval 5`：每 5 秒記錄一次
- `--duration 300`：總共記錄 300 秒（5 分鐘）

跑完之後你會得到 `experiments/baseline.csv`。

> 因為這是 baseline，理論上整條線應該幾乎是一條平線（17 個房間全程 running，資源用量穩定）。

---

## 3. 模式 B：Dynamic（room-manager 動態調度）

**目的**：實際展示 room-manager 的自動 stop / 自動喚醒效果。

### 3.1 修改 `.env`

把閒置閾值改小，讓 room-manager 在幾十秒內就會把沒人用的房間關掉：

```
ROOM_STOP_IDLE_MINUTES=1
ROOM_RESET_IDLE_MINUTES=5
```

> 注意：`ROOM_RESET_IDLE_MINUTES` 必須大於 `ROOM_STOP_IDLE_MINUTES`，否則 room-manager 會啟動失敗
> （這是程式內建的檢查）。

### 3.2 重啟 room-manager 套用新設定

```bash
docker compose up -d --build room-manager
```

> 因為一開始所有房間都還是 `running`（從模式 A 延續下來），room-manager 啟動後最多等
> `ROOM_STOP_IDLE_MINUTES`（這裡是 1 分鐘）就會開始把它們一個個 stop。

### 3.3 開始記錄資源使用

```bash
python experiments/monitor_resources.py experiments/dynamic.csv --interval 5 --duration 600
```

這次記錄 10 分鐘（600 秒），分成兩段操作：

**第 0~120 秒：什麼都不做**
- 觀察 `docker compose ps`，你應該會看到房間陸續從 `Up` 變成 `Exited`（被 room-manager stop 了）
- 對應到 CSV 裡，這些房間的 `state` 會從 `running` 變成 `stopped`，CPU/記憶體歸零

**第 120 秒之後：進入 2-3 個房間**
- 打開瀏覽器，到 `map.html` 點選 2-3 個原本已經被關閉的房間（例如 `room0`、`room1`）
- 觀察畫面：應該會看到「正在啟動房間環境，請稍候」的覆蓋層，幾秒後 terminal 才能輸入
- 對應到 CSV 裡，你會看到：
  - 這些房間的 `state` 從 `stopped` 變回 `running`
  - 對應時間點 `cpu_percent` 會有一個短暫的尖峰（container 啟動瞬間的開銷）

記錄結束後，你會得到 `experiments/dynamic.csv`。

---

## 4. 畫圖

```bash
python experiments/plot_resources.py \
  experiments/baseline.csv experiments/dynamic.csv \
  --labels "Baseline (always-on)" "Dynamic (room-manager)" \
  -o experiments/resource_comparison.png
```

打開 `experiments/resource_comparison.png`，你會看到三張上下排列的子圖：

| 子圖 | Y 軸 | 你應該看到什麼 |
|------|------|----------------|
| 圖 1 | 總 CPU 使用率 (%) | Dynamic 線在 idle 時應低於 Baseline；進入房間時會有尖峰 |
| 圖 2 | 總記憶體用量 (MB) | Dynamic 線在房間被 stop 後應明顯下降，Baseline 維持穩定 |
| 圖 3 | running 容器數量 | Baseline 全程 17；Dynamic 在 ~1-2 分鐘後降到接近 0，進房後局部回升 |

---

## 5. 量化節省比例（選用）

如果想要一個具體的數字放進報告，可以用 Python 算「平均記憶體用量」的差異：

```python
import pandas as pd

def avg_mem(csv_path):
    df = pd.read_csv(csv_path)
    return df.groupby("timestamp")["mem_usage_mb"].sum().mean()

baseline = avg_mem("experiments/baseline.csv")
dynamic = avg_mem("experiments/dynamic.csv")

saving = (baseline - dynamic) / baseline * 100
print(f"Baseline 平均總記憶體：{baseline:.1f} MB")
print(f"Dynamic 平均總記憶體：{dynamic:.1f} MB")
print(f"節省比例：{saving:.1f}%")
```

---

## 6. 實驗結束後：恢復正常設定

把 `.env` 改回正式 demo 用的合理值，例如：

```
ROOM_STOP_IDLE_MINUTES=10
ROOM_RESET_IDLE_MINUTES=60
```

再 `docker compose up -d --build room-manager` 套用。

---

## 7. 常見問題

**Q: `monitor_resources.py` 跑出來 CSV 裡所有房間都是 `stopped`、數值全是 0？**
A: 確認 `docker compose ps` 裡這些 container 真的有在跑；也確認你是在有權限執行 `docker` 指令的終端機裡跑腳本。

**Q: 模式 B 房間一直沒有被 stop？**
A: 檢查 `.env` 是否真的套用了（`docker compose up -d --build room-manager` 之後可以用
`docker logs room-manager` 確認啟動訊息裡的 idle 閾值是否正確）。

**Q: 進入房間後資源沒有回升？**
A: 確認瀏覽器有成功連上 terminal（覆蓋層消失、可以打字）。如果 `ensure` 失敗，房間不會被啟動。
