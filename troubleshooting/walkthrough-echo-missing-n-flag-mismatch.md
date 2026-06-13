# walkthrough.md 用 `echo` 計算 FLAG hash 導致結果錯誤（缺少 `-n`）

> **日期：** 2026-06-13

## 1. 緣由

玩家在 Secret Room A 依照 `walkthrough.md` 的步驟，用洩漏的 `LEAKED_SECRET`
計算 FLAG：

```bash
LEAKED=$(printenv LEAKED_SECRET)
FLAG_HASH=$(echo "${LEAKED}-secret-a" | sha256sum | cut -c1-16)
echo "EscapeDocker{${FLAG_HASH}}"
```

得到 `EscapeDocker{7acfa24bbedf6d70}`，送到 scoreboard **被判定為錯誤**。

## 2. 根因

`echo "字串"` 預設會在輸出**結尾加上一個換行字元 `\n`**，所以
`echo "${LEAKED}-secret-a" | sha256sum` 實際算的是
`sha256("...-secret-a\n")`，多了一個 `\n`。

但後端 `scoreboard-api/flags.py` 的 `_gen()`：

```python
def _gen(suffix: str) -> str:
    raw = hashlib.sha256(f"{_SEED}-{suffix}".encode()).hexdigest()[:16]
    return f"EscapeDocker{{{raw}}}"
```

`f"{_SEED}-{suffix}".encode()` **沒有任何換行字元**。

兩者輸入字串不同（多一個 `\n`），sha256 結果自然完全不同：

```bash
$ echo    "escape_docker_2024_change_me-secret-a" | sha256sum | cut -c1-16
7acfa24bbedf6d70   # 錯誤（多了 \n）

$ echo -n "escape_docker_2024_change_me-secret-a" | sha256sum | cut -c1-16
2a133e13be44ef89   # 正確，與 _gen("secret-a") 一致
```

`walkthrough.md` 裡所有「自己手動算 FLAG hash」的範例都用 `echo`
（不是 `echo -n`），都會中這個 bug：

- 第一段「方法 2：手動計算（預設 seed）」的單一 FLAG 範例與
  for 迴圈計算全部 FLAG
- Secret Room A 的 `FLAG_HASH=$(echo "${LEAKED}-secret-a" | sha256sum ...)`
- 文末「快速驗證腳本」裡確認所有房間 FLAG 是否生成的 for 迴圈

## 3. 修復

`walkthrough.md` 中所有 `echo "..." | sha256sum` 一律改成
`echo -n "..." | sha256sum`，並加上註解提醒這個陷阱：

| 位置 | 內容 |
|---|---|
| 「方法 2：手動計算」單一 FLAG 範例 | `echo -n "escape_docker_dev_seed-room0" \| sha256sum \| cut -c1-16` |
| 「方法 2：手動計算」for 迴圈 | `hash=$(echo -n "escape_docker_dev_seed-${room}" \| sha256sum \| cut -c1-16)` |
| Secret Room A Step 3 | `FLAG_HASH=$(echo -n "${LEAKED}-secret-a" \| sha256sum \| cut -c1-16)` |
| 快速驗證腳本 for 迴圈 | `FLAG=$(echo -n "${FLAG_SEED}-room'$i'" \| sha256sum \| cut -c1-16)` |

## 4. 驗證

```bash
$ echo -n "escape_docker_2024_change_me-secret-a" | sha256sum | cut -c1-16
2a133e13be44ef89
```

`EscapeDocker{2a133e13be44ef89}` 與 `_gen("secret-a")`（FLAG_SEED 取自
`.env`）一致，可被 scoreboard 接受。

## 5. 修改檔案清單

| 檔案 | 變更 |
|---|---|
| `walkthrough.md` | 4 處 `echo "..." \| sha256sum` 改為 `echo -n "..." \| sha256sum`，並加註解說明 `echo`/`echo -n` 差異 |
