# room5 riddle_server.py SyntaxError 排查報告

> 在撰寫 `lab/exploits/room5.sh` 時發現並修復——**這是會影響真實玩家的
> bug，不只是 lab 自動化的問題**。

## 1. 緣由

room5（"The Wire Challenge"）的解法是連線到容器內的 `127.0.0.1:7777`，
回答謎語（答案是 `hostname`）取得 FLAG，由 `rooms/room5/riddle_server.py`
提供這個 TCP 服務。

撰寫 `lab/exploits/room5.sh` 時，第一步 `ss -tlnp` 列出監聽中的 port，
發現 room5 容器**根本沒有任何程式在監聽 7777**；用
`exec 3<>/dev/tcp/127.0.0.1/7777` 連線得到 `ConnectionRefusedError`。

## 2. 根因

`docker logs room5`：

```
  File "/app/riddle_server.py", line 9
SyntaxError: bytes can only contain ASCII literal characters.
```

`riddle_server.py` 裡有兩處用 `bytes` 字面值（`b"..."`）直接包含中文
字元：

```python
RIDDLE = b"""
==================================
  The Wire Challenge — Port 7777
==================================

謎語：
  我是每個容器的身份識別，
  ...
""" 
```

```python
conn.sendall(b"\n不對，再想想... 連線已關閉。\n")
```

Python 3 規定 `bytes` literal（`b"..."` / `b'''...'''`）**只能包含
ASCII 字元**，中文字屬於非 ASCII，直接在 `b"""..."""` 裡寫中文是
**編譯期 `SyntaxError`**——整個 `riddle_server.py` 連語法檢查都過不了，
`python3 riddle_server.py`（容器 CMD）一啟動就直接 crash，:7777 從未
被綁定。

**這代表 room5 在修復前對任何玩家都是無解的**——不是「謎語太難」，
是服務本身從未啟動過。

## 3. 修復

把兩處 `bytes` literal 改成一般的 `str` literal，最後再 `.encode("utf-8")`
轉成 bytes（`str` literal 對非 ASCII 字元沒有限制）：

```diff
-RIDDLE = b"""
+RIDDLE = """
 ==================================
   The Wire Challenge — Port 7777
 ==================================

 謎語：
   我是每個容器的身份識別，
   ...
-"""
+""".encode("utf-8")
```

```diff
-            conn.sendall(b"\n不對，再想想... 連線已關閉。\n")
+            conn.sendall("\n不對，再想想... 連線已關閉。\n".encode("utf-8"))
```

## 4. 驗證

```bash
docker compose up -d --build room5
```

容器內用 python3 直接做 socket 測試：連上 `127.0.0.1:7777` →
收到謎語 → 送出 `hostname` → 收到：

```
正確！🎉
FLAG: EscapeDocker{39a59f9da4df0538}
```

`lab/exploits/room5.sh` 重跑後回報 `status: "success"`，
`flag_found: "EscapeDocker{39a59f9da4df0538}"`。

## 5. 附帶修正：`lib/common.sh` 加上 `MSYS_NO_PATHCONV=1`

撰寫/測試 `lab/exploits/room5.sh` 的 step 2（`cat /etc/hosts`）時，在
Windows Git Bash 下出現：

```
cat: 'C:/Program Files/Git/etc/hosts': No such type or address
```

根因與 `troubleshooting/flag-consistency.md` 的「問題 D」完全相同：
Git Bash（MSYS）會把獨立出現的絕對路徑參數（例如 `/etc/hosts`）自動
轉成 Windows 路徑再傳給 `docker.exe`。

修復方式也相同——這次套用到 `lab/exploits/lib/common.sh`（所有
`lab/exploits/*.sh` 共用的函式庫），在檔案開頭加上：

```bash
export MSYS_NO_PATHCONV=1
```

只影響 Windows 上以獨立參數出現的絕對路徑；在 Linux 上此變數無效，
不影響其他平台。這個 step 本身是非必要的 recon 步驟，即使失敗也不影響
`room5.sh` 整體 `status: "success"`。

## 6. 修改檔案清單

| 檔案 | 變更 |
|---|---|
| `rooms/room5/riddle_server.py` | 兩處 `bytes` literal 改為 `str` literal + `.encode("utf-8")` |
| `lab/exploits/lib/common.sh` | 開頭加 `export MSYS_NO_PATHCONV=1` |
