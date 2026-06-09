from database import (
    get_player_flags, get_player_achievements, add_achievement,
    get_room_duration_seconds, get_first_solver, get_player_hints_used
)

ALL_ACHIEVEMENTS = [
    {"id": "speed_demon",    "name": "Speed Demon",    "icon": "⚡", "desc": "任一 Room 3 分鐘內完成",          "points": 100},
    {"id": "no_hints_ch1",   "name": "Pure Chapter 1", "icon": "🧠", "desc": "Chapter 1 全部不用提示完成",      "points": 150},
    {"id": "no_hints_all",   "name": "No Crutches",    "icon": "💪", "desc": "所有主關不用提示完成",            "points": 500},
    {"id": "first_blood",    "name": "First Blood",    "icon": "🩸", "desc": "第一個完成任一關卡",              "points": 200},
    {"id": "all_clear",      "name": "All Clear",      "icon": "🏆", "desc": "完成全部 12 個主關",              "points": 500},
    {"id": "ghost_hunter",   "name": "Ghost Hunter",   "icon": "👻", "desc": "找到兩個 Secret Room",            "points": 300},
    {"id": "completionist",  "name": "Completionist",  "icon": "🌟", "desc": "100% 完成率（含 Secret Room）",   "points": 1000},
    {"id": "docker_master",  "name": "Docker Master",  "icon": "🐳", "desc": "完成全部 Chapter 3 關卡",         "points": 300},
    {"id": "escape_artist",  "name": "Escape Artist",  "icon": "🔓", "desc": "完成 Final Boss",                "points": 200},
    {"id": "log_detective",  "name": "Log Detective",  "icon": "🔍", "desc": "完成 Room 10 (The Evidence)",    "points": 100},
]

ACHIEVEMENT_MAP = {a["id"]: a for a in ALL_ACHIEVEMENTS}

CHAPTER_ROOMS = {
    1: ["room0", "room1", "room2"],
    2: ["room3", "room4", "room5"],
    3: ["room6", "room7", "room8", "room9"],
    4: ["room10", "room11"],
}
ALL_MAIN_ROOMS = [r for rooms in CHAPTER_ROOMS.values() for r in rooms] + ["final"]
SECRET_ROOMS = ["secret-a", "secret-b"]


def check_and_award(player_name: str, room_id: str, flag_id: str) -> list[dict]:
    """完成一個房間後檢查並頒發成就，回傳新取得的成就列表"""
    earned = get_player_achievements(player_name)
    new_achievements = []

    def award(aid: str):
        if aid not in earned:
            add_achievement(player_name, aid)
            new_achievements.append(ACHIEVEMENT_MAP[aid])

    # First Blood
    if get_first_solver(flag_id) == player_name:
        award("first_blood")

    # Speed Demon（3 分鐘 = 180 秒）
    secs = get_room_duration_seconds(player_name, room_id)
    if secs is not None and secs <= 180:
        award("speed_demon")

    flags_done = get_player_flags(player_name)
    flag_ids_done = set(flags_done)

    # Chapter 1 no hints
    ch1_flags = {"FLAG0", "FLAG1", "FLAG2"}
    if ch1_flags.issubset(flag_ids_done):
        hints_used = any(
            get_player_hints_used(player_name, r)
            for r in CHAPTER_ROOMS[1]
        )
        if not hints_used:
            award("no_hints_ch1")

    # All main rooms
    all_main_flag_ids = {f"FLAG{i}" for i in range(12)} | {"FINAL"}
    if all_main_flag_ids.issubset(flag_ids_done):
        award("all_clear")
        hints_used_any = any(
            get_player_hints_used(player_name, r)
            for r in ALL_MAIN_ROOMS
        )
        if not hints_used_any:
            award("no_hints_all")

    # Ghost Hunter
    if {"SECRETA", "SECRETB"}.issubset(flag_ids_done):
        award("ghost_hunter")

    # Completionist
    all_flags = all_main_flag_ids | {"SECRETA", "SECRETB"}
    if all_flags.issubset(flag_ids_done):
        award("completionist")

    # Docker Master
    ch3_flags = {"FLAG6", "FLAG7", "FLAG8", "FLAG9"}
    if ch3_flags.issubset(flag_ids_done):
        award("docker_master")

    # Escape Artist
    if "FINAL" in flag_ids_done:
        award("escape_artist")

    # Log Detective
    if "FLAG10" in flag_ids_done:
        award("log_detective")

    return new_achievements
