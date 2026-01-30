#!/usr/bin/env python3
"""
Verify Backfill Status

Runs the same checks as supabase/examples/verify_backfill_status.sql using the
Supabase client. No DATABASE_URL needed — uses SUPABASE_URL and key from .env.

Checks:
  1. Total gameweeks
  2. Tracked managers count
  3. Summary: managers with full picks / full history
  4. Picks coverage per manager
  5. History coverage per manager
  6. Managers with incomplete picks (re-run backfill for these)
  7. mv_player_owned_leaderboard row count per manager (for total points bar graph)

Usage:
    cd backend && python3 scripts/verify_backfill_status.py
"""

import sys
from pathlib import Path
from collections import defaultdict

# Load environment
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env")

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
from config import Config
from database.supabase_client import SupabaseClient

PAGE_SIZE = 2000


def fetch_all(db: SupabaseClient, table: str, columns: str) -> list:
    """Fetch all rows from a table (paginate past default limit)."""
    all_data = []
    offset = 0
    while True:
        result = db.client.table(table).select(columns).range(
            offset, offset + PAGE_SIZE - 1
        ).execute()
        rows = result.data or []
        if not rows:
            break
        all_data.extend(rows)
        if len(rows) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return all_data


def run_checks(db: SupabaseClient) -> None:
    """Run all backfill verification checks."""

    # 1. Total gameweeks
    gw_result = db.client.table("gameweeks").select("id").execute()
    total_gameweeks = len(gw_result.data) if gw_result.data else 0
    print("=" * 60)
    print("1. TOTAL GAMEWEEKS")
    print("=" * 60)
    print(f"   total_gameweeks: {total_gameweeks}\n")

    # 2. Tracked managers
    mlm_result = db.client.table("mini_league_managers").select("manager_id").execute()
    tracked_manager_ids = list(set(r["manager_id"] for r in (mlm_result.data or [])))
    tracked_count = len(tracked_manager_ids)
    print("2. TRACKED MANAGERS")
    print("=" * 60)
    print(f"   tracked_managers: {tracked_count}\n")

    if total_gameweeks == 0 or tracked_count == 0:
        print("   No gameweeks or managers found. Exiting.")
        return

    # 3. Picks coverage per manager (fetch all picks, aggregate in Python)
    print("   Loading manager_picks and manager_gameweek_history...")
    picks_data = fetch_all(db, "manager_picks", "manager_id, gameweek")
    picks_by_manager = defaultdict(set)
    for row in picks_data:
        picks_by_manager[row["manager_id"]].add(row["gameweek"])

    # 4. History coverage per manager
    history_data = fetch_all(db, "manager_gameweek_history", "manager_id, gameweek")
    history_by_manager = defaultdict(set)
    for row in history_data:
        history_by_manager[row["manager_id"]].add(row["gameweek"])

    # 5. Manager names for display
    managers_result = db.client.table("managers").select("manager_id, manager_name").execute()
    manager_names = {r["manager_id"]: r.get("manager_name") or f"Manager {r['manager_id']}" for r in (managers_result.data or [])}

    # 6. Summary counts
    managers_full_picks = sum(1 for mid in tracked_manager_ids if len(picks_by_manager.get(mid, set())) >= total_gameweeks)
    managers_full_history = sum(1 for mid in tracked_manager_ids if len(history_by_manager.get(mid, set())) >= total_gameweeks)

    print("3. SUMMARY (backfill complete?)")
    print("=" * 60)
    print(f"   tracked_managers:        {tracked_count}")
    print(f"   managers_with_full_picks:   {managers_full_picks}")
    print(f"   managers_with_full_history: {managers_full_history}")
    print(f"   total_gameweeks:        {total_gameweeks}")
    if managers_full_picks == tracked_count and managers_full_history == tracked_count:
        print("\n   ✅ Backfill appears COMPLETE for all tracked managers.")
    else:
        print("\n   ⚠️  Backfill INCOMPLETE — some managers missing data.")
    print()

    # 7. Picks coverage table (all tracked managers, sorted by coverage ascending)
    print("4. PICKS COVERAGE (per manager)")
    print("=" * 60)
    rows = []
    for mid in tracked_manager_ids:
        n_picks = len(picks_by_manager.get(mid, set()))
        status = "Complete" if n_picks >= total_gameweeks else "Incomplete"
        rows.append((mid, manager_names.get(mid, str(mid)), n_picks, total_gameweeks, status))
    rows.sort(key=lambda x: (x[2], x[0]))
    for mid, name, n_picks, total, status in rows:
        print(f"   {mid}  {name[:40]:40}  picks: {n_picks:3}/{total}  {status}")
    print()

    # 8. History coverage table
    print("5. HISTORY COVERAGE (per manager)")
    print("=" * 60)
    rows_h = []
    for mid in tracked_manager_ids:
        n_hist = len(history_by_manager.get(mid, set()))
        status = "Complete" if n_hist >= total_gameweeks else "Incomplete"
        rows_h.append((mid, manager_names.get(mid, str(mid)), n_hist, total_gameweeks, status))
    rows_h.sort(key=lambda x: (x[2], x[0]))
    for mid, name, n_hist, total, status in rows_h:
        print(f"   {mid}  {name[:40]:40}  history: {n_hist:3}/{total}  {status}")
    print()

    # 9. Incomplete picks only
    incomplete_picks = [(mid, manager_names.get(mid, str(mid)), len(picks_by_manager.get(mid, set())), total_gameweeks) for mid in tracked_manager_ids if len(picks_by_manager.get(mid, set())) < total_gameweeks]
    incomplete_picks.sort(key=lambda x: x[2])
    if incomplete_picks:
        print("6. MANAGERS WITH INCOMPLETE PICKS (re-run backfill for these)")
        print("=" * 60)
        for mid, name, n_picks, total in incomplete_picks:
            print(f"   {mid}  {name[:40]:40}  {n_picks}/{total}")
        print(f"\n   To resume: python3 scripts/backfill_configured_manager.py --all-managers")
    else:
        print("6. MANAGERS WITH INCOMPLETE PICKS")
        print("=" * 60)
        print("   None — all managers have full picks.")
    print()

    # 10. mv_player_owned_leaderboard row count per manager
    mv_data = fetch_all(db, "mv_player_owned_leaderboard", "manager_id")
    mv_count_by_manager = defaultdict(int)
    for row in mv_data:
        mv_count_by_manager[row["manager_id"]] += 1

    print("7. MV_PLAYER_OWNED_LEADERBOARD (rows per manager — for total points bar graph)")
    print("=" * 60)
    for mid in sorted(tracked_manager_ids):
        count = mv_count_by_manager.get(mid, 0)
        name = manager_names.get(mid, str(mid))
        print(f"   {mid}  {name[:40]:40}  players_in_leaderboard: {count}")
    print("=" * 60)


def main():
    print("\nBackfill verification (using Supabase client)\n")
    config = Config()
    db = SupabaseClient(config)
    try:
        run_checks(db)
    except Exception as e:
        print(f"Error: {e}")
        raise


if __name__ == "__main__":
    main()
