# CRLF / LF 換行符問題（`.gitattributes`）

> **日期：** 2026-06-11

> 對應修復：[`.gitattributes`](../.gitattributes)（commit `f5ea19a`）

## 1. 問題現象

在 Windows 上開發、用 Git 直接 `add` / `commit` / `push` 到 GitHub 時，
本機 `docker compose up --build` 一切正常；但同一份程式碼在其他環境
（例如純 Linux、或 clone 下來重新 build image）執行時，部分房間的
`entrypoint.sh` / `setup.sh` 在 build 階段或啟動時直接失敗，
腳本「在 Windows 上可以跑，clone 下來之後就壞掉」。

## 2. 根因：CRLF 換行符被 Git 悄悄帶進 repo

Windows 上許多編輯器、以及 Git 本身的 `core.autocrlf` 設定，預設會把
文字檔的換行符存成 `\r\n`（CRLF）。但是：

- **`#!/bin/bash`** 這類 shebang 如果結尾是 `\r\n`，Linux 會把整行
  解讀成 `#!/bin/bash\r`，导致直譯器路徑找不到（`/bin/bash\r: No such
  file or directory`），或腳本內每一行指令結尾都多一個看不見的 `\r`，
  造成：
  - `command not found`（其實是 `command\r` 找不到）
  - `if`/`then`/變數比較莫名其妙失敗
  - `sha256sum`、`base64` 等指令算出來的結果跟「肉眼看到的字串」對不上
    （多算了一個 `\r` 進去）

這個專案裡 `rooms/**/entrypoint.sh`、`setup.sh`、`*.py`、`Dockerfile`
全部都是這種「容器內會被當成腳本執行」的檔案，只要其中任何一個被 Git
存成 CRLF，build 出來的 image 裡這個檔案就會帶著 `\r`，在 Linux 容器內
執行時出錯——而且**只有 push / 重新 clone 之後才會被觸發**，本機如果
一直用同一份 working tree、同一個已經 build 好的 image，是看不出問題的，
非常難排查。

## 3. 修復：新增 `.gitattributes` 強制這些檔案使用 LF

```gitattributes
* text=auto
*.sh text eol=lf
*.py text eol=lf
Dockerfile text eol=lf
```

- `* text=auto`：讓 Git 自動判斷文字檔，並在 commit 時統一成 LF
  儲存到 repo（checkout 到 Windows 時是否轉回 CRLF 由
  `core.autocrlf` 決定，但 repo 內容固定是 LF）
- `*.sh` / `*.py` / `Dockerfile`：明確強制這些「會被當腳本執行」的
  檔案無論本機設定為何，**在 repo 裡一律是 LF**，避免 build 出來的
  image 內含 `\r`

加入 `.gitattributes` 後，需要讓既有檔案重新套用規則
（新加的規則不會自動套用到已經 commit 過的檔案內容）：

```bash
git add --renormalize .
git commit -m "fix: normalize line endings to LF"
```

## 4. 結果

之後所有 `*.sh` / `*.py` / `Dockerfile` 在 repo 裡固定為 LF，
不論在 Windows 還是 Linux 上 clone、build，容器內的腳本內容都一致，
不會再出現「本機正常、push 後跑不動」的情況。

## 5. 經驗教訓

- 任何「會被當作可執行腳本進容器」的檔案，從一開始就應該用
  `.gitattributes` 鎖定 `eol=lf`，不要等到 push 之後才發現問題
- 排查這類問題時，可以用 `file <script>` 或
  `cat -A entrypoint.sh | head` 檢查是否有 `^M`（`\r`）字元
- 跟 [FLAG 一致性問題](flag-consistency.md) 一樣，這類 bug 的共同點是
  **本機看起來完全正常**，只有在「跨環境」（CRLF）或「容器重建」
  （FLAG_SEED）時才會被觸發，因此自動化檢查腳本（如
  `verify-flags.sh`）和 `.gitattributes` 這種「一次設定、永久生效」
  的防呆機制特別重要
