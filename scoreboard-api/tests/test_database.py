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
