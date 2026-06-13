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
