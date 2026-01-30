#!/usr/bin/env python3
"""
Diagnose league data issues - check what data exists and what's missing.

This script helps identify why league standings might show 0 for GW points
or missing rank changes.
"""

import sys
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables
load_dotenv(Path(__file__).parent.parent / ".env")

# Add src directory to path
backend_dir = Path(__file__).parent.parent
src_dir = backend_dir / "src"
sys.path.insert(0, str(src_dir))

from config import Config
from database.supabase_client import SupabaseClient


def diagnose_league(league_id: int, db_client: SupabaseClient):
    """Diagnose data for a specific league."""
    print(f"\n{'='*70}")
    print(f"DIAGNOSING LEAGUE {league_id}")
    print(f"{'='*70}\n")
    
    # 1. Check if league exists
    league = db_client.client.table("mini_leagues").select("*").eq("league_id", league_id).execute().data
    if not league:
        print(f"❌ League {league_id} not found in database")
        return
    print(f"✅ League found: {league[0].get('league_name', 'N/A')}")
    
    # 2. Check managers in league
    managers = db_client.client.table("mini_league_managers").select(
        "manager_id"
    ).eq("league_id", league_id).execute().data
    manager_ids = [m["manager_id"] for m in managers]
    print(f"✅ Found {len(manager_ids)} managers in league")
    
    if not manager_ids:
        print("❌ No managers in league - need to load league first")
        return
    
    # 3. Check current gameweek
    gameweek = db_client.client.table("gameweeks").select("id").eq("is_current", True).single().execute().data
    if not gameweek:
        print("❌ No current gameweek found")
        return
    
    current_gw = gameweek["id"]
    print(f"✅ Current gameweek: {current_gw}\n")
    
    # 4. Check manager_gameweek_history for current gameweek
    print(f"Checking manager_gameweek_history for gameweek {current_gw}...")
    history_records = db_client.client.table("manager_gameweek_history").select(
        "manager_id, gameweek_points, total_points, mini_league_rank, mini_league_rank_change"
    ).eq("gameweek", current_gw).in_("manager_id", manager_ids).execute().data
    
    print(f"  Found {len(history_records)} history records for {len(manager_ids)} managers")
    
    # Check for missing data
    missing_history = set(manager_ids) - {h["manager_id"] for h in history_records}
    if missing_history:
        print(f"  ⚠️  Missing history for {len(missing_history)} managers: {list(missing_history)[:5]}...")
    
    # Check for zero/null values
    zero_gw_points = [h for h in history_records if not h.get("gameweek_points") or h.get("gameweek_points") == 0]
    null_ranks = [h for h in history_records if h.get("mini_league_rank") is None]
    null_rank_changes = [h for h in history_records if h.get("mini_league_rank_change") is None]
    
    print(f"\n  Data Quality:")
    print(f"    - Managers with 0 GW points: {len(zero_gw_points)}")
    print(f"    - Managers with NULL league rank: {len(null_ranks)}")
    print(f"    - Managers with NULL rank change: {len(null_rank_changes)}")
    
    if zero_gw_points:
        print(f"\n  ⚠️  Sample managers with 0 GW points:")
        for h in zero_gw_points[:3]:
            print(f"      Manager {h['manager_id']}: GW points = {h.get('gameweek_points')}, Total = {h.get('total_points')}")
    
    # 5. Check materialized view
    print(f"\nChecking materialized view mv_mini_league_standings...")
    mv_data = db_client.client.table("mv_mini_league_standings").select(
        "manager_id, gameweek_points, total_points, mini_league_rank, mini_league_rank_change"
    ).eq("league_id", league_id).eq("gameweek", current_gw).execute().data
    
    print(f"  Found {len(mv_data)} records in materialized view")
    
    if len(mv_data) != len(manager_ids):
        print(f"  ⚠️  Materialized view has {len(mv_data)} records but league has {len(manager_ids)} managers")
        print(f"  💡 Need to refresh materialized view: SELECT refresh_mini_league_standings();")
    
    # 6. Recommendations
    print(f"\n{'='*70}")
    print("RECOMMENDATIONS")
    print(f"{'='*70}\n")
    
    if missing_history:
        print("1. ⚠️  Missing manager_gameweek_history records")
        print("   → Run: python3 scripts/populate_test_data.py --league {league_id}")
        print("   → Or run refresh orchestrator to populate data\n")
    
    if null_ranks:
        print("2. ⚠️  Missing league ranks (NULL values)")
        print("   → Run: python3 scripts/calculate_league_ranks.py")
        print("   → This will calculate ranks for all leagues\n")
    
    if zero_gw_points:
        print("3. ⚠️  Missing or zero gameweek points")
        print("   → Run refresh orchestrator to calculate points:")
        print("   → python3 scripts/refresh_data.py\n")
    
    if len(mv_data) != len(manager_ids):
        print("4. ⚠️  Materialized view is stale")
        print("   → Refresh in Supabase SQL Editor:")
        print("   → SELECT refresh_mini_league_standings();\n")
    
    if not missing_history and not zero_gw_points and len(mv_data) == len(manager_ids):
        print("✅ All data looks good! If you're still seeing issues, try:")
        print("   → Refreshing materialized view: SELECT refresh_mini_league_standings();")
        print("   → Clearing browser cache and reloading\n")


def main():
    """Main entry point."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Diagnose league data issues")
    parser.add_argument(
        "--league",
        type=int,
        required=True,
        help="League ID to diagnose"
    )
    
    args = parser.parse_args()
    
    config = Config()
    db_client = SupabaseClient(config)
    
    try:
        diagnose_league(args.league, db_client)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()
