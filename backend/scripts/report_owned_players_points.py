#!/usr/bin/env python3
"""
Report owned players for a manager with total_points and bonus in separate columns.

Usage:
    cd backend && python scripts/report_owned_players_points.py [MANAGER_ID] [GAMEWEEK]

Defaults: MANAGER_ID=344182, GAMEWEEK=current gameweek.

Uses SUPABASE_URL and SUPABASE_KEY from .env.
"""

import sys
from pathlib import Path

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env")

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
from config import Config
from database.supabase_client import SupabaseClient


def main():
    manager_id = int(sys.argv[1]) if len(sys.argv) > 1 else 344182
    gw_arg = int(sys.argv[2]) if len(sys.argv) > 2 else None

    config = Config()
    try:
        config.validate()
    except ValueError as e:
        print(f"Config error: {e}")
        sys.exit(1)

    client = SupabaseClient(config).client

    # Resolve gameweek
    if gw_arg is not None:
        gw = gw_arg
        gw_name = f"GW{gw}"
    else:
        r = client.table("gameweeks").select("id, name").eq("is_current", True).limit(1).execute()
        if not r.data:
            print("No current gameweek found.")
            sys.exit(1)
        gw = r.data[0]["id"]
        gw_name = r.data[0].get("name", f"GW{gw}")

    # Picks for manager (position order)
    picks_r = client.table("manager_picks").select(
        "position, player_id, is_captain, is_vice_captain, multiplier"
    ).eq("manager_id", manager_id).eq("gameweek", gw).order("position").execute()
    picks = picks_r.data or []
    if not picks:
        print(f"No picks for manager {manager_id} in {gw_name}.")
        sys.exit(0)

    player_ids = [p["player_id"] for p in picks]

    # Player names and team
    players_r = client.table("players").select(
        "fpl_player_id, web_name, teams(short_name)"
    ).in_("fpl_player_id", player_ids).execute()
    players = {p["fpl_player_id"]: p for p in (players_r.data or [])}

    # Stats: total_points, bonus
    stats_r = client.table("player_gameweek_stats").select(
        "player_id, total_points, bonus"
    ).eq("gameweek", gw).in_("player_id", player_ids).execute()
    stats = {s["player_id"]: s for s in (stats_r.data or [])}

    # Build rows: position, name, team, total_points, bonus
    rows = []
    for p in picks:
        pid = p["player_id"]
        pos = p["position"]
        cap = " (C)" if p.get("is_captain") else (" (V)" if p.get("is_vice_captain") else "")
        pl = players.get(pid, {})
        name = (pl.get("web_name") or "?") + cap
        team = pl.get("teams") or {}
        short = team.get("short_name", "?") if isinstance(team, dict) else "?"
        st = stats.get(pid, {})
        total_pts = st.get("total_points")
        bonus_pts = st.get("bonus")
        if total_pts is None:
            total_pts = ""
        else:
            total_pts = int(total_pts)
        if bonus_pts is None:
            bonus_pts = ""
        else:
            bonus_pts = int(bonus_pts)
        rows.append((pos, name, short, total_pts, bonus_pts))

    # Column widths for alignment
    max_name = max(len(r[1]) for r in rows) if rows else 10
    max_team = max(len(str(r[2])) for r in rows) if rows else 3

    header = (
        f"{'Pos':<4} {'Player':<{max_name}} {'Team':<{max_team}} "
        f"{'total_pts':>10} {'bonus':>8}"
    )
    sep = "-" * len(header)
    print(f"Manager {manager_id} — {gw_name} — Owned players (total_points | bonus separate)\n")
    print(header)
    print(sep)
    for pos, name, team, total_pts, bonus_pts in rows:
        t_str = str(total_pts) if total_pts != "" else "—"
        b_str = str(bonus_pts) if bonus_pts != "" else "—"
        print(f"{pos:<4} {name:<{max_name}} {team:<{max_team}} {t_str:>10} {b_str:>8}")
    print(sep)
    total_pts_sum = sum(r[3] for r in rows if r[3] != "")
    bonus_sum = sum(r[4] for r in rows if r[4] != "")
    print(f"{'':<4} {'(sum)':<{max_name}} {'':<{max_team}} {total_pts_sum:>10} {bonus_sum:>8}")


if __name__ == "__main__":
    main()
