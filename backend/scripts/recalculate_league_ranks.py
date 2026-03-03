#!/usr/bin/env python3
"""
Manually recalculate mini league ranks for a specific league.

This script forces a recalculation of ranks, which is useful when:
- Ranks are incorrect due to data updates
- Tied managers need proper rank assignment
- Rank changes need to be recalculated
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


def recalculate_ranks(league_id: int):
    """Recalculate ranks for a specific league."""
    print(f"\n{'='*70}")
    print(f"RECALCULATING RANKS FOR LEAGUE {league_id}")
    print(f"{'='*70}\n")
    
    config = Config()
    db_client = SupabaseClient(config)
    
    # Get current gameweek
    gameweek = db_client.client.table("gameweeks").select("id").eq("is_current", True).single().execute().data
    if not gameweek:
        print("❌ No current gameweek found")
        return
    
    current_gw = gameweek["id"]
    print(f"Current gameweek: {current_gw}\n")
    
    # Verify league exists
    league = db_client.client.table("mini_leagues").select("*").eq("league_id", league_id).single().execute().data
    if not league:
        print(f"❌ League {league_id} not found")
        return
    
    print(f"✅ League found: {league.get('league_name', 'N/A')}\n")
    print(f"Recalculating ranks for league {league_id}...\n")

    # Use batched SQL RPC (same as live refresh path)
    updated = db_client.calculate_mini_league_ranks(league_id, current_gw)

    print(f"✅ Ranks recalculated successfully ({updated} managers updated)\n")
    
    # Verify the fix
    print("Verifying ranks...")
    managers = db_client.client.table("mini_league_managers").select(
        "manager_id"
    ).eq("league_id", league_id).execute().data or []
    manager_ids = [m["manager_id"] for m in managers]
    standings = db_client.client.table("manager_gameweek_history").select(
        "manager_id, total_points, mini_league_rank, mini_league_rank_change"
    ).eq("gameweek", current_gw).in_("manager_id", manager_ids).execute().data or []

    standings.sort(key=lambda x: (-x.get("total_points", 0), x.get("manager_id", 0)))
    
    print(f"\nUpdated Standings:")
    print(f"   {'Rank':<6} {'Manager ID':<12} {'Total Points':<15} {'Rank Change':<12}")
    print(f"   {'-'*6} {'-'*12} {'-'*15} {'-'*12}")
    
    for standing in standings:
        rank = standing.get("mini_league_rank")
        m_id = standing.get("manager_id")
        points = standing.get("total_points")
        change = standing.get("mini_league_rank_change")
        print(f"   {rank or 'NULL':<4} {m_id:<12} {points:<15} {change or 'NULL':<12}")
    
    print(f"\n{'='*70}\n")


def main():
    """Main entry point."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Recalculate mini league ranks")
    parser.add_argument(
        "--league",
        type=int,
        required=True,
        help="League ID to recalculate ranks for"
    )
    
    args = parser.parse_args()
    
    try:
        recalculate_ranks(args.league)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()
