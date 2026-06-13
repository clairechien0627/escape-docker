# EdgeRange Hub Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把現有「Escape Docker」改造成「EdgeRange」平台 Hub：新增學號＋暱稱＋頭像＋token 的玩家系統、全域導覽列、模組首頁網格，並把原本的 15 關密室逃脫整體變成「Story Mode」子模組。

**Architecture:** 後端（`scoreboard-api/`，FastAPI + SQLite）新增 `players` 表（`student_id` 為主鍵）與 `/auth/register`、`/auth/me` 端點，並以 `Authorization: Bearer <token>` 取代既有 request body 中的 `player_name`；既有 `submissions`/`hint_usage`/`achievements`/`room_timings` 表結構不變，欄位值改存 `student_id`。前端（`frontend/`）新增 Hub 首頁（`index.html`）、Story Mode 入口（`story.html`）、全域導覽列（`js/nav.js`）、即將推出頁（`coming-soon.html`），並更新 `map.html`/`play.html`/`scoreboard.html`/`achievements.html`/`admin.html` 以使用新的 token 認證與導覽列。

**Tech Stack:** FastAPI 0.111 + SQLite（`scoreboard-api/`），pytest + httpx + FastAPI TestClient（新增測試），原生 JS + xterm.js（`frontend/`），Docker Compose（`start.sh`）。

---

## Task 1: 新增測試依賴與 pytest fixture

**Files:**
- Modify: `scoreboard-api/requirements.txt`
- Create: `scoreboard-api/tests/__init__.py`
- Create: `scoreboard-api/tests/conftest.py`

- [ ] **Step 1: 新增測試依賴到 requirements.txt**

修改 `scoreboard-api/requirements.txt`，加入 `pytest` 與 `httpx`（Python 3.12-slim 相容版本）：

```
fastapi==0.111.0
uvicorn[standard]==0.30.1
pydantic==2.7.1
pytest==8.2.2
httpx==0.27.0
```

- [ ] **Step 2: 安裝依賴**

Run: `pip install -r scoreboard-api/requirements.txt`
Expected: 成功安裝 `pytest` 與 `httpx`（其餘套件可能已安裝，顯示 `Requirement already satisfied`）

- [ ] **Step 3: 建立 tests 套件與 conftest fixture**

建立空檔 `scoreboard-api/tests/__init__.py`（內容留空，僅讓 `tests` 成為 package）。

建立 `scoreboard-api/tests/conftest.py`：

```python
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
import database as db


@pytest.fixture()
def temp_db(tmp_path, monkeypatch):
    db_path = tmp_path / "test_scores.db"
    monkeypatch.setattr(db, "DB_PATH", str(db_path))
    db.init_db()
    return db_path
```

- [ ] **Step 4: 確認 pytest 可以收集測試（目前應該是 0 個測試）**

Run: `cd scoreboard-api && python -m pytest -v`
Expected: `collected 0 items` （沒有錯誤，conftest 載入成功）

- [ ] **Step 5: Commit**

```bash
git add scoreboard-api/requirements.txt scoreboard-api/tests/__init__.py scoreboard-api/tests/conftest.py
git commit -m "test: add pytest/httpx dependencies and temp_db fixture"
```

---

## Task 2: 資料庫 schema 升級 — players 表（student_id 為主鍵）

**Files:**
- Modify: `scoreboard-api/database.py`
- Test: `scoreboard-api/tests/test_database.py`

- [ ] **Step 1: 寫失敗測試**

建立 `scoreboard-api/tests/test_database.py`：

```python
import database as db


def test_register_or_login_creates_new_player(temp_db):
    row, is_new = db.register_or_login("112000001", "night_owl", "🦊")

    assert is_new is True
    assert row["student_id"] == "112000001"
    assert row["name"] == "night_owl"
    assert row["avatar"] == "🦊"
    assert row["token"]
    assert len(row["token"]) > 10


def test_register_or_login_returns_existing_token_and_updates_profile(temp_db):
    first, _ = db.register_or_login("112000001", "night_owl", "🦊")

    second, is_new = db.register_or_login("112000001", "new_nick", "🐧")

    assert is_new is False
    assert second["token"] == first["token"]
    assert second["name"] == "new_nick"
    assert second["avatar"] == "🐧"


def test_get_player_by_student_id(temp_db):
    db.register_or_login("112000001", "night_owl", "🦊")

    row = db.get_player_by_student_id("112000001")

    assert row is not None
    assert row["name"] == "night_owl"

    assert db.get_player_by_student_id("nonexistent") is None


def test_get_player_by_token(temp_db):
    created, _ = db.register_or_login("112000001", "night_owl", "🦊")

    row = db.get_player_by_token(created["token"])

    assert row is not None
    assert row["student_id"] == "112000001"

    assert db.get_player_by_token("invalid-token") is None


def test_get_scoreboard_uses_student_id_for_join(temp_db):
    db.register_or_login("112000001", "night_owl", "🦊")
    db.add_submission("112000001", "FLAG0", "room0", 100)

    scoreboard = db.get_scoreboard()

    assert len(scoreboard) == 1
    assert scoreboard[0]["student_id"] == "112000001"
    assert scoreboard[0]["name"] == "night_owl"
    assert scoreboard[0]["total_score"] == 100
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd scoreboard-api && python -m pytest tests/test_database.py -v`
Expected: FAIL — `AttributeError: module 'database' has no attribute 'register_or_login'`

- [ ] **Step 3: 修改 database.py — import 與 players 表 schema**

在檔案開頭 import 區塊（`import sqlite3` / `import os` 之後）加入：

```python
import secrets
```

找到 `init_db()` 的 `executescript` 字串中 `players` 表的 `CREATE TABLE` 陳述式：

```sql
            CREATE TABLE IF NOT EXISTS players (
                name        TEXT PRIMARY KEY,
                avatar      TEXT DEFAULT '🐳',
                joined_at   TEXT DEFAULT (datetime('now'))
            );
```

改為：

```sql
            CREATE TABLE IF NOT EXISTS players (
                student_id  TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                avatar      TEXT DEFAULT '🐳',
                token       TEXT UNIQUE NOT NULL,
                joined_at   TEXT DEFAULT (datetime('now'))
            );
```

- [ ] **Step 4: 移除 ensure_player，新增玩家查詢與註冊函式**

找到並刪除整個 `ensure_player` 函式（位於 `# ─── Players ───` 區塊）：

```python
def ensure_player(name: str, avatar: str = "🐳"):
    with get_conn() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO players (name, avatar) VALUES (?, ?)",
            (name, avatar)
        )
```

在同一位置（`# ─── Players ───` 區塊內，`get_all_players` 之前或之後皆可，建議放在 `get_all_players` 之後）加入以下三個新函式，沿用既有的 `with get_conn() as conn:` pattern：

```python
def get_player_by_student_id(student_id: str):
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM players WHERE student_id = ?", (student_id,)
        ).fetchone()


def get_player_by_token(token: str):
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM players WHERE token = ?", (token,)
        ).fetchone()


def register_or_login(student_id: str, name: str, avatar: str = "🐳"):
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT * FROM players WHERE student_id = ?", (student_id,)
        ).fetchone()

        if existing is None:
            token = secrets.token_urlsafe(16)
            conn.execute(
                "INSERT INTO players (student_id, name, avatar, token) VALUES (?, ?, ?, ?)",
                (student_id, name, avatar, token),
            )
            row = conn.execute(
                "SELECT * FROM players WHERE student_id = ?", (student_id,)
            ).fetchone()
            return row, True

        conn.execute(
            "UPDATE players SET name = ?, avatar = ? WHERE student_id = ?",
            (name, avatar, student_id),
        )
        row = conn.execute(
            "SELECT * FROM players WHERE student_id = ?", (student_id,)
        ).fetchone()
        return row, False
```

- [ ] **Step 5: 重寫 get_scoreboard() 的 JOIN 條件**

找到 `get_scoreboard()`：

```python
def get_scoreboard():
    with get_conn() as conn:
        rows = conn.execute("""
            SELECT
                p.name,
                p.avatar,
                COALESCE(SUM(s.points), 0) AS total_score,
                COUNT(s.id) AS flags_found,
                MAX(s.submitted_at) AS last_submit
            FROM players p
            LEFT JOIN submissions s ON p.name = s.player_name
            GROUP BY p.name, p.avatar
            ORDER BY total_score DESC, last_submit ASC
        """).fetchall()
        return [dict(r) for r in rows]
```

改為：

```python
def get_scoreboard():
    with get_conn() as conn:
        rows = conn.execute("""
            SELECT
                p.student_id,
                p.name,
                p.avatar,
                COALESCE(SUM(s.points), 0) AS total_score,
                COUNT(s.id) AS flags_found,
                MAX(s.submitted_at) AS last_submit
            FROM players p
            LEFT JOIN submissions s ON p.student_id = s.player_name
            GROUP BY p.student_id, p.name, p.avatar
            ORDER BY total_score DESC, last_submit ASC
        """).fetchall()
        return [dict(r) for r in rows]
```

- [ ] **Step 6: 執行測試確認通過**

Run: `cd scoreboard-api && python -m pytest tests/test_database.py -v`
Expected: 5 個測試全數 PASS

- [ ] **Step 7: 刪除舊的開發資料庫檔**

Run: `rm -f scoreboard-api/data/scores.db`（PowerShell: `Remove-Item -Force scoreboard-api/data/scores.db -ErrorAction SilentlyContinue`）
Expected: 舊資料庫刪除（下次啟動時 `init_db()` 會重新建立含新 schema 的資料庫）

- [ ] **Step 8: Commit**

```bash
git add scoreboard-api/database.py scoreboard-api/tests/test_database.py
git rm --cached scoreboard-api/data/scores.db --ignore-unmatch
git commit -m "feat: redesign players table around student_id with token auth"
```

---

## Task 3: Auth API — /auth/register 與 /auth/me

**Files:**
- Modify: `scoreboard-api/main.py`
- Test: `scoreboard-api/tests/test_auth_api.py`

- [ ] **Step 1: 寫失敗測試**

建立 `scoreboard-api/tests/test_auth_api.py`：

```python
from fastapi.testclient import TestClient


def make_client(temp_db):
    import main
    return TestClient(main.app)


def test_auth_register_creates_player_and_returns_token(temp_db):
    client = make_client(temp_db)

    resp = client.post("/auth/register", json={
        "student_id": "112000001",
        "name": "night_owl",
        "avatar": "🦊",
    })

    assert resp.status_code == 200
    body = resp.json()
    assert body["student_id"] == "112000001"
    assert body["name"] == "night_owl"
    assert body["avatar"] == "🦊"
    assert body["token"]


def test_auth_register_same_student_id_returns_same_token(temp_db):
    client = make_client(temp_db)

    first = client.post("/auth/register", json={
        "student_id": "112000001",
        "name": "night_owl",
        "avatar": "🦊",
    }).json()

    second = client.post("/auth/register", json={
        "student_id": "112000001",
        "name": "new_nick",
        "avatar": "🐧",
    }).json()

    assert second["token"] == first["token"]
    assert second["name"] == "new_nick"
    assert second["avatar"] == "🐧"


def test_auth_me_with_valid_token(temp_db):
    client = make_client(temp_db)

    reg = client.post("/auth/register", json={
        "student_id": "112000001",
        "name": "night_owl",
        "avatar": "🦊",
    }).json()

    resp = client.get("/auth/me", headers={"Authorization": f"Bearer {reg['token']}"})

    assert resp.status_code == 200
    body = resp.json()
    assert body["student_id"] == "112000001"
    assert body["name"] == "night_owl"
    assert body["avatar"] == "🦊"


def test_auth_me_without_token_returns_401(temp_db):
    client = make_client(temp_db)

    resp = client.get("/auth/me")

    assert resp.status_code == 401


def test_auth_me_with_invalid_token_returns_401(temp_db):
    client = make_client(temp_db)

    resp = client.get("/auth/me", headers={"Authorization": "Bearer not-a-real-token"})

    assert resp.status_code == 401
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd scoreboard-api && python -m pytest tests/test_auth_api.py -v`
Expected: FAIL — `404 Not Found` on `/auth/register`（路由不存在）

- [ ] **Step 3: 更新 fastapi import**

修改 `scoreboard-api/main.py` 第 2 行：

```python
from fastapi import FastAPI, HTTPException, Header
```

改為：

```python
from fastapi import FastAPI, HTTPException, Header, Depends
```

- [ ] **Step 4: 移除舊的 RegisterRequest model 與 POST /register 端點**

刪除 `RegisterRequest` model（含其 `field_validator`）：

```python
class RegisterRequest(BaseModel):
    name: str
    avatar: Optional[str] = "🐳"

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v):
        v = v.strip()
        if not v or len(v) > 30:
            raise ValueError("名字需為 1-30 個字元")
        return v
```

刪除 `POST /register` 端點：

```python
@app.post("/register")
def register(req: RegisterRequest):
    db.ensure_player(req.name, req.avatar or "🐳")
    return {"ok": True, "name": req.name}
```

第 5 行 `from typing import Optional` 在移除 `RegisterRequest` 後不再被使用（`AuthRegisterRequest` 不需要 `Optional`），一併刪除整行：

```python
from typing import Optional
```

- [ ] **Step 5: 新增 AuthRegisterRequest model**

在原本 `RegisterRequest` 的位置（`# ─── Models ───` 區塊內）加入：

```python
class AuthRegisterRequest(BaseModel):
    student_id: str
    name: str
    avatar: str = "🐳"

    @field_validator("student_id")
    @classmethod
    def student_id_not_empty(cls, v):
        v = v.strip()
        if not v or len(v) > 30:
            raise ValueError("學號需為 1-30 個字元")
        return v

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v):
        v = v.strip()
        if not v or len(v) > 30:
            raise ValueError("暱稱需為 1-30 個字元")
        return v
```

`from pydantic import BaseModel, field_validator`（第 4 行）已經包含 `field_validator`，不需修改 import。

- [ ] **Step 6: 新增 get_current_player dependency**

在 `AuthRegisterRequest` 之後、第一個路由之前加入：

```python
def get_current_player(authorization: str = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")

    token = authorization.removeprefix("Bearer ").strip()
    player = db.get_player_by_token(token)
    if player is None:
        raise HTTPException(status_code=401, detail="Invalid token")

    return player
```

- [ ] **Step 7: 新增 /auth/register 與 /auth/me 端點**

在原本 `POST /register` 的位置加入：

```python
@app.post("/auth/register")
def auth_register(req: AuthRegisterRequest):
    row, _ = db.register_or_login(req.student_id, req.name, req.avatar)
    return {
        "token": row["token"],
        "student_id": row["student_id"],
        "name": row["name"],
        "avatar": row["avatar"],
    }


@app.get("/auth/me")
def auth_me(player=Depends(get_current_player)):
    return {
        "student_id": player["student_id"],
        "name": player["name"],
        "avatar": player["avatar"],
    }
```

- [ ] **Step 8: 執行測試確認通過**

Run: `cd scoreboard-api && python -m pytest tests/test_auth_api.py -v`
Expected: 5 個測試全數 PASS

- [ ] **Step 9: 執行全部測試確認沒有破壞既有測試**

Run: `cd scoreboard-api && python -m pytest -v`
Expected: 全部 PASS（Task 2 + Task 3 的測試共 10 個）

- [ ] **Step 10: Commit**

```bash
git add scoreboard-api/main.py scoreboard-api/tests/test_auth_api.py
git commit -m "feat: add token-based auth endpoints (/auth/register, /auth/me)"
```

---

## Task 4: 重構遊戲端點 — /submit、/hint、/enter、/player/me

**Files:**
- Modify: `scoreboard-api/main.py`
- Test: `scoreboard-api/tests/test_gameplay_api.py`

- [ ] **Step 1: 寫失敗測試**

建立 `scoreboard-api/tests/test_gameplay_api.py`：

```python
from fastapi.testclient import TestClient


def make_client(temp_db):
    import main
    return TestClient(main.app)


def register(client, student_id="112000001", name="night_owl", avatar="🦊"):
    resp = client.post("/auth/register", json={
        "student_id": student_id,
        "name": name,
        "avatar": avatar,
    })
    return resp.json()


def auth_header(token):
    return {"Authorization": f"Bearer {token}"}


def test_submit_requires_auth(temp_db):
    client = make_client(temp_db)

    resp = client.post("/submit", json={"flag": "whatever"})

    assert resp.status_code == 401


def test_submit_invalid_flag(temp_db):
    client = make_client(temp_db)
    profile = register(client)

    resp = client.post("/submit", json={"flag": "not-a-real-flag"},
                        headers=auth_header(profile["token"]))

    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is False


def test_submit_valid_flag_updates_player_progress(temp_db):
    import flags
    client = make_client(temp_db)
    profile = register(client)

    real_flag = next(iter(flags.FLAGS.keys()))

    resp = client.post("/submit", json={"flag": real_flag},
                        headers=auth_header(profile["token"]))

    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True

    me = client.get("/player/me", headers=auth_header(profile["token"])).json()
    assert me["score"] > 0
    assert len(me["flags"]) == 1


def test_player_me_requires_auth(temp_db):
    client = make_client(temp_db)

    resp = client.get("/player/me")

    assert resp.status_code == 401


def test_enter_and_hint_require_auth(temp_db):
    client = make_client(temp_db)

    assert client.post("/enter", json={"room_id": "room0"}).status_code == 401
    assert client.post("/hint", json={"room_id": "room0", "level": 1}).status_code == 401


def test_hint_with_auth_records_usage(temp_db):
    client = make_client(temp_db)
    profile = register(client)

    resp = client.post("/hint", json={"room_id": "room0", "level": 1},
                        headers=auth_header(profile["token"]))

    assert resp.status_code == 200
    body = resp.json()
    assert "text" in body


def test_admin_dashboard_includes_student_id(temp_db, monkeypatch):
    client = make_client(temp_db)
    register(client)

    resp = client.get("/admin/dashboard", headers={"X-Admin-Token": "admin_dev_token"})

    assert resp.status_code == 200
    body = resp.json()
    assert "student_id" in body["scoreboard"][0]


def test_public_scoreboard_does_not_expose_student_id(temp_db):
    client = make_client(temp_db)
    register(client)

    resp = client.get("/scoreboard")

    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert "student_id" not in body[0]
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd scoreboard-api && python -m pytest tests/test_gameplay_api.py -v`
Expected: FAIL — `/submit` 等端點目前要求 body 含 `player_name`，回傳 422，且 `/player/me` 路由不存在（404）

- [ ] **Step 3: 簡化 request models**

找到並修改以下三個 model：

```python
class SubmitRequest(BaseModel):
    player_name: str
    flag: str


class HintRequest(BaseModel):
    player_name: str
    room_id: str
    level: int  # 1, 2, 3


class RoomEntryRequest(BaseModel):
    player_name: str
    room_id: str
```

改為：

```python
class SubmitRequest(BaseModel):
    flag: str


class HintRequest(BaseModel):
    room_id: str
    level: int  # 1, 2, 3


class RoomEntryRequest(BaseModel):
    room_id: str
```

- [ ] **Step 4: 重構 POST /submit**

找到：

```python
@app.post("/submit")
def submit_flag(req: SubmitRequest):
    flag_info = FLAGS.get(req.flag.strip())

    if not flag_info:
        return {"success": False, "message": "FLAG 錯誤，再試一次！", "points": 0}

    db.ensure_player(req.player_name)

    if db.already_submitted(req.player_name, flag_info["id"]):
        return {"success": False, "message": f"你已經提交過 {flag_info['id']} 了！", "points": 0}

    db.add_submission(req.player_name, flag_info["id"], flag_info["room"], flag_info["points"])
    db.record_room_completion(req.player_name, flag_info["room"])

    new_achv = check_and_award(req.player_name, flag_info["room"], flag_info["id"])

    return {
        "success": True,
        "message": f"🎉 正確！獲得 {flag_info['points']} 分！",
        "points": flag_info["points"],
        "room": flag_info["name"],
        "new_achievements": new_achv,
    }
```

改為：

```python
@app.post("/submit")
def submit_flag(req: SubmitRequest, player=Depends(get_current_player)):
    player_name = player["student_id"]

    flag_info = FLAGS.get(req.flag.strip())

    if not flag_info:
        return {"success": False, "message": "FLAG 錯誤，再試一次！", "points": 0}

    if db.already_submitted(player_name, flag_info["id"]):
        return {"success": False, "message": f"你已經提交過 {flag_info['id']} 了！", "points": 0}

    db.add_submission(player_name, flag_info["id"], flag_info["room"], flag_info["points"])
    db.record_room_completion(player_name, flag_info["room"])

    new_achv = check_and_award(player_name, flag_info["room"], flag_info["id"])

    return {
        "success": True,
        "message": f"🎉 正確！獲得 {flag_info['points']} 分！",
        "points": flag_info["points"],
        "room": flag_info["name"],
        "new_achievements": new_achv,
    }
```

- [ ] **Step 5: 重構 POST /hint**

找到：

```python
@app.post("/hint")
def use_hint(req: HintRequest):
    room_hints = HINTS.get(req.room_id)
    if not room_hints:
        raise HTTPException(status_code=404, detail="此房間沒有提示")

    hint = next((h for h in room_hints if h["level"] == req.level), None)
    if not hint:
        raise HTTPException(status_code=404, detail="無效的提示等級")

    already = db.get_player_hints_used(req.player_name, req.room_id)
    if req.level in already:
        return {"text": hint["text"], "cost": 0, "already_used": True}

    db.ensure_player(req.player_name)
    db.record_hint(req.player_name, req.room_id, req.level, hint["cost"])

    return {"text": hint["text"], "cost": hint["cost"], "already_used": False}
```

改為：

```python
@app.post("/hint")
def use_hint(req: HintRequest, player=Depends(get_current_player)):
    player_name = player["student_id"]

    room_hints = HINTS.get(req.room_id)
    if not room_hints:
        raise HTTPException(status_code=404, detail="此房間沒有提示")

    hint = next((h for h in room_hints if h["level"] == req.level), None)
    if not hint:
        raise HTTPException(status_code=404, detail="無效的提示等級")

    already = db.get_player_hints_used(player_name, req.room_id)
    if req.level in already:
        return {"text": hint["text"], "cost": 0, "already_used": True}

    db.record_hint(player_name, req.room_id, req.level, hint["cost"])

    return {"text": hint["text"], "cost": hint["cost"], "already_used": False}
```

- [ ] **Step 6: 重構 POST /enter**

找到：

```python
@app.post("/enter")
def enter_room(req: RoomEntryRequest):
    db.ensure_player(req.player_name)
    db.record_room_entry(req.player_name, req.room_id)
    return {"ok": True}
```

改為：

```python
@app.post("/enter")
def enter_room(req: RoomEntryRequest, player=Depends(get_current_player)):
    db.record_room_entry(player["student_id"], req.room_id)
    return {"ok": True}
```

- [ ] **Step 7: 將 GET /player/{name} 改為 GET /player/me**

找到：

```python
@app.get("/player/{name}")
def player_progress(name: str):
    flags_done = db.get_player_flags(name)
    achvs = db.get_player_achievements(name)
    flags_done_set = set(flags_done)

    rooms = []
    for room in ROOM_META:
        locked = any(dep not in flags_done_set for dep in room["locked_by"])
        completed = any(
            f["id"] in flags_done_set
            for f in FLAGS.values()
            if f["room"] == room["id"]
        )
        hints_used = db.get_player_hints_used(name, room["id"])
        rooms.append({
            "id": room["id"],
            "name": room["name"],
            "icon": room["icon"],
            "chapter": room["chapter"],
            "locked": locked,
            "completed": completed,
            "hints_used": hints_used,
        })

    return {
        "name": name,
        "flags": flags_done,
        "achievements": achvs,
        "rooms": rooms,
    }
```

改為：

```python
@app.get("/player/me")
def player_progress(player=Depends(get_current_player)):
    student_id = player["student_id"]
    flags_done = db.get_player_flags(student_id)
    achvs = db.get_player_achievements(student_id)
    flags_done_set = set(flags_done)

    base_score = sum(f["points"] for f in FLAGS.values() if f["id"] in flags_done_set)
    achievement_bonus = sum(a["points"] for a in ALL_ACHIEVEMENTS if a["id"] in achvs)

    rooms = []
    for room in ROOM_META:
        locked = any(dep not in flags_done_set for dep in room["locked_by"])
        completed = any(
            f["id"] in flags_done_set
            for f in FLAGS.values()
            if f["room"] == room["id"]
        )
        hints_used = db.get_player_hints_used(student_id, room["id"])
        rooms.append({
            "id": room["id"],
            "name": room["name"],
            "icon": room["icon"],
            "chapter": room["chapter"],
            "locked": locked,
            "completed": completed,
            "hints_used": hints_used,
        })

    return {
        "student_id": player["student_id"],
        "name": player["name"],
        "avatar": player["avatar"],
        "flags": flags_done,
        "achievements": achvs,
        "score": base_score + achievement_bonus,
        "rooms": rooms,
    }
```

- [ ] **Step 8: 修正 GET /scoreboard 的成就查詢改用 student_id**

找到 `GET /scoreboard` 端點中 `db.get_player_achievements(row["name"])` 這一行：

```python
@app.get("/scoreboard")
def scoreboard():
    rows = db.get_scoreboard()
    result = []
    for i, row in enumerate(rows):
        achvs = db.get_player_achievements(row["name"])
        bonus = sum(
            a["points"] for a in ALL_ACHIEVEMENTS if a["id"] in achvs
        )
        result.append({
            "rank": i + 1,
            "name": row["name"],
            "avatar": row["avatar"],
            "score": row["total_score"] + bonus,
            "base_score": row["total_score"],
            "achievement_bonus": bonus,
            "flags": row["flags_found"],
            "achievements": len(achvs),
            "last_submit": row["last_submit"],
        })
    result.sort(key=lambda x: (-x["score"], x["last_submit"] or ""))
    for i, r in enumerate(result):
        r["rank"] = i + 1
    return result
```

只將 `db.get_player_achievements(row["name"])` 改為 `db.get_player_achievements(row["student_id"])`，其餘邏輯不變：

```python
@app.get("/scoreboard")
def scoreboard():
    rows = db.get_scoreboard()
    result = []
    for i, row in enumerate(rows):
        achvs = db.get_player_achievements(row["student_id"])
        bonus = sum(
            a["points"] for a in ALL_ACHIEVEMENTS if a["id"] in achvs
        )
        result.append({
            "rank": i + 1,
            "name": row["name"],
            "avatar": row["avatar"],
            "score": row["total_score"] + bonus,
            "base_score": row["total_score"],
            "achievement_bonus": bonus,
            "flags": row["flags_found"],
            "achievements": len(achvs),
            "last_submit": row["last_submit"],
        })
    result.sort(key=lambda x: (-x["score"], x["last_submit"] or ""))
    for i, r in enumerate(result):
        r["rank"] = i + 1
    return result
```

注意：輸出的 `result` dict 中本來就沒有 `student_id` 鍵，因此 `/scoreboard` 自然不會洩漏學號（`test_public_scoreboard_does_not_expose_student_id` 直接通過，不需額外處理）。

- [ ] **Step 9: 確認 GET /admin/dashboard 自動包含 student_id**

`GET /admin/dashboard` 呼叫 `db.get_scoreboard()`，由於 Task 2 已在 `get_scoreboard()` 輸出中加入 `student_id`，此端點不需修改即會自動包含該欄位。閱讀該端點程式碼確認其回傳結構中確實有一個 key（例如 `scoreboard`）對應到 `db.get_scoreboard()` 的結果列表（測試 `test_admin_dashboard_includes_student_id` 假設為 `body["scoreboard"][0]`）；若實際 key 名稱不同，調整測試中的斷言以符合實際回傳結構，但不修改 `/admin/dashboard` 的程式邏輯。

- [ ] **Step 10: 執行測試確認通過**

Run: `cd scoreboard-api && python -m pytest tests/test_gameplay_api.py -v`
Expected: 8 個測試全數 PASS

- [ ] **Step 11: 執行全部測試**

Run: `cd scoreboard-api && python -m pytest -v`
Expected: 全部測試 PASS（共 18 個）

- [ ] **Step 12: Commit**

```bash
git add scoreboard-api/main.py scoreboard-api/tests/test_gameplay_api.py
git commit -m "feat: refactor gameplay endpoints to use token-based player identity"
```

---

## Task 5: 前端 — 重寫 js/api.js 為 token 認證

**Files:**
- Modify: `frontend/js/api.js`

- [ ] **Step 1: 閱讀現有 api.js**

Read: `frontend/js/api.js` 全文（確認 `toast`、`copyToClipboard` 的精確實作以便保留）。

- [ ] **Step 2: 重寫 api.js**

將整份 `frontend/js/api.js` 改寫為：

```javascript
const API_BASE = '/api';
const TOKEN_KEY = 'edgerange_token';

let _profileCache = null;

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || null;
}

function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
  _profileCache = null;
}

function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  _profileCache = null;
}

async function apiFetch(path, options = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
  const token = getToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const resp = await fetch(`${API_BASE}${path}`, Object.assign({}, options, { headers }));

  if (!resp.ok) {
    let detail = resp.statusText;
    try {
      const body = await resp.json();
      detail = body.detail || detail;
    } catch (e) {}
    const err = new Error(detail);
    err.status = resp.status;
    throw err;
  }

  if (resp.status === 204) return null;
  return resp.json();
}

async function getProfile() {
  if (_profileCache) return _profileCache;
  if (!getToken()) return null;
  try {
    _profileCache = await apiFetch('/auth/me');
    return _profileCache;
  } catch (e) {
    clearToken();
    return null;
  }
}

const API = {
  register(student_id, name, avatar) {
    return apiFetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ student_id, name, avatar }),
    });
  },
  me() {
    return apiFetch('/auth/me');
  },
  submit(flag) {
    return apiFetch('/submit', {
      method: 'POST',
      body: JSON.stringify({ flag }),
    });
  },
  scoreboard() {
    return apiFetch('/scoreboard');
  },
  player() {
    return apiFetch('/player/me');
  },
  rooms() {
    return apiFetch('/rooms');
  },
  roomsStatus() {
    return apiFetch('/rooms/status');
  },
  hints(room_id) {
    return apiFetch(`/hints/${room_id}`);
  },
  useHint(room_id, level) {
    return apiFetch('/hint', {
      method: 'POST',
      body: JSON.stringify({ room_id, level }),
    });
  },
  enter(room_id) {
    return apiFetch('/enter', {
      method: 'POST',
      body: JSON.stringify({ room_id }),
    });
  },
  achievements() {
    return apiFetch('/achievements');
  },
};

function toast(msg, type = 'info', duration = 4000) {
  const container = document.getElementById('toast-container') || (() => {
    const c = document.createElement('div');
    c.id = 'toast-container';
    document.body.appendChild(c);
    return c;
  })();

  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  container.appendChild(el);

  setTimeout(() => el.remove(), duration);
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    toast('已複製到剪貼簿', 'success', 1500);
  }).catch(() => {
    toast('複製失敗', 'error');
  });
}

async function requirePlayer() {
  const profile = await getProfile();
  if (!profile) {
    window.location.href = 'index.html';
    return null;
  }
  return profile;
}
```

注意：`toast`、`copyToClipboard` 兩個函式的實作細節（例如 toast container 的 DOM 結構/CSS class 名稱）必須與**目前 `frontend/js/api.js` 的實際內容**完全一致——上方為依先前讀取記錄重建的版本，實作時請先 Read 現有檔案，將這兩個函式**逐字複製**過來，不要憑記憶重寫，避免破壞既有 `toast`/`copyToClipboard` 的視覺樣式或行為。`API` 物件中各方法對應的 endpoint 路徑（`/rooms`、`/rooms/status`、`/hints/{room_id}`、`/achievements`）若與現有檔案不同，以現有檔案為準。

- [ ] **Step 3: 手動驗證語法正確**

Run: `node --check frontend/js/api.js`
Expected: 無輸出（語法正確）

- [ ] **Step 4: Commit**

```bash
git add frontend/js/api.js
git commit -m "feat: rework frontend API client for token-based auth"
```

---

## Task 6: 全域導覽列 — js/nav.js 與 CSS

**Files:**
- Create: `frontend/js/nav.js`
- Modify: `frontend/css/style.css`

- [ ] **Step 1: 閱讀現有 style.css 中 .navbar 相關樣式**

Read: `frontend/css/style.css`，確認 `.navbar`/`.navbar-brand`/`.navbar-links`/`.navbar-score` 的完整 CSS（行號約 112-153，已於前一輪會話確認存在）。

- [ ] **Step 2: 新增 .navbar-player 樣式**

在 `.navbar-score` 區塊結束後加入：

```css
.navbar-player {
  font-size: 0.82rem;
  color: var(--text-dim);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.3rem 0.75rem;
  white-space: nowrap;
}
```

- [ ] **Step 3: 建立 frontend/js/nav.js**

```javascript
const NAV_LINKS = [
  { id: 'hub', label: 'Hub', href: 'index.html' },
  { id: 'story', label: 'Story Mode', href: 'story.html' },
  { id: 'sandbox', label: 'Sandbox', href: 'coming-soon.html?module=sandbox' },
  { id: 'forensics', label: 'Forensics Lab', href: 'coming-soon.html?module=forensics' },
  { id: 'network', label: 'Network Lab', href: 'coming-soon.html?module=network' },
  { id: 'ops', label: 'Ops Center', href: 'coming-soon.html?module=ops' },
  { id: 'maker', label: 'Maker Mode', href: 'coming-soon.html?module=maker' },
  { id: 'scoreboard', label: 'Scoreboard', href: 'scoreboard.html' },
];

function _navIsActive(link) {
  const current = window.location.pathname.split('/').pop() || 'index.html';
  const linkPath = link.href.split('?')[0];
  return current === linkPath;
}

async function renderNav() {
  const mount = document.getElementById('global-nav');
  if (!mount) return;

  const linksHtml = NAV_LINKS.map(link => {
    const activeClass = _navIsActive(link) ? ' active' : '';
    return `<a href="${link.href}" class="navbar-link${activeClass}">${link.label}</a>`;
  }).join('');

  let playerHtml = '<span class="navbar-player">未登入</span>';
  if (typeof getProfile === 'function') {
    const profile = await getProfile();
    if (profile) {
      playerHtml = `<span class="navbar-player">${profile.avatar} ${profile.name}</span>`;
    }
  }

  mount.innerHTML = `
    <nav class="navbar">
      <div class="navbar-brand">▌EDGE://RANGE</div>
      <div class="navbar-links">${linksHtml}</div>
      ${playerHtml}
    </nav>
  `;
}

renderNav();
```

注意：實際 `.navbar-links` 內部連結的 class 名稱（`navbar-link` vs 其他命名）與 `.active` 狀態的標示方式，需與 `frontend/css/style.css` 中既有 `.navbar-links a` 相關選擇器一致——實作時先確認 Step 1 讀到的 CSS 中連結元素的 tag/class，再對應調整 `renderNav()` 產生的 HTML，確保視覺風格與既有導覽列一致。

- [ ] **Step 4: 語法檢查**

Run: `node --check frontend/js/nav.js`
Expected: 無輸出

- [ ] **Step 5: Commit**

```bash
git add frontend/js/nav.js frontend/css/style.css
git commit -m "feat: add global navigation component"
```

---

## Task 7: 模組中繼資料 — js/modules-meta.js

**Files:**
- Create: `frontend/js/modules-meta.js`

- [ ] **Step 1: 建立 frontend/js/modules-meta.js**

```javascript
// 所有模組共用一個敘事主軸：玩家是被派駐到同一座邊緣運算節點的維運／資安人員，
// 每個模組對應這座節點的不同任務面向，因此 desc 一律以「這座節點」為主語。
const MODULES = [
  {
    id: 'story',
    icon: '📖',
    name: 'Story Mode',
    desc: '取得這座邊緣節點的存取權限（15 關）',
    status: 'available',
    href: 'story.html',
  },
  {
    id: 'sandbox',
    icon: '🧪',
    name: 'Sandbox',
    desc: '在這座節點上自由架設與實驗',
    status: 'coming-soon',
    phase: 1,
  },
  {
    id: 'forensics',
    icon: '🕵️',
    name: 'Forensics Lab',
    desc: '調查這座節點過去發生的資安事故',
    status: 'coming-soon',
    phase: 2,
  },
  {
    id: 'network',
    icon: '🌐',
    name: 'Network Lab',
    desc: '分析這座節點所在網路的威脅活動',
    status: 'coming-soon',
    phase: 2,
  },
  {
    id: 'ops',
    icon: '📡',
    name: 'Ops Center',
    desc: '即時監控這座節點的運作狀態',
    status: 'coming-soon',
    phase: 1,
  },
  {
    id: 'maker',
    icon: '🧩',
    name: 'Maker Mode',
    desc: '為下一批駐點人員設計挑戰',
    status: 'coming-soon',
    phase: 4,
  },
];

function getModule(id) {
  return MODULES.find(m => m.id === id) || null;
}
```

- [ ] **Step 2: 語法檢查**

Run: `node --check frontend/js/modules-meta.js`
Expected: 無輸出

- [ ] **Step 3: Commit**

```bash
git add frontend/js/modules-meta.js
git commit -m "feat: add module metadata for hub and coming-soon pages"
```

---

## Task 8: 即將推出頁 — coming-soon.html

**Files:**
- Create: `frontend/coming-soon.html`

- [ ] **Step 1: 閱讀現有頁面結構作為範本**

Read: `frontend/achievements.html`（作為簡單頁面結構範本：`<head>` 中 CSS/字型引入方式、`<body>` 結構慣例）。

- [ ] **Step 2: 建立 frontend/coming-soon.html**

```html
<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>即將推出 — EdgeRange</title>
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <div id="global-nav"></div>

  <main class="container">
    <div class="card" style="max-width: 480px; margin: 4rem auto; text-align: center;">
      <div id="module-icon" style="font-size: 3rem; margin-bottom: 0.5rem;"></div>
      <h1 id="module-name"></h1>
      <p id="module-desc" class="text-dim"></p>
      <div id="module-phase" class="badge" style="margin: 1rem 0;"></div>
      <a href="index.html" class="btn">← 返回 Hub</a>
    </div>
  </main>

  <script src="js/api.js"></script>
  <script src="js/modules-meta.js"></script>
  <script src="js/nav.js"></script>
  <script>
    const params = new URLSearchParams(window.location.search);
    const moduleId = params.get('module');
    const mod = getModule(moduleId);

    if (mod) {
      document.getElementById('module-icon').textContent = mod.icon;
      document.getElementById('module-name').textContent = mod.name;
      document.getElementById('module-desc').textContent = mod.desc;
      document.getElementById('module-phase').textContent = `🔒 即將推出 (Phase ${mod.phase})`;
      document.title = `${mod.name} — EdgeRange`;
    } else {
      document.getElementById('module-icon').textContent = '❓';
      document.getElementById('module-name').textContent = '未知模組';
      document.getElementById('module-desc').textContent = '找不到這個模組的資訊。';
      document.getElementById('module-phase').textContent = '';
    }
  </script>
</body>
</html>
```

注意：`<main class="container">`、`.card`、`.btn`、`.badge`、`.text-dim` 等 class 名稱需與 `frontend/css/style.css` 中既有的通用樣式類別一致——實作時先確認這些 class 是否存在於 `style.css`，若名稱不同（例如沒有 `.text-dim` 而是用 `style="color: var(--text-dim)"`），調整為與現有頁面一致的寫法，維持「沿用既有 CSS、不新增大量樣式」的原則。

- [ ] **Step 3: 語法檢查**

Run: `node --check frontend/js/modules-meta.js` （已於 Task 7 確認；此步驟改為手動檢視 HTML 是否有未閉合標籤）

實際驗證方式：在瀏覽器開啟 `frontend/coming-soon.html?module=sandbox`，確認頁面正確顯示「Sandbox／自由練習環境／🔒 即將推出 (Phase 1)」。此驗證留待 Task 17 端對端測試一併執行。

- [ ] **Step 4: Commit**

```bash
git add frontend/coming-soon.html
git commit -m "feat: add coming-soon page for unreleased modules"
```

---

## Task 9: Story Mode 入口頁 — story.html

**Files:**
- Create: `frontend/story.html`
- Read: `frontend/index.html`（搬移來源，待 Task 11 改造）

- [ ] **Step 1: 閱讀現有 index.html 全文**

Read: `frontend/index.html` 全文（246 行，已於前一輪會話確認結構：`.hero-logo`/`.hero-story`/`.hero-cta`/`.chapters-row`/`.stats-row` + 打字動畫 script）。

- [ ] **Step 2: 建立 frontend/story.html**

將 `frontend/index.html` 的**完整內容**複製到新檔案 `frontend/story.html`，並做以下調整：
1. `<title>` 改為 `<title>Story Mode — EdgeRange</title>`
2. 在 `<body>` 開頭（所有現有內容之前）加入：
   ```html
   <div id="global-nav"></div>
   ```
3. 在既有的 `<script src="js/api.js"></script>`（或同等的 script 引入）之後加入：
   ```html
   <script src="js/nav.js"></script>
   ```
4. `.hero-cta` 中連結到 `map.html`/`scoreboard.html` 的部分維持不變
5. 打字動畫 script（`typeLoop()`）與 `.chapters-row`/`.stats-row` 內容維持不變

由於原始 `index.html` 內容已在前一輪會話完整讀取，實作時直接以該內容為基礎建立 `story.html`，僅套用上述 4 處調整。

- [ ] **Step 3: 驗證**

在瀏覽器開啟 `frontend/story.html`，確認：
- 全域導覽列顯示在頁面最上方
- Hero 區塊、章節卡片、統計數字、打字動畫均正常顯示
- 「進入遊戲」CTA 連結到 `map.html`

此驗證留待 Task 17 端對端測試一併執行。

- [ ] **Step 4: Commit**

```bash
git add frontend/story.html
git commit -m "feat: add story mode entry page (moved from former index.html)"
```

---

## Task 10: Hub 首頁 — index.html 改造（註冊表單 + 模組網格）

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/css/style.css`

- [ ] **Step 1: 新增 Hub 專用 CSS**

在 `frontend/css/style.css` 結尾加入：

```css
.auth-card {
  max-width: 400px;
  margin: 4rem auto;
  padding: 2rem;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.auth-card h1 {
  font-size: 1.4rem;
  letter-spacing: 2px;
  margin-bottom: 0.25rem;
}

.auth-card .subtitle {
  color: var(--text-dim);
  font-size: 0.85rem;
  margin-bottom: 1.5rem;
}

.auth-field {
  margin-bottom: 1rem;
}

.auth-field label {
  display: block;
  font-size: 0.8rem;
  color: var(--text-dim);
  margin-bottom: 0.3rem;
}

.auth-field input {
  width: 100%;
  background: var(--bg-dark);
  border: 1px solid var(--green-dim);
  color: var(--green);
  font-family: var(--font-mono);
  padding: 0.5rem 0.75rem;
  border-radius: 4px;
}

.avatar-picker {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-top: 0.4rem;
}

.avatar-picker .avatar-option {
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.4rem 0.6rem;
  cursor: pointer;
  font-size: 1.2rem;
  background: var(--bg-dark);
}

.avatar-picker .avatar-option.selected {
  border-color: var(--green);
  box-shadow: 0 0 0 1px var(--green);
}

.auth-hint {
  font-size: 0.7rem;
  color: var(--text-muted);
  margin-top: 0.6rem;
}

.module-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1rem;
  max-width: 960px;
  margin: 2rem auto;
  padding: 0 1rem;
}

.module-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1.25rem;
  text-decoration: none;
  color: var(--text-main);
  display: block;
}

.module-card .module-icon {
  font-size: 1.8rem;
}

.module-card .module-name {
  font-weight: bold;
  margin: 0.4rem 0;
}

.module-card .module-desc {
  color: var(--text-dim);
  font-size: 0.85rem;
}

.module-card.disabled {
  border-style: dashed;
  opacity: 0.55;
  cursor: pointer;
}

.module-progress-bar {
  margin-top: 0.6rem;
  background: var(--bg-hover);
  border-radius: 4px;
  height: 6px;
  overflow: hidden;
}

.module-progress-fill {
  background: var(--green);
  height: 100%;
}

.module-progress-label {
  font-size: 0.7rem;
  color: var(--text-dim);
  margin-top: 0.3rem;
}

.hub-welcome {
  max-width: 960px;
  margin: 2rem auto 0;
  padding: 0 1rem;
}

.hub-welcome h1 {
  font-size: 1.6rem;
}

.hub-welcome p {
  color: var(--text-dim);
  font-size: 0.9rem;
}
```

- [ ] **Step 2: 重寫 frontend/index.html**

```html
<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>EdgeRange</title>
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <div id="global-nav"></div>

  <main id="hub-root"></main>

  <script src="js/api.js"></script>
  <script src="js/modules-meta.js"></script>
  <script src="js/nav.js"></script>
  <script>
    const AVATARS = ['🦊', '🐧', '🐙', '🤖', '👾', '🐳', '🦉', '🐺'];
    let selectedAvatar = AVATARS[0];

    function renderAuthForm() {
      const root = document.getElementById('hub-root');
      root.innerHTML = `
        <div class="auth-card">
          <h1>▌EDGE://RANGE</h1>
          <div class="subtitle">建立你的探員檔案</div>
          <div class="auth-field">
            <label>學號 (Student ID)</label>
            <input type="text" id="input-student-id" placeholder="112xxxxxx">
          </div>
          <div class="auth-field">
            <label>暱稱 (顯示在排行榜)</label>
            <input type="text" id="input-name" placeholder="night_owl">
          </div>
          <div class="auth-field">
            <label>選擇頭像</label>
            <div class="avatar-picker" id="avatar-picker">
              ${AVATARS.map(a => `<span class="avatar-option${a === selectedAvatar ? ' selected' : ''}" data-avatar="${a}">${a}</span>`).join('')}
            </div>
          </div>
          <button class="btn" id="btn-register" style="width:100%;">[ 進入 EdgeRange ]</button>
          <div class="auth-hint">* 已有帳號？輸入相同學號即可取回身分</div>
        </div>
      `;

      document.querySelectorAll('.avatar-option').forEach(el => {
        el.addEventListener('click', () => {
          selectedAvatar = el.dataset.avatar;
          document.querySelectorAll('.avatar-option').forEach(o => o.classList.remove('selected'));
          el.classList.add('selected');
        });
      });

      document.getElementById('btn-register').addEventListener('click', async () => {
        const studentId = document.getElementById('input-student-id').value.trim();
        const name = document.getElementById('input-name').value.trim();

        if (!studentId || !name) {
          toast('請輸入學號與暱稱', 'error');
          return;
        }

        try {
          const result = await API.register(studentId, name, selectedAvatar);
          setToken(result.token);
          location.reload();
        } catch (e) {
          toast(`註冊失敗：${e.message}`, 'error');
        }
      });
    }

    function renderModuleGrid(progress) {
      const root = document.getElementById('hub-root');
      const completed = progress.rooms.filter(r => r.completed).length;
      const total = 13;
      const pct = Math.round(completed / total * 100);

      const cards = MODULES.map(mod => {
        if (mod.status === 'available') {
          return `
            <a class="module-card" href="${mod.href}">
              <div class="module-icon">${mod.icon}</div>
              <div class="module-name">${mod.name}</div>
              <div class="module-desc">${mod.desc}</div>
              <div class="module-progress-bar"><div class="module-progress-fill" style="width:${pct}%"></div></div>
              <div class="module-progress-label">${completed} / ${total} 完成 — 繼續闖關 →</div>
            </a>
          `;
        }
        return `
          <div class="module-card disabled" onclick="location.href='coming-soon.html?module=${mod.id}'">
            <div class="module-icon">${mod.icon}</div>
            <div class="module-name">${mod.name}</div>
            <div class="module-desc">${mod.desc}</div>
            <div class="module-progress-label">🔒 即將推出 (Phase ${mod.phase})</div>
          </div>
        `;
      }).join('');

      root.innerHTML = `
        <div class="hub-welcome">
          <h1>歡迎回來，${progress.name}</h1>
          <p>你已接管這座邊緣運算節點的維運與資安任務，選擇一個模組繼續執行</p>
        </div>
        <div class="module-grid">${cards}</div>
      `;
    }

    (async function init() {
      const profile = await getProfile();
      if (!profile) {
        renderAuthForm();
        return;
      }

      try {
        const progress = await API.player();
        renderModuleGrid(progress);
      } catch (e) {
        toast(`載入失敗：${e.message}`, 'error');
        renderAuthForm();
      }
    })();
  </script>
</body>
</html>
```

- [ ] **Step 3: 驗證**

在瀏覽器開啟 `frontend/index.html`：
- 未登入時應顯示「▌EDGE://RANGE」註冊卡片，含學號/暱稱輸入框與 8 個頭像選項
- 點擊頭像可切換選取狀態（綠色外框）
- 填寫學號與暱稱後點擊「[ 進入 EdgeRange ]」應呼叫 `/api/auth/register`、儲存 token 並重新整理
- 重新整理後應顯示「歡迎回來，{暱稱}」與 6 個模組卡片，Story Mode 顯示進度條，其餘 5 個顯示「🔒 即將推出 (Phase X)」

此驗證留待 Task 17 端對端測試一併執行。

- [ ] **Step 4: Commit**

```bash
git add frontend/index.html frontend/css/style.css
git commit -m "feat: rebuild hub homepage with registration form and module grid"
```

---

## Task 11: 更新 map.html — 全域導覽列與 /player/me

**Files:**
- Modify: `frontend/map.html`

- [ ] **Step 1: 閱讀現有 map.html 全文**

Read: `frontend/map.html` 全文（294 行，已於前一輪會話確認結構：行 123-131 為內嵌 nav，行 191-265 為 `loadMap()`）。

- [ ] **Step 2: 替換內嵌導覽列**

找到行 123-131 附近的內嵌 `<nav class="navbar">...</nav>` 區塊（含 `id="score-display"`），整段替換為：

```html
<div id="global-nav"></div>
```

- [ ] **Step 3: 在 script 引入處加入 nav.js**

找到既有的 `<script src="js/api.js"></script>`，在其後加入：

```html
<script src="js/nav.js"></script>
```

- [ ] **Step 4: 重寫 loadMap()**

找到 `loadMap()` 函式（約行 191-265），將開頭的 `requirePlayer()` → `player-greeting` → `Promise.all([API.rooms(), API.player(player), API.scoreboard()])` → `sb.find(...)` → `#score-display` 邏輯，改為：

```javascript
async function loadMap() {
  const profile = await requirePlayer();
  if (!profile) return;

  document.getElementById('player-greeting').textContent = `${profile.name}`;

  try {
    const [roomsMeta, progress] = await Promise.all([
      API.rooms(),
      API.player(),
    ]);

    const roomMap = {};
    roomsMeta.forEach(r => roomMap[r.id] = r);
    const doneSet = new Set(progress.rooms.filter(r=>r.completed).map(r=>r.id));
    const lockedSet = new Set(progress.rooms.filter(r=>r.locked).map(r=>r.id));

    const completedCount = doneSet.size;
    const totalMain = 13;
    const pct = Math.round(completedCount / totalMain * 100);
    document.getElementById('progress-section').style.display = 'flex';
    document.getElementById('progress-label').textContent = `進度 ${completedCount} / ${totalMain}`;
    document.getElementById('progress-fill').style.width = `${pct}%`;
    document.getElementById('stat-flags').textContent = progress.flags.length;
    document.getElementById('stat-achieve').textContent = progress.achievements.length;
    document.getElementById('stat-score').textContent = progress.score;

    const container = document.getElementById('map-container');
    container.innerHTML = '';
    // ... CHAPTERS/room-card 渲染迴圈，內容與目前 map.html 完全相同，
    //     沿用 roomMap/doneSet/lockedSet 變數，不需修改 ...
  } catch (e) {
    toast(`載入失敗：${e.message}`, 'error');
  }
}
```

實作時：保留原本 `loadMap()` 中 `try` 區塊內「`const container = ...` 之後到函式結尾」的所有程式碼（CHAPTERS/ROOM_DESCS 渲染迴圈）原封不動；僅替換函式開頭（`requirePlayer`/`player-greeting`/資料抓取/`#score-display` 相關）的部分為上方新版本。`#stat-score` 元素若 HTML 中不存在，需在 HTML 中對應位置新增（檢查 `progress-section` 周圍的統計數字 DOM 結構，補上 `id="stat-score"` 的元素，樣式比照 `stat-flags`/`stat-achieve`）。

- [ ] **Step 5: 確認 HTML 中有 #stat-score 元素**

Read: `frontend/map.html` 中 `progress-section`／統計數字相關的 HTML 區塊（`stat-flags`/`stat-achieve` 周圍），若沒有對應分數的元素，比照既有結構新增一個含 `id="stat-score"` 的統計項目（例如標籤「分數」），並套用既有的統計項目 CSS class。

- [ ] **Step 6: 驗證**

在瀏覽器開啟 `frontend/map.html`（已登入狀態）：
- 全域導覽列顯示，且「Sandbox」等項目連到 `coming-soon.html`
- `player-greeting` 顯示暱稱
- 進度條、FLAGS/成就/分數統計正確顯示
- 房間卡片正常渲染、`updateRoomBadges()` 輪詢正常

此驗證留待 Task 17 端對端測試一併執行。

- [ ] **Step 7: Commit**

```bash
git add frontend/map.html
git commit -m "feat: update map page for global nav and token-based player progress"
```

---

## Task 12: 更新 play.html — 全域導覽列與分數顯示

**Files:**
- Modify: `frontend/play.html`

- [ ] **Step 1: 閱讀現有 play.html 全文**

Read: `frontend/play.html` 全文（478 行，已於前一輪會話確認：CSS `.play-layout` 行 12-16，`.play-header` 行 195-201，hint click handler 行 358，`updateScore()` 行 401-410，`submitFlag()`/`load` listener 行 422/469，script 引入行 255-256）。

- [ ] **Step 2: 調整 .play-layout grid**

找到：

```css
.play-layout {
  display: grid;
  grid-template-rows: auto 1fr;
  height: 100vh;
}
```

改為：

```css
.play-layout {
  display: grid;
  grid-template-rows: auto auto 1fr;
  height: 100vh;
}
```

- [ ] **Step 3: 加入全域導覽列掛載點**

找到 `.play-header` 開始的 div（約行 195-201），在其**之前**、`.play-layout` 容器內的第一個子元素位置加入：

```html
<div id="global-nav"></div>
```

- [ ] **Step 4: 移除 hint handler 中的 player 檢查**

找到約行 358 附近：

```javascript
const player = getPlayer();
if (!player) { toast('請先設定名字', 'error'); return; }
```

整段刪除（依賴既有 `apiFetch` 在 401 時拋出例外、由該 handler 既有的 `catch(e) { toast(e.message, 'error'); }`（約行 383）處理）。

- [ ] **Step 5: 重寫 updateScore()**

找到約行 401-410 的 `updateScore()`：

```javascript
async function updateScore() {
  const player = getPlayer();
  if (!player) return;
  try {
    const sb = await API.scoreboard();
    const me = sb.find(p => p.name === player);
    if (me) document.getElementById('score-chip').textContent = `💎 ${me.score}`;
  } catch (e) {}
}
```

改為：

```javascript
async function updateScore() {
  if (!getToken()) return;
  try {
    const progress = await API.player();
    document.getElementById('score-chip').textContent = `💎 ${progress.score}`;
  } catch (e) {}
}
```

- [ ] **Step 6: 加入 nav.js script 引入**

找到既有的：

```html
<script src="js/api.js"></script>
<script src="js/terminal.js"></script>
```

改為：

```html
<script src="js/api.js"></script>
<script src="js/nav.js"></script>
<script src="js/terminal.js"></script>
```

- [ ] **Step 7: 確認 submitFlag()/load listener 不需改動**

Read 確認約行 422（`submitFlag()`）與行 469（`window.addEventListener('load', ...)`）中 `await requirePlayer()` 的呼叫與 `if (!player) return;` 判斷——`requirePlayer()` 現在回傳 `{student_id, name, avatar}` 物件或 `null`，原本的 truthy 判斷邏輯無需修改，保持原樣。

- [ ] **Step 8: 驗證**

在瀏覽器開啟任一房間的 `play.html?room=room0`（需先登入）：
- 全域導覽列顯示在 `.play-header` 上方，且不破壞 `100vh`/`overflow:hidden` 的終端機版面
- `score-chip` 顯示正確分數
- 提示按鈕在未登入時顯示錯誤 toast（而非 JS 例外）
- FLAG 提交流程正常

此驗證留待 Task 17 端對端測試一併執行。

- [ ] **Step 9: Commit**

```bash
git add frontend/play.html
git commit -m "feat: update play page for global nav and token-based score display"
```

---

## Task 13: 更新 scoreboard.html — 全域導覽列

**Files:**
- Modify: `frontend/scoreboard.html`

- [ ] **Step 1: 閱讀現有 scoreboard.html 全文**

Read: `frontend/scoreboard.html` 全文（139 行，已於前一輪會話確認：行 52-59 為內嵌 nav，`refresh()` 行 79-132）。

- [ ] **Step 2: 替換內嵌導覽列**

找到行 52-59 附近的內嵌 `<nav class="navbar">...</nav>`，整段替換為：

```html
<div id="global-nav"></div>
```

- [ ] **Step 3: 加入 nav.js script 引入**

找到既有的 `<script src="js/api.js"></script>`，在其後加入：

```html
<script src="js/nav.js"></script>
```

- [ ] **Step 4: 確認 refresh() 不需改動**

`refresh()`（約行 79-132）呼叫 `API.scoreboard()`，回傳資料結構（`p.rank/p.avatar/p.name/p.score/p.flags/p.achievements/p.last_submit`）在 Task 4 重寫後維持不變（僅排除新增的 `student_id`，scoreboard.html 本來就未使用該欄位）。不需修改 `refresh()` 程式碼。

- [ ] **Step 5: 驗證**

在瀏覽器開啟 `frontend/scoreboard.html`：
- 全域導覽列顯示，且「Scoreboard」項目標示為 active
- 排行榜表格每 15 秒自動刷新，顯示排名/頭像/暱稱/分數/FLAGS/成就/最後提交時間

此驗證留待 Task 17 端對端測試一併執行。

- [ ] **Step 6: Commit**

```bash
git add frontend/scoreboard.html
git commit -m "feat: update scoreboard page for global nav"
```

---

## Task 14: 更新 achievements.html — 全域導覽列與 player.name

**Files:**
- Modify: `frontend/achievements.html`

- [ ] **Step 1: 閱讀現有 achievements.html 全文**

Read: `frontend/achievements.html` 全文（139 行，已於前一輪會話確認：行 55-62 為內嵌 nav，`loadAchievements()` 行 91-135）。

- [ ] **Step 2: 替換內嵌導覽列**

找到行 55-62 附近的內嵌 `<nav class="navbar">...</nav>`，整段替換為：

```html
<div id="global-nav"></div>
```

- [ ] **Step 3: 加入 nav.js script 引入**

找到既有的 `<script src="js/api.js"></script>`，在其後加入：

```html
<script src="js/nav.js"></script>
```

- [ ] **Step 4: 更新 loadAchievements()**

找到 `loadAchievements()`（約行 91-135），其中：

```javascript
const player = await requirePlayer();
const [allAchievements, playerData] = await Promise.all([
  API.achievements(),
  player ? API.player(player) : Promise.resolve({achievements: []}),
]);
document.getElementById('player-label').textContent = `${player} 的成就 — ...`;
```

改為：

```javascript
const profile = await requirePlayer();
if (!profile) return;

const [allAchievements, playerData] = await Promise.all([
  API.achievements(),
  API.player(),
]);
document.getElementById('player-label').textContent = `${profile.name} 的成就 — ...`;
```

實作時：保留 `player-label` 文字模板中 `...` 部分（例如「共解鎖 X / Y 個」之類的既有內容）不變，僅將 `${player}` 改為 `${profile.name}`，並將 `API.player(player)` 改為 `API.player()`（無參數）。`playerData.achievements` 後續使用方式維持不變。

- [ ] **Step 5: 驗證**

在瀏覽器開啟 `frontend/achievements.html`：
- 全域導覽列顯示
- `player-label` 顯示「{暱稱} 的成就 — ...」
- 成就清單正確標示已解鎖/未解鎖

此驗證留待 Task 17 端對端測試一併執行。

- [ ] **Step 6: Commit**

```bash
git add frontend/achievements.html
git commit -m "feat: update achievements page for global nav and player profile"
```

---

## Task 15: 更新 admin.html — 新增學號欄位

**Files:**
- Modify: `frontend/admin.html`

- [ ] **Step 1: 閱讀現有 admin.html 全文**

Read: `frontend/admin.html` 全文（191 行，已於前一輪會話確認：行 28-31 為專屬 admin nav（不更動），行 70 為 scoreboard-table 表頭，行 102-104 為列模板，行 113-122 為 submissions/hints 表格）。

- [ ] **Step 2: 新增表頭欄位**

找到：

```html
<thead><tr><th>名次</th><th>玩家</th><th>分數</th><th>FLAGS</th><th>最後提交</th></tr></thead>
```

改為：

```html
<thead><tr><th>名次</th><th>學號</th><th>玩家</th><th>分數</th><th>FLAGS</th><th>最後提交</th></tr></thead>
```

- [ ] **Step 3: 新增列模板欄位**

找到：

```javascript
<tr><td>${i+1}</td><td>${p.name}</td><td style="color:var(--yellow)">${p.total_score}</td><td>${p.flags_found}</td><td ...>${p.last_submit||'—'}</td></tr>
```

改為：

```javascript
<tr><td>${i+1}</td><td>${p.student_id}</td><td>${p.name}</td><td style="color:var(--yellow)">${p.total_score}</td><td>${p.flags_found}</td><td ...>${p.last_submit||'—'}</td></tr>
```

實作時保留原本 `${p.last_submit||'—'}` 前的 `<td ...>` 屬性內容（例如 `style`/`class`）不變，僅插入 `<td>${p.student_id}</td>` 在 `${i+1}` 之後。

- [ ] **Step 4: 確認 submissions/hints 表格不需改動**

`s.player_name`/`h.player_name`（約行 113-122）顯示的值現在是 `student_id`，這對老師後台查詢/評分是有用的資訊，欄位名稱與程式碼不需修改。

- [ ] **Step 5: 驗證**

在瀏覽器開啟 `frontend/admin.html`（輸入 admin token）：
- Scoreboard 表格新增「學號」欄位，顯示在「名次」之後
- Submissions/Hints 表格的「玩家」欄位顯示學號值

此驗證留待 Task 17 端對端測試一併執行。

- [ ] **Step 6: Commit**

```bash
git add frontend/admin.html
git commit -m "feat: show student_id column in admin dashboard"
```

---

## Task 16: 後端完整測試套件確認

**Files:**
- Test: `scoreboard-api/tests/`（全部）

- [ ] **Step 1: 執行完整 pytest**

Run: `cd scoreboard-api && python -m pytest -v`
Expected: 全部測試 PASS（Task 1-4 累計共 18 個測試：5 + 5 + 8）

- [ ] **Step 2: 若有測試失敗，逐一排查**

若有 FAIL，依序檢查：
- `test_database.py` 失敗 → 回到 Task 2 確認 `database.py` 中 `register_or_login`/`get_player_by_*`/`get_scoreboard` 實作是否與測試期待的回傳結構一致
- `test_auth_api.py` 失敗 → 回到 Task 3 確認 `get_current_player`/`/auth/register`/`/auth/me` 的 HTTP 狀態碼與回傳欄位
- `test_gameplay_api.py` 失敗 → 回到 Task 4 確認 `/submit`/`/hint`/`/enter`/`/player/me`/`/scoreboard`/`/admin/dashboard` 的 dependency 注入與欄位命名

- [ ] **Step 3: Commit（僅在有修正時）**

```bash
git add scoreboard-api/
git commit -m "fix: address test failures in auth/gameplay refactor"
```

（若 Step 1 已全數通過，跳過此步驟，無需空 commit。）

---

## Task 17: 端對端驗證

**Files:** 無程式碼變更，僅驗證

- [ ] **Step 1: 啟動完整 stack**

Run: `cd "C:\Users\clair\OneDrive\Desktop\Linux與邊緣運算\project\escape-docker" && bash start.sh`
Expected: 所有容器啟動成功（scoreboard-api、terminal-gateway、nginx 等，依 `docker compose ps` 確認皆為 `Up`/`running`）

- [ ] **Step 2: 驗證 Hub 註冊流程**

瀏覽器開啟 `http://localhost/`：
- 應顯示 EdgeRange 註冊表單
- 輸入學號 `112000099`、暱稱 `test_agent`、選擇頭像 🤖，點擊「[ 進入 EdgeRange ]」
- 應導向已登入狀態的模組網格，顯示「歡迎回來，test_agent」
- Story Mode 卡片顯示「0 / 13 完成 — 繼續闖關 →」
- 其餘 5 個模組卡片點擊後導向 `coming-soon.html`，顯示對應 Phase 說明文字

- [ ] **Step 3: 驗證 Story Mode 與 FLAG 提交**

點擊 Story Mode 卡片：
- 進入 `story.html`，顯示原本的故事介紹內容與全域導覽列
- 點擊「進入遊戲」CTA 進入 `map.html`，顯示房間地圖、進度條 0%、FLAGS=0、成就=0、分數=0
- 進入 Room 0 (`play.html?room=room0`)，完成關卡並提交正確 FLAG
- 確認分數、FLAGS 計數即時更新（`score-chip`／`map.html` 統計）

- [ ] **Step 4: 驗證同學號取回身分**

清除瀏覽器 localStorage 中的 `edgerange_token`（或開啟無痕視窗），重新以**相同學號** `112000099`、不同暱稱 `test_agent_2` 註冊：
- `/auth/register` 應回傳與第一次相同的 `token`
- 登入後模組網格應顯示先前的進度（Story Mode 已完成 Room 0）

- [ ] **Step 5: 驗證管理後台**

瀏覽器開啟 `http://localhost/admin.html`，輸入 admin token：
- Scoreboard 表格應顯示「學號」欄位，值為 `112000099`
- Submissions 表格「玩家」欄位顯示 `112000099`

- [ ] **Step 6: 驗證全域導覽列一致性**

在 `story.html`/`map.html`/`scoreboard.html`/`achievements.html` 之間切換：
- 全域導覽列在每個頁面皆正確顯示
- 右側顯示登入玩家的頭像＋暱稱（🤖 test_agent_2）
- 各模組連結（Sandbox/Forensics Lab/Network Lab/Ops Center/Maker Mode）皆能正確跳轉到 `coming-soon.html`

- [ ] **Step 7: 清理測試資料（可選）**

若不需保留測試帳號 `112000099`，可刪除 `scoreboard-api/data/scores.db` 並重新啟動容器以重置資料庫：

```bash
docker compose down
rm -f scoreboard-api/data/scores.db
bash start.sh
```

---

**所有任務完成後，整個 EdgeRange Hub Phase 1（玩家系統升級 + Hub 骨架 + Story Mode 子模組化 + 全域導覽列）即告完成，可進入下一個 spec（Security Playground 或 Edge Operations Center）。**
