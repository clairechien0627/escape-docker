import os
from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator
from typing import Optional

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


# ─────────────────────────────────────────────
# 玩家
# ─────────────────────────────────────────────

@app.post("/register")
def register(req: RegisterRequest):
    db.ensure_player(req.name, req.avatar or "🐳")
    return {"ok": True, "name": req.name}


# ─────────────────────────────────────────────
# FLAG 提交
# ─────────────────────────────────────────────

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


# ─────────────────────────────────────────────
# 排行榜
# ─────────────────────────────────────────────

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


# ─────────────────────────────────────────────
# 玩家進度
# ─────────────────────────────────────────────

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


@app.get("/hints/{room_id}")
def get_hints_meta(room_id: str):
    room_hints = HINTS.get(room_id, [])
    return [{"level": h["level"], "cost": h["cost"]} for h in room_hints]


# ─────────────────────────────────────────────
# 計時
# ─────────────────────────────────────────────

@app.post("/enter")
def enter_room(req: RoomEntryRequest):
    db.ensure_player(req.player_name)
    db.record_room_entry(req.player_name, req.room_id)
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
