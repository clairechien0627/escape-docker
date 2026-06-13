# Room 4 在修復前對玩家不可解：沒有任何方式把公鑰植入 locked-server

## 1. 緣由

玩家照 `walkthrough.md` / `/etc/motd` 的步驟操作：

```bash
ssh-keygen -t ed25519 -C "ctf" -f ~/.ssh/id_ed25519
ssh-copy-id -i ~/.ssh/id_ed25519.pub player@locked-server
# Permission denied (publickey)
ssh locked-server
# Permission denied (publickey)
ssh player@locked-server "mkdir -p ~/.ssh && echo '<pubkey>' >> ~/.ssh/authorized_keys ..."
# Permission denied (publickey)
```

不管用 `ssh-copy-id`、`ssh`、或直接 `ssh ... "echo ... >> authorized_keys"`，
全部都是 `Permission denied (publickey)`，玩家完全卡住。

## 2. 根因

`rooms/helpers/locked-server/Dockerfile`：

```dockerfile
RUN sed -i 's/PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config && \
    echo "PubkeyAuthentication yes" >> /etc/ssh/sshd_config
```

- `PasswordAuthentication no`：密碼登入完全關閉
- `PubkeyAuthentication yes`，但 `setup.sh` **從未建立
  `/home/player/.ssh/authorized_keys`**——一開始這個檔案不存在

也就是說，要透過 SSH「寫入」`authorized_keys`，前提是**已經能透過
SSH 登入**——但要能登入，前提是 `authorized_keys` 裡已經有你的公鑰。
這是一個**雞生蛋、蛋生雞**的迴圈，靠玩家手上任何 SSH 指令都無法打破。

`lab/scenarios/room4.json` 原本的 `notes` 也承認這點：

> 自動化腳本需先以其他方式（例如透過 docker exec 寫入檔案）植入公鑰，
> 才能完成 SSH 登入步驟。

但 `docker exec` 需要 **host 端權限**，room4 容器內的玩家完全沒有
（room4 沒有掛載 `docker.sock`）。換言之，**room4 在修復前對任何
真實玩家都是無解的**——跟 room5（服務沒啟動）、room8（YAML 語法錯誤）
是同一類「題目本身結構性損壞」的問題。

## 3. 修復

替 room4 ↔ locked-server 加一個「設定錯誤的共享 volume」，把
locked-server 的 `~/.ssh` 目錄整個跟 room4 共用：

```yaml
# docker-compose.yml
  room4:
    ...
    volumes:
      - locked_server_ssh:/home/player/locked-server-ssh

  locked-server:
    ...
    volumes:
      - locked_server_ssh:/home/player/.ssh

volumes:
  locked_server_ssh:
```

兩個容器的 `player` 都是 uid/gid 1000（各自 Dockerfile 建立），
named volume 第一次掛載時會從 `locked-server` image 裡複製
`/home/player/.ssh`（build time 已 `chmod 700 chown player:player`）
的內容/權限到 volume，所以 `.ssh` 目錄本身的 700 權限正確保留；
room4 的 `player`（同 uid 1000）可以直接 `cd`/寫入這個掛載點。

玩家現在只需要：

```bash
ssh-keygen -t ed25519 -C "ctf" -f ~/.ssh/id_ed25519
cat ~/.ssh/id_ed25519.pub >> ~/locked-server-ssh/authorized_keys
chmod 600 ~/locked-server-ssh/authorized_keys
ssh locked-server
ssh -f -L 8888:localhost:9090 locked-server -N
curl localhost:8888/flag
```

這仍然完全符合題目「ssh-key-based-pivot」的設計意圖（FLAG 在
`falco_relevant_behaviors` 列的「寫入/修改 authorized_keys」、
「SSH port forward」、「對內部服務的非預期 outbound 連線」都還是
玩家真實會做的動作），只是把「公鑰要怎麼送到對方那邊」這個遺漏的環節，
改成一個合理的「共享 volume 設定錯誤」漏洞。

## 4. 驗證

重建：

```bash
docker compose up -d room4 locked-server
```

（會建立新的 `escape-docker_locked_server_ssh` volume 並 recreate 兩個
container）

以 player 身分實測：

```bash
docker exec -u player room4 bash -c '
ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519 -C ctf
cat ~/.ssh/id_ed25519.pub >> ~/locked-server-ssh/authorized_keys
chmod 600 ~/locked-server-ssh/authorized_keys
ssh locked-server echo login-ok
ssh -f -L 8888:localhost:9090 locked-server -N && sleep 1 && curl -s http://localhost:8888/flag
'
```

```
login-ok
EscapeDocker{389c613624eaf750}
```

## 5. 修改檔案清單

| 檔案 | 變更 |
|---|---|
| `docker-compose.yml` | 新增 top-level `volumes: locked_server_ssh`；`room4` 掛載到 `/home/player/locked-server-ssh`，`locked-server` 掛載到 `/home/player/.ssh` |
| `rooms/room4/setup.sh` | `/etc/motd` Step 2 改為「把公鑰寫進 `~/locked-server-ssh/authorized_keys`」，移除無效的 `ssh-copy-id` 指示 |
| `lab/exploits/room4.sh` | `inject_pubkey()` 改為在 room4 容器內 `cat ... >> ~/locked-server-ssh/authorized_keys`，移除原本需要 host 權限的 `docker exec -u player locked-server ...` |
| `lab/scenarios/room4.json` | `exploit_steps[2]` 與 `notes` 更新為共享 volume 的說明 |
| `walkthrough.md` | Room 4 章節重寫 Step 2，移除錯誤的 `ssh-copy-id`/密碼登入說明與不存在的「locked-server 密碼說明」段落 |

## 6. 待手動確認

- 因為 `docker compose up -d room4 locked-server` 會 **recreate** 這兩個
  container，玩家先前在 room4 裡手動產生的 SSH key（`~/.ssh/id_ed25519`，
  存在於 container 的可寫層、非 volume）會消失，需要重新
  `ssh-keygen`。`~/locked-server-ssh/authorized_keys`（在 volume 裡）
  則會保留，重新 ssh-keygen 後記得用新的公鑰覆寫/附加。
