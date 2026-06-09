import sqlite3
import os
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), "data", "scores.db")


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    with get_conn() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS players (
                name        TEXT PRIMARY KEY,
                avatar      TEXT DEFAULT '🐳',
                joined_at   TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS submissions (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                player_name  TEXT NOT NULL,
                flag_id      TEXT NOT NULL,
                room_id      TEXT NOT NULL,
                points       INTEGER NOT NULL,
                submitted_at TEXT DEFAULT (datetime('now')),
                UNIQUE(player_name, flag_id)
            );

            CREATE TABLE IF NOT EXISTS hint_usage (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                player_name TEXT NOT NULL,
                room_id     TEXT NOT NULL,
                hint_level  INTEGER NOT NULL,
                cost        INTEGER NOT NULL,
                used_at     TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS achievements (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                player_name    TEXT NOT NULL,
                achievement_id TEXT NOT NULL,
                earned_at      TEXT DEFAULT (datetime('now')),
                UNIQUE(player_name, achievement_id)
            );

            CREATE TABLE IF NOT EXISTS room_timings (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                player_name TEXT NOT NULL,
                room_id     TEXT NOT NULL,
                entered_at  TEXT NOT NULL,
                completed_at TEXT,
                UNIQUE(player_name, room_id)
            );
        """)


# ─── Players ───

def ensure_player(name: str, avatar: str = "🐳"):
    with get_conn() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO players (name, avatar) VALUES (?, ?)",
            (name, avatar)
        )


def get_all_players(conn):
    return conn.execute("SELECT * FROM players ORDER BY joined_at").fetchall()


# ─── Submissions ───

def already_submitted(player_name: str, flag_id: str) -> bool:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT 1 FROM submissions WHERE player_name=? AND flag_id=?",
            (player_name, flag_id)
        ).fetchone()
        return row is not None


def add_submission(player_name: str, flag_id: str, room_id: str, points: int):
    with get_conn() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO submissions (player_name, flag_id, room_id, points) VALUES (?,?,?,?)",
            (player_name, flag_id, room_id, points)
        )


def get_player_flags(player_name: str) -> list[str]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT flag_id FROM submissions WHERE player_name=?", (player_name,)
        ).fetchall()
        return [r["flag_id"] for r in rows]


def get_first_solver(flag_id: str) -> str | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT player_name FROM submissions WHERE flag_id=? ORDER BY submitted_at LIMIT 1",
            (flag_id,)
        ).fetchone()
        return row["player_name"] if row else None


# ─── Scoreboard ───

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


# ─── Hints ───

def get_hint_cost_for_player(player_name: str, room_id: str) -> int:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT COALESCE(SUM(cost), 0) as total FROM hint_usage WHERE player_name=? AND room_id=?",
            (player_name, room_id)
        ).fetchone()
        return row["total"] if row else 0


def record_hint(player_name: str, room_id: str, hint_level: int, cost: int):
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO hint_usage (player_name, room_id, hint_level, cost) VALUES (?,?,?,?)",
            (player_name, room_id, hint_level, cost)
        )


def get_player_hints_used(player_name: str, room_id: str) -> list[int]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT hint_level FROM hint_usage WHERE player_name=? AND room_id=? ORDER BY hint_level",
            (player_name, room_id)
        ).fetchall()
        return [r["hint_level"] for r in rows]


# ─── Achievements ───

def add_achievement(player_name: str, achievement_id: str):
    with get_conn() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO achievements (player_name, achievement_id) VALUES (?,?)",
            (player_name, achievement_id)
        )


def get_player_achievements(player_name: str) -> list[str]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT achievement_id FROM achievements WHERE player_name=?", (player_name,)
        ).fetchall()
        return [r["achievement_id"] for r in rows]


# ─── Room Timings ───

def record_room_entry(player_name: str, room_id: str):
    with get_conn() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO room_timings (player_name, room_id, entered_at) VALUES (?,?,datetime('now'))",
            (player_name, room_id)
        )


def record_room_completion(player_name: str, room_id: str):
    with get_conn() as conn:
        conn.execute(
            "UPDATE room_timings SET completed_at=datetime('now') WHERE player_name=? AND room_id=? AND completed_at IS NULL",
            (player_name, room_id)
        )


def get_room_duration_seconds(player_name: str, room_id: str) -> int | None:
    with get_conn() as conn:
        row = conn.execute("""
            SELECT CAST((julianday(completed_at) - julianday(entered_at)) * 86400 AS INTEGER) as secs
            FROM room_timings
            WHERE player_name=? AND room_id=? AND completed_at IS NOT NULL
        """, (player_name, room_id)).fetchone()
        return row["secs"] if row else None


# ─── Admin ───

def get_all_submissions():
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM submissions ORDER BY submitted_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]


def get_all_hint_usage():
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM hint_usage ORDER BY used_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]
