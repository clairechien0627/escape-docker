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
