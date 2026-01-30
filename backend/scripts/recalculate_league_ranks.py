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
    previous_gw = current_gw - 1
    print(f"Current gameweek: {current_gw}\n")
    
    # Verify league exists
    league = db_client.client.table("mini_leagues").select("*").eq("league_id", league_id).single().execute().data
    if not league:
        print(f"❌ League {league_id} not found")
        return
    
    print(f"✅ League found: {league.get('league_name', 'N/A')}\n")
    
    # Get all managers in league
    managers = db_client.client.table("mini_league_managers").select(
        "manager_id"
    ).eq("league_id", league_id).execute().data
    
    manager_totals = []
    for manager in managers:
        manager_id = manager["manager_id"]
        
        # Get current gameweek data
        history = db_client.client.table("manager_gameweek_history").select(
            "total_points, previous_mini_league_rank"
        ).eq("manager_id", manager_id).eq("gameweek", current_gw).execute().data
        
        if not history:
            continue
        
        # Get previous rank from baseline column
        previous_rank = history[0].get("previous_mini_league_rank")
        
        # Fallback: if baseline not set, try to get from previous gameweek
        if previous_rank is None:
            previous_history = db_client.client.table("manager_gameweek_history").select(
                "mini_league_rank"
            ).eq("manager_id", manager_id).eq("gameweek", previous_gw).execute().data
            previous_rank = previous_history[0]["mini_league_rank"] if previous_history else None
        
        manager_totals.append({
            "manager_id": manager_id,
            "total_points": history[0]["total_points"],
            "previous_rank": previous_rank
        })
    
    # Sort by total points descending, then by manager_id ascending for consistent tie-breaking
    manager_totals.sort(key=lambda x: (x["total_points"], -x["manager_id"]), reverse=True)
    
    print(f"Recalculating ranks for {len(manager_totals)} managers...\n")
    
    # Update ranks with proper tie handling
    current_rank = 1
    previous_points = None
    
    for i, manager_data in enumerate(manager_totals):
        total_points = manager_data["total_points"]
        
        # If this manager has different points than previous, assign rank based on position
        # If same points as previous, they get the same rank (tied)
        if previous_points is not None and total_points != previous_points:
            # Points changed - use position in list (1-indexed)
            current_rank = i + 1
        elif previous_points is None:
            # First manager - rank 1
            current_rank = 1
        # else: same points as previous - keep same rank (tied)
        
        # Calculate rank change: previous_rank - current_rank
        rank_change = None
        if manager_data["previous_rank"] is not None:
            rank_change = manager_data["previous_rank"] - current_rank
        
        # Update database
        db_client.client.table("manager_gameweek_history").update({
            "mini_league_rank": current_rank,
            "mini_league_rank_change": rank_change
        }).eq("manager_id", manager_data["manager_id"]).eq(
            "gameweek", current_gw
        ).execute()
        
        previous_points = total_points
    
    print("✅ Ranks recalculated successfully\n")
    
    # Verify the fix
    print("Verifying ranks...")
    standings = db_client.client.table("manager_gameweek_history").select(
        "manager_id, total_points, mini_league_rank, mini_league_rank_change"
    ).eq("gameweek", current_gw).in_("manager_id", [m["manager_id"] for m in manager_totals]).execute().data
    
    standings.sort(key=lambda x: x.get("total_points", 0), reverse=True)
    
    print(f"\nUpdated Standings:")
    print(f"   {'Rank':<6} {'Manager ID':<12} {'Total Points':<15} {'Rank Change':<12}")
    print(f"   {'-'*6} {'-'*12} {'-'*15} {'-'*12}")
    
    for i, standing in enumerate(standings):
        rank = standing.get("mini_league_rank")
        m_id = standing.get("manager_id")
        points = standing.get("total_points")
        change = standing.get("mini_league_rank_change")
        
        # Check if rank matches calculated position
        calculated_rank = i + 1
        marker = "✅" if rank == calculated_rank else "⚠️"
        
        print(f"   {marker} {rank or 'NULL':<4} {m_id:<12} {points:<15} {change or 'NULL':<12}")
        if rank != calculated_rank:
            print(f"      Expected rank {calculated_rank}, got {rank}")
    
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
