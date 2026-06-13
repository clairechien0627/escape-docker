# 容器內 vim 顯示中文亂碼（缺少 UTF-8 locale）

> **日期：** 2026-06-13

## 1. 緣由

玩家在 room8 用 `vim docker-compose.yml` 開啟題目檔案（內含中文註解，例如
「這份 docker-compose.yml 有幾個問題需要修正」），畫面顯示出**部分文字
正常、部分文字變成 `�~XX` 之類亂碼**的混合亂碼，而用 `cat` 看同一個檔案
時中文完全正常（`/etc/motd` 等其他中文輸出也都正常）。

## 2. 根因

room8（以及所有其他房間，因為都共用同一份 `Dockerfile` 樣板）的容器
**完全沒有設定 `LANG` / `LC_ALL`**：

```bash
$ docker exec -u player room8 bash -c 'echo LANG=$LANG; locale | grep LC_CTYPE'
LANG=
LC_CTYPE="POSIX"
```

`cat`、`/etc/motd` 等之所以正常，是因為它們只是把檔案的 raw bytes
原封不動丟給終端機；終端機本身（xterm.js, `TERM=xterm-256color`）是
UTF-8-capable 的，所以 raw UTF-8 bytes 顯示正確。

但 **vim 在沒有 UTF-8 locale 時，預設 `'encoding'` 會是 `latin1`**
（而不是 `utf-8`），且 `'fileencoding'` 也是空字串。實測：

```bash
# 沒有 LANG（room8 修復前的預設狀況）
$ vim -es -c 'redir! > /tmp/x' -c 'echo "enc=" . &encoding . " fenc=" . &fileencoding' -c 'redir END' -c 'q!' docker-compose.yml
enc=latin1 fenc=

# 設定 LANG=C.utf8
$ LANG=C.utf8 vim -es -c 'redir! > /tmp/x' -c 'echo "enc=" . &encoding . " fenc=" . &fileencoding' -c 'redir END' -c 'q!' docker-compose.yml
enc=utf-8 fenc=utf-8
```

當 `'encoding'=latin1` 時，vim 把檔案內每個 UTF-8 多位元組字元的「位元組」
當成一個個獨立的 latin1 字元來計算寬度與游標位置，顯示時再原樣輸出給
UTF-8 終端機——於是同一段文字裡，依字元在畫面上的位置不同，有些位置的
位元組組合恰好被終端機重新拼回正確的 UTF-8（顯示正常），有些則因游標
位置/換行計算錯位而被拆散、顯示成 `�~XX` 亂碼，形成「正常與亂碼混雜」
的現象。

`C.utf8` locale 在 `ubuntu:22.04` 是內建可用的（glibc 預先產生，
不需要額外 `locale-gen`）：

```bash
$ locale -a | grep -i utf
C.utf8
```

## 3. 修復

在所有 15 個房間的 `Dockerfile`（`rooms/*/Dockerfile`，皆為
`FROM ubuntu:22.04`）的 `FROM` 之後加入：

```dockerfile
FROM ubuntu:22.04

# 設定 UTF-8 locale，避免 vim/less 等工具在容器內顯示中文（多位元組字元）
# 時因為預設 POSIX locale 把 'encoding' 退回 latin1 而出現亂碼
ENV LANG=C.utf8 LC_ALL=C.utf8

ENV DEBIAN_FRONTEND=noninteractive
```

選用 `C.utf8`（而非 `en_US.UTF-8`）是因為它在 `ubuntu:22.04` 的 glibc
中已經內建產生，不需要在 `apt-get install` 階段額外安裝 `locales`
套件或執行 `locale-gen`，對既有 build 流程零侵入。

## 4. 驗證

```bash
docker compose build room8
docker compose up -d --force-recreate room8

docker exec -u player room8 bash -c 'echo LANG=$LANG'
# LANG=C.utf8

docker exec -u player room8 bash -c \
  "vim -es -c 'redir! > /tmp/x' -c 'echo \"enc=\" . &encoding . \" fenc=\" . &fileencoding' -c 'redir END' -c 'q!' ~/challenge/docker-compose.yml; cat /tmp/x"
# enc=utf-8 fenc=utf-8
```

room8 已重建並驗證 `enc=utf-8 fenc=utf-8`。其餘 14 個房間
（`final`、`room0`~`room7`、`room9`~`room11`、`secret-a`、`secret-b`）
也已 `docker compose build` + `up -d --force-recreate`，並逐一確認
`echo $LANG` → `C.utf8`。`scoreboard-api`／`terminal-gateway`／`nginx`
未重建，已提交的 FLAG/分數紀錄不受影響；房間容器內未保存的暫存修改
（無 volume，僅 writable layer）會在 recreate 時被清空。

## 5. 修改檔案清單

| 檔案 | 變更 |
|---|---|
| `rooms/{final,room0..room11,secret-a,secret-b}/Dockerfile`（共 15 個） | `FROM ubuntu:22.04` 之後加入 `ENV LANG=C.utf8 LC_ALL=C.utf8` |

## 6. 相關問題

- 此修復與同一場次另一個 room8 終端機問題（xterm.js vim 滾動「破圖」/
  滾動失效，見 [[xterm-scroll-corruption-and-overflow]]）是兩個獨立的
  bug，已分別確認修復有效。
