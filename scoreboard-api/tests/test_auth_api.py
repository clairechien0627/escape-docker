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
