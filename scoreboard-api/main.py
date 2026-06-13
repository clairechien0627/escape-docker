import os
from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator

import database as db
from flags import FLAGS, ROOM_META, HINTS
from achievements import check_and_award, ALL_ACHIEVEMENTS

app = FastAPI(title="Escape Docker — Scoreboard API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "admin_dev_token")

@app.on_event("startup")
def startup():
    db.init_db()


# ─────────────────────────────────────────────
# Models
# ─────────────────────────────────────────────

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


class SubmitRequest(BaseModel):
    flag: str


class HintRequest(BaseModel):
    room_id: str
    level: int  # 1, 2, 3


class RoomEntryRequest(BaseModel):
    room_id: str


def get_current_player(authorization: str = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")

    token = authorization.removeprefix("Bearer ").strip()
    player = db.get_player_by_token(token)
    if player is None:
        raise HTTPException(status_code=401, detail="Invalid token")

    return player


# ─────────────────────────────────────────────
# 玩家
# ─────────────────────────────────────────────

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


# ─────────────────────────────────────────────
# FLAG 提交
# ─────────────────────────────────────────────

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


# ─────────────────────────────────────────────
# 排行榜
# ─────────────────────────────────────────────

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


# ─────────────────────────────────────────────
# 玩家進度
# ─────────────────────────────────────────────

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


# ─────────────────────────────────────────────
# 房間資料（給地圖用）
# ─────────────────────────────────────────────

@app.get("/rooms")
def list_rooms():
    return ROOM_META


# ─────────────────────────────────────────────
# 提示系統
# ─────────────────────────────────────────────

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


@app.get("/hints/{room_id}")
def get_hints_meta(room_id: str):
    room_hints = HINTS.get(room_id, [])
    return [{"level": h["level"], "cost": h["cost"]} for h in room_hints]


# ─────────────────────────────────────────────
# 計時
# ─────────────────────────────────────────────

@app.post("/enter")
def enter_room(req: RoomEntryRequest, player=Depends(get_current_player)):
    db.record_room_entry(player["student_id"], req.room_id)
    return {"ok": True}


# ─────────────────────────────────────────────
# 成就
# ─────────────────────────────────────────────

@app.get("/achievements")
def list_achievements():
    return ALL_ACHIEVEMENTS


# ─────────────────────────────────────────────
# Admin Panel
# ─────────────────────────────────────────────

def check_admin(token: str):
    if token != ADMIN_TOKEN:
        raise HTTPException(status_code=403, detail="Invalid admin token")


@app.get("/admin/dashboard")
def admin_dashboard(x_admin_token: str = Header(None)):
    check_admin(x_admin_token)
    return {
        "scoreboard": db.get_scoreboard(),
        "submissions": db.get_all_submissions(),
        "hint_usage": db.get_all_hint_usage(),
    }


@app.get("/admin/flags-info")
def admin_flags_info(x_admin_token: str = Header(None)):
    check_admin(x_admin_token)
    return [
        {"flag": k, **v}
        for k, v in FLAGS.items()
    ]
