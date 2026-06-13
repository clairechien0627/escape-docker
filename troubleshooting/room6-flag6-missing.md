# Room 6 沒有任何方式可以取得 FLAG6（progression-blocking）

> **日期：** 2026-06-13

## 1. 緣由

玩家照 `walkthrough.md` / `/etc/motd` 的步驟走完 ghost-alpha /
ghost-beta / ghost-gamma 三個容器，分別讀到：

```
FLAG_PART_1: EscapeDocker-part1-82611962
SECRET_FLAG_PART2=part2_inspect_me
763241eb
```

`walkthrough.md` 原本宣稱「三個部分合起來就是完整的 FLAG」，但這三段
拼起來不是 `EscapeDocker{...}` 格式，無法提交。文件裡另有一段「真正的
FLAG 取得方式」，要求 `cat /home/player/.flag_hint`——但這個檔案在
room6 容器裡**不存在**。

## 2. 根因

- `scoreboard-api/flags.py` 定義
  `FLAG6 = EscapeDocker{sha256(FLAG_SEED + "-room6")[:16]}`，
  且 `room7`、`secret-a` 都是 `locked_by: ["FLAG6"]`——FLAG6 是
  **卡關卡點**，沒有它無法解鎖任何後續關卡。
- `rooms/room6/Dockerfile` + `setup.sh` 只設定 `/etc/motd` 與
  `.bashrc`，**沒有 `entrypoint.sh`，完全沒有任何程式碼計算或寫出
  FLAG6**。
- `lab/scenarios/room6.json` 的 `exploit_steps` 也只是
  「合併三段組成完整 FLAG」，與 `flags.py` 的 `_gen("room6")` 公式
  完全脫鉤；`lab/exploits/room6.sh` 甚至明確註解「這跟 scoreboard 的
  FLAG6 是獨立的兩件事，`flag_found` 留空」。

換句話說：**ghost-alpha/beta/gamma 的「拼圖」從一開始就沒有被接到
FLAG6 上**，`.flag_hint` 是文件裡虛構、從未實作的機制。Room 6 在修復前
對任何玩家都是**無法過關**的——跟 [[room4-unsolvable-no-pubkey-path]]
是同一類「題目結構性損壞」問題。

## 3. 修復

新增第 4 個 ghost 容器 `ghost-delta`，直接用跟 `flags.py` 的
`_gen("room6")` **完全相同的公式**算出並印出 FLAG6：

```yaml
# docker-compose.yml
  ghost-delta:
    image: alpine:3.19
    container_name: ghost-delta
    command: >
      sh -c "
        PART=$$(printf '%s' '${FLAG_SEED:-escape_docker_dev_seed}-room6' | sha256sum | cut -c1-16) &&
        echo \"FLAG: EscapeDocker{$${PART}}\"
      "
    environment:
      - FLAG_SEED=${FLAG_SEED:-escape_docker_dev_seed}
    networks:
      - docker_net
    restart: "no"
```

玩家用跟 ghost-alpha 一樣的手法（`docker ps -a` → `docker logs
ghost-delta`）即可直接看到 `EscapeDocker{...}`，完全符合本關
`vuln_type: docker-sock-exposure` 的教學意圖——不需要額外的權限或新指令。
ghost-alpha/beta/gamma 保留下來作為「docker.sock 濫用」的延伸練習
（logs / inspect / exec 三種讀取手法），但跟提交的 FLAG 無關。

**踩到的小坑**：`echo '...' | sha256sum` 跟 Python 的
`hashlib.sha256(f"{seed}-room6".encode())` 算出來的雜湊不一樣，因為
`echo` 會在字串後面多加一個換行字元。必須用 `printf '%s' '...' |
sha256sum` 才能跟 `flags.py` 算出同一個值（ghost-alpha/gamma 原本就有
這個 `echo` 用法，但因為它們的輸出本來就不是真的 FLAG，所以沒被發現）。

## 4. 驗證

```bash
docker compose up -d --force-recreate ghost-delta
docker logs ghost-delta
# FLAG: EscapeDocker{9c1cb9c8eb0e4eb8}

curl -s -X POST http://localhost/api/submit -H "Content-Type: application/json" \
  -d '{"player_name":"flagtest6","flag":"EscapeDocker{9c1cb9c8eb0e4eb8}"}'
# {"success":true,"message":"🎉 正確！獲得 200 分！","points":200,"room":"The Shipyard", ...}
```

驗證成功後刪除測試用的 `flagtest6` 紀錄（`submissions` / `achievements`
表），避免污染排行榜。

## 5. 修改檔案清單

| 檔案 | 變更 |
|---|---|
| `docker-compose.yml` | 新增 `ghost-delta` service（用 `_gen("room6")` 公式印出 FLAG6） |
| `rooms/room6/setup.sh` | `/etc/motd` 加入 ghost-delta 說明，移除「三個部分合起來=FLAG」的錯誤說法 |
| `scoreboard-api/flags.py` | room6 hints 改為提示 `docker logs ghost-delta` |
| `lab/scenarios/room6.json` | `exploit_steps` 加入 ghost-delta 步驟，標註 alpha/beta/gamma 為練習用 |
| `lab/exploits/room6.sh` | 加入讀取 `ghost-delta` 並擷取 `EscapeDocker{...}` 設定 `flag_found` |
| `walkthrough.md` | Room 6 章節重寫：ghost-gamma 補上 `docker cp` fallback（race condition，另見本檔說明），新增 ghost-delta 步驟，移除虛構的 `.flag_hint` 段落 |

## 6. 待手動確認

- 若部署環境之前已有玩家卡在 room6（例如已經拿到 FLAG5 但卡住），
  重啟後 `ghost-delta` 會自動出現在 `docker ps -a`，玩家不需要額外操作。
- 若之後更換 `.env` 的 `FLAG_SEED`，記得 `docker compose up -d
  --force-recreate ghost-delta` 讓它重新計算對應的 FLAG6。
