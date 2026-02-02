#!/usr/bin/env python3
"""
Verify Haaland total points from owned for manager 344182 (same logic as app).

1. Queries v_player_owned_leaderboard_with_bench (what the UI uses for "ALL" filter).
2. Recomputes from manager_picks + player_gameweek_stats:
   - XI only (position <= 11): matches view logic.
   - All positions: includes bench (script baseline).
Prints all values to investigate 349 vs 291 discrepancy.

Usage:
    cd backend && python3 scripts/verify_haaland_total.py [MANAGER_ID]

Defaults: MANAGER_ID=344182. Uses SUPABASE_URL and SUPABASE_KEY from .env.
"""

import os
import sys
from pathlib import Path

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env")
from supabase import create_client


def main():
    manager_id = int(sys.argv[1]) if len(sys.argv) > 1 else 344182
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_KEY")
    if not url or not key:
        print("Missing SUPABASE_URL or key")
        sys.exit(1)
    c = create_client(url, key)

    # Haaland
    r = c.table("players").select("fpl_player_id, web_name").ilike("web_name", "%Haaland%").execute()
    if not r.data:
        print("Haaland not found in players")
        sys.exit(1)
    haaland_id = r.data[0]["fpl_player_id"]
    print(f"Haaland fpl_player_id: {haaland_id}")

    # 1) What the UI sees: view (ALL filter uses v_player_owned_leaderboard_with_bench)
    try:
        view_rows = (
            c.table("v_player_owned_leaderboard_with_bench")
            .select("player_id, player_name, total_points")
            .eq("manager_id", manager_id)
            .eq("player_id", haaland_id)
            .execute()
            .data
            or []
        )
        view_total = view_rows[0]["total_points"] if view_rows else None
        print(f"View (v_player_owned_leaderboard_with_bench) Haaland total_points: {view_total}")
    except Exception as e:
        print(f"View query failed: {e}")
        view_total = None

    # 2) Recompute from picks + stats
    picks = (
        c.table("manager_picks")
        .select(
            "gameweek, position, player_id, multiplier, was_auto_subbed_in, auto_sub_replaced_player_id"
        )
        .eq("manager_id", manager_id)
        .order("gameweek")
        .execute()
        .data
        or []
    )
    if not picks:
        print(f"No picks for manager {manager_id}")
        sys.exit(0)
    gameweeks = list({p["gameweek"] for p in picks})
    player_ids = list(
        {p["player_id"] for p in picks}
        | {p["auto_sub_replaced_player_id"] for p in picks if p.get("auto_sub_replaced_player_id")}
    )

    stats = (
        c.table("player_gameweek_stats")
        .select("player_id, gameweek, total_points")
        .in_("player_id", player_ids)
        .in_("gameweek", gameweeks)
        .execute()
        .data
        or []
    )
    stats_map = {(s["player_id"], s["gameweek"]): s["total_points"] for s in stats}

    # XI only (position <= 11) - same as v_player_owned_leaderboard
    total_xi = {}
    for p in picks:
        if p.get("position", 99) > 11:
            continue
        gw = p["gameweek"]
        if p.get("was_auto_subbed_in") and p.get("auto_sub_replaced_player_id"):
            eff_id = p["auto_sub_replaced_player_id"]
        else:
            eff_id = p["player_id"]
        pts = stats_map.get((eff_id, gw), 0)
        mult = p.get("multiplier") or 1
        total_xi[eff_id] = total_xi.get(eff_id, 0) + pts * mult

    # All positions (including bench)
    total_all = {}
    for p in picks:
        gw = p["gameweek"]
        if p.get("was_auto_subbed_in") and p.get("auto_sub_replaced_player_id"):
            eff_id = p["auto_sub_replaced_player_id"]
        else:
            eff_id = p["player_id"]
        pts = stats_map.get((eff_id, gw), 0)
        mult = p.get("multiplier") or 1
        total_all[eff_id] = total_all.get(eff_id, 0) + pts * mult

    haaland_xi = total_xi.get(haaland_id, 0)
    haaland_all = total_all.get(haaland_id, 0)
    print(f"Recomputed XI only (position<=11): {haaland_xi}")
    print(f"Recomputed all positions (incl. bench): {haaland_all}")

    # Summary
    print()
    if view_total is not None:
        if view_total == haaland_xi:
            print("View matches XI-only recompute (expected).")
        elif view_total == haaland_all:
            print("View matches all-positions recompute (view may include bench).")
        else:
            print(f"Discrepancy: view={view_total}, XI={haaland_xi}, all={haaland_all}")
            print("If app shows 349, check: (1) UI cache/filter (2) view refresh (3) different manager_id.")
    print("(Compare to app Total Points chart with filter ALL.)")


if __name__ == "__main__":
    main()
