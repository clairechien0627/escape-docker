# Secret Room B：`docker save` 匯出 OCI 格式，walkthrough 的 `find -name "*.tar"` 找不到任何 layer

> **日期：** 2026-06-13

## 1. 緣由

使用者在 Room 7 的終端機（已依
[[secret-b-image-flag-mismatch-and-walkthrough-confusion]] 的修正，在
正確的容器執行）照 `walkthrough.md` Secret Room B 的步驟操作：

```bash
docker history escape-docker-secret-b        # 正常，能看到 history
docker save escape-docker-secret-b > /tmp/secret-b.tar
mkdir -p /tmp/layers
tar xf /tmp/secret-b.tar -C /tmp/layers       # 正常解壓

# Step 4
find /tmp/layers -name "*.tar" | while read layer; do
    tar tf "$layer" 2>/dev/null | grep -i "ghost_layer\|deleted_secret" && ...
done
# → 完全沒有輸出，沒有任何 "Found in: ..."

grep -r "EscapeDocker" /tmp/layers/ 2>/dev/null
# → 找到一行，但內容是 image config 裡的
#   "EscapeDocker{${SECRET}}"（含字面上的 ${SECRET}，不是真正的雜湊值）
```

Step 1-3 都正常，但 Step 4 找不到 FLAG，`grep -r` 找到的也只是一段
看起來像 FLAG 但其實是 Dockerfile 指令原始文字的字串。

## 2. 根因

`walkthrough.md` 的 Step 4 假設 `docker save` 匯出的是**舊版
`docker save` tarball 格式**：頂層有 `repositories` 檔案，每個 layer
是一個目錄 `<layer-id>/layer.tar`。在這種格式下 `find -name "*.tar"`
可以找到所有 layer。

但目前環境的 Docker（BuildKit / containerd image store）匯出的是
**OCI image layout**：

```
/tmp/layers/
├── blobs/sha256/<digest>   ← 每個 layer/config 都是這樣的檔案
├── index.json
├── manifest.json
└── oci-layout
```

`blobs/sha256/<digest>` 這些檔案：
- **檔名是 sha256 digest，沒有 `.tar` 副檔名** → `find -name "*.tar"`
  完全找不到任何檔案，Step 4 的迴圈跑了等於沒跑
- **大部分是 gzip 壓縮過的 tarball**（layer blobs），少數是純
  JSON（image config、manifest）

`grep -r "EscapeDocker" /tmp/layers/` 之所以「找到一個結果」，是因為
image **config blob**（純 JSON，未壓縮）裡的 `history[].created_by`
欄位**逐字記錄了 Dockerfile 的 RUN 指令原始文字**，剛好包含字面上的
字串 `EscapeDocker{${SECRET}}`（`${SECRET}` 是 shell 變數語法，沒有被
展開）。這個字串**長得很像 FLAG，但不是**——它只是 build 指令的
原始碼，會誤導玩家以為已經找到答案。

真正含有 `deleted_secret.txt`（內容是展開後的真實
`EscapeDocker{<hash>}`）的，是某個 **gzip 壓縮的 layer blob**，
`grep -r`（不解壓縮）讀不到裡面的內容。

## 3. 修復

`walkthrough.md` Step 4 改成遍歷 `blobs/sha256/` 底下所有檔案，用
`tar tf` / `tar xf`（GNU tar 對 `-f` 會自動偵測 gzip，不用加 `-z`）：

```bash
cd /tmp/layers/blobs/sha256
for f in *; do
    tar tf "$f" 2>/dev/null | grep -q "ghost_layer\|deleted_secret" && \
    echo "Found in: $f" && \
    tar xf "$f" -O tmp/ghost_layer/deleted_secret.txt 2>/dev/null
done
```

同時移除/說明原本「或更直接 `grep -r "EscapeDocker" /tmp/layers/`」
這個會誤中 config 裡的指令原始文字的捷徑。

`scoreboard-api/flags.py` 的 `secret-b` Level 3 提示（cost 50）原本也
是 `docker save ... | tar x -C /tmp/layers && grep -r 'EscapeDocker'
/tmp/layers`，同樣會誤導玩家，一併改成上述用 `blobs/sha256` + `tar
tf/xf` 的正確流程：

```python
{"level": 3, "cost": 50, "text": "docker save escape-docker-secret-b | tar x -C /tmp/layers && cd /tmp/layers/blobs/sha256 && for f in *; do tar tf \"$f\" 2>/dev/null | grep -q ghost_layer && tar xf \"$f\" -O tmp/ghost_layer/deleted_secret.txt; done"},
```

## 4. 驗證

在使用者已經解壓好的 `/tmp/layers` 上直接執行修正後的 Step 4：

```bash
$ cd /tmp/layers/blobs/sha256
$ for f in *; do tar tf "$f" 2>/dev/null | grep -q ghost_layer && echo "FOUND: $f" && tar xf "$f" -O tmp/ghost_layer/deleted_secret.txt 2>/dev/null; done
FOUND: 3957289bb24d163a8714a5fa7029a5ed80b10403e24a0e0c1c73e5b22bed12b5
EscapeDocker{a7e9cf69eb013b93}
```

`EscapeDocker{a7e9cf69eb013b93}` 與
[[secret-b-image-flag-mismatch-and-walkthrough-confusion]] 中驗證過的
scoreboard 預期值一致。

## 5. 修改檔案清單

| 檔案 | 變更 |
|---|---|
| `walkthrough.md` | Secret Room B Step 4 改用 `blobs/sha256/*` + `tar tf/xf` 遍歷，移除誤導性的 `grep -r "EscapeDocker" /tmp/layers/` 捷徑，並加註解說明 OCI 格式與 config 裡的紅鯡魚字串 |
| `scoreboard-api/flags.py` | `secret-b` Level 3 提示同步改成正確的 `blobs/sha256` + `tar tf/xf` 流程 |

## 6. 相關問題

- 與 [[secret-b-image-flag-mismatch-and-walkthrough-confusion]] 是
  Secret Room B 同一輪 playtest 連續發現的兩個獨立 bug：前者是
  「在哪裡執行」+「image 裡 FLAG 算錯」，這篇是「即使在對的地方執行、
  FLAG 也算對了，walkthrough 給的 layer 搜尋方法本身對現在的 Docker
  版本也是錯的」。
