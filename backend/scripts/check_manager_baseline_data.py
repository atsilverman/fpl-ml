#!/usr/bin/env python3
"""
Check manager_gameweek_history for baseline data: total_points, overall_rank, previous_overall_rank.

Confirms we have end-of-GW total_points and overall_rank for every manager for every gameweek
played, and previous_overall_rank for the current gameweek (needed for rank gain/loss diff).

Usage:
    cd backend && python3 scripts/check_manager_baseline_data.py [MANAGER_ID]

Defaults: MANAGER_ID=344182. Omit MANAGER_ID to check all managers with history.
Uses SUPABASE_URL and SUPABASE_KEY from .env.
"""

import os
import sys
from pathlib import Path

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env")
from supabase import create_client


def main():
    manager_id = int(sys.argv[1]) if len(sys.argv) > 1 else None
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_KEY")
    if not url or not key:
        print("Missing SUPABASE_URL or key")
        sys.exit(1)
    c = create_client(url, key)

    # Current gameweek
    gw_r = c.table("gameweeks").select("id, name, is_current, is_previous").eq("is_current", True).limit(1).execute()
    if not gw_r.data:
        print("No current gameweek")
        sys.exit(1)
    current_gw = gw_r.data[0]["id"]
    prev_gw = current_gw - 1
    print(f"Current gameweek: {current_gw}, previous: {prev_gw}\n")

    # Build query: manager_gameweek_history for manager_id (or all) and all gameweeks up to current
    q = (
        c.table("manager_gameweek_history")
        .select("manager_id, gameweek, total_points, overall_rank, previous_overall_rank, overall_rank_change")
        .lte("gameweek", current_gw)
        .order("manager_id")
        .order("gameweek")
    )
    if manager_id is not None:
        q = q.eq("manager_id", manager_id)
    rows = q.execute().data or []

    if not rows:
        print("No manager_gameweek_history rows found.")
        sys.exit(0)

    # Group by manager
    by_manager = {}
    for r in rows:
        mid = r["manager_id"]
        if mid not in by_manager:
            by_manager[mid] = []
        by_manager[mid].append(r)

    for mid in sorted(by_manager.keys()):
        hist = by_manager[mid]
        gw_min = min(h["gameweek"] for h in hist)
        gw_max = max(h["gameweek"] for h in hist)
        missing_total = [h["gameweek"] for h in hist if h.get("total_points") is None]
        missing_rank = [h["gameweek"] for h in hist if h.get("overall_rank") is None]
        current_row = next((h for h in hist if h["gameweek"] == current_gw), None)
        prev_overall = current_row.get("previous_overall_rank") if current_row else None
        rank_change = current_row.get("overall_rank_change") if current_row else None

        print(f"Manager {mid}: gameweeks {gw_min}–{gw_max} ({len(hist)} rows)")
        if missing_total:
            print(f"  Missing total_points: GW {missing_total}")
        else:
            print(f"  total_points: present for all GWs")
        if missing_rank:
            print(f"  Missing overall_rank: GW {missing_rank}")
        else:
            print(f"  overall_rank: present for all GWs")
        print(f"  Current GW {current_gw}: previous_overall_rank={prev_overall}, overall_rank_change={rank_change}")
        if prev_overall is None and current_row:
            prev_row = next((h for h in hist if h["gameweek"] == prev_gw), None)
            if prev_row and prev_row.get("overall_rank") is not None:
                print(f"  -> Backfill: set previous_overall_rank = {prev_row['overall_rank']} (from GW {prev_gw})")
        print()

    print("Baseline for rank gain/loss: previous_overall_rank (from is_previous GW overall_rank) - current overall_rank.")


if __name__ == "__main__":
    main()
