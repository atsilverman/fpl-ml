#!/usr/bin/env python3
"""
Check rank change calculation for a specific manager in a league.

This script investigates why rank changes might be incorrect by:
1. Checking current and previous gameweek ranks
2. Verifying baseline data
3. Checking for tied managers
4. Verifying the rank change calculation
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


def check_manager_rank_change(manager_id: int, league_id: int, db_client: SupabaseClient):
    """Check rank change calculation for a specific manager."""
    print(f"\n{'='*70}")
    print(f"CHECKING RANK CHANGE FOR MANAGER {manager_id} IN LEAGUE {league_id}")
    print(f"{'='*70}\n")
    
    # Get current gameweek
    gameweek = db_client.client.table("gameweeks").select("id").eq("is_current", True).single().execute().data
    if not gameweek:
        print("❌ No current gameweek found")
        return
    
    current_gw = gameweek["id"]
    previous_gw = current_gw - 1
    print(f"Current gameweek: {current_gw}")
    print(f"Previous gameweek: {previous_gw}\n")
    
    # Get manager's current gameweek data
    current_history = db_client.client.table("manager_gameweek_history").select(
        "gameweek, total_points, mini_league_rank, mini_league_rank_change, "
        "previous_mini_league_rank, gameweek_points, baseline_total_points"
    ).eq("manager_id", manager_id).eq("gameweek", current_gw).single().execute().data
    
    if not current_history:
        print(f"❌ No history found for manager {manager_id} in gameweek {current_gw}")
        return
    
    print(f"📊 CURRENT GAMEWEEK ({current_gw}) DATA:")
    print(f"   Total Points: {current_history.get('total_points')}")
    print(f"   Gameweek Points: {current_history.get('gameweek_points')}")
    print(f"   Mini League Rank: {current_history.get('mini_league_rank')}")
    print(f"   Rank Change: {current_history.get('mini_league_rank_change')}")
    print(f"   Previous Rank (baseline): {current_history.get('previous_mini_league_rank')}")
    print(f"   Baseline Total Points: {current_history.get('baseline_total_points')}\n")
    
    # Get manager's previous gameweek data
    previous_history = db_client.client.table("manager_gameweek_history").select(
        "gameweek, total_points, mini_league_rank, gameweek_points"
    ).eq("manager_id", manager_id).eq("gameweek", previous_gw).single().execute().data
    
    if previous_history:
        print(f"📊 PREVIOUS GAMEWEEK ({previous_gw}) DATA:")
        print(f"   Total Points: {previous_history.get('total_points')}")
        print(f"   Gameweek Points: {previous_history.get('gameweek_points')}")
        print(f"   Mini League Rank: {previous_history.get('mini_league_rank')}\n")
    else:
        print(f"⚠️  No previous gameweek data found\n")
    
    # Get all managers in league for current gameweek
    managers = db_client.client.table("mini_league_managers").select(
        "manager_id"
    ).eq("league_id", league_id).execute().data
    manager_ids = [m["manager_id"] for m in managers]
    
    print(f"📊 LEAGUE STANDINGS ANALYSIS (League {league_id}):")
    print(f"   Total managers in league: {len(manager_ids)}\n")
    
    # Get all current gameweek standings
    current_standings = db_client.client.table("manager_gameweek_history").select(
        "manager_id, total_points, mini_league_rank, mini_league_rank_change, "
        "previous_mini_league_rank"
    ).eq("gameweek", current_gw).in_("manager_id", manager_ids).execute().data
    
    # Sort by total_points descending
    current_standings.sort(key=lambda x: x.get("total_points", 0), reverse=True)
    
    print(f"   Current Standings (sorted by total_points):")
    print(f"   {'Rank':<6} {'Manager ID':<12} {'Total Points':<15} {'Stored Rank':<12} {'Rank Change':<12} {'Prev Rank':<12}")
    print(f"   {'-'*6} {'-'*12} {'-'*15} {'-'*12} {'-'*12} {'-'*12}")
    
    # Track ties
    ties = {}
    calculated_rank = 1
    
    for i, standing in enumerate(current_standings):
        total_points = standing.get("total_points", 0)
        stored_rank = standing.get("mini_league_rank")
        rank_change = standing.get("mini_league_rank_change")
        prev_rank = standing.get("previous_mini_league_rank")
        m_id = standing.get("manager_id")
        
        # Check for ties
        if i > 0 and current_standings[i-1].get("total_points") == total_points:
            # Same points as previous - same rank
            calculated_rank = calculated_rank  # Keep same rank
        else:
            # Different points - new rank
            calculated_rank = i + 1
        
        # Track if this manager
        is_target = m_id == manager_id
        marker = ">>>" if is_target else "   "
        
        print(f"   {marker} {calculated_rank:<3} {m_id:<12} {total_points:<15} {stored_rank or 'NULL':<12} {rank_change or 'NULL':<12} {prev_rank or 'NULL':<12}")
        
        # Check for rank mismatch
        if stored_rank and stored_rank != calculated_rank:
            print(f"      ⚠️  RANK MISMATCH: Stored rank {stored_rank} != Calculated rank {calculated_rank}")
        
        # Track ties
        if total_points not in ties:
            ties[total_points] = []
        ties[total_points].append({
            "manager_id": m_id,
            "stored_rank": stored_rank,
            "calculated_rank": calculated_rank,
            "prev_rank": prev_rank
        })
    
    # Check for tied managers
    print(f"\n   🔍 TIE ANALYSIS:")
    has_ties = False
    for points, managers_list in ties.items():
        if len(managers_list) > 1:
            has_ties = True
            print(f"      {len(managers_list)} managers tied with {points} points:")
            for m in managers_list:
                marker = ">>>" if m["manager_id"] == manager_id else "   "
                print(f"      {marker} Manager {m['manager_id']}: Stored Rank {m['stored_rank']}, Calculated Rank {m['calculated_rank']}, Prev Rank {m['prev_rank']}")
    
    if not has_ties:
        print(f"      No ties found\n")
    
    # Verify rank change calculation
    print(f"\n   🔍 RANK CHANGE VERIFICATION:")
    target_standing = next((s for s in current_standings if s.get("manager_id") == manager_id), None)
    if target_standing:
        stored_rank = target_standing.get("mini_league_rank")
        stored_rank_change = target_standing.get("mini_league_rank_change")
        baseline_prev_rank = target_standing.get("previous_mini_league_rank")
        
        # Calculate what rank should be
        calculated_rank = next((i+1 for i, s in enumerate(current_standings) 
                               if s.get("manager_id") == manager_id), None)
        
        # Get previous rank from previous gameweek if baseline not available
        if not baseline_prev_rank and previous_history:
            baseline_prev_rank = previous_history.get("mini_league_rank")
        
        print(f"      Stored Rank: {stored_rank}")
        print(f"      Calculated Rank: {calculated_rank}")
        print(f"      Previous Rank (baseline): {baseline_prev_rank}")
        print(f"      Stored Rank Change: {stored_rank_change}")
        
        if baseline_prev_rank and calculated_rank:
            expected_rank_change = baseline_prev_rank - calculated_rank
            print(f"      Expected Rank Change: {baseline_prev_rank} - {calculated_rank} = {expected_rank_change}")
            
            if stored_rank_change != expected_rank_change:
                print(f"      ❌ MISMATCH: Stored ({stored_rank_change}) != Expected ({expected_rank_change})")
                print(f"      Difference: {stored_rank_change - expected_rank_change}")
            else:
                print(f"      ✅ Rank change calculation is correct")
        
        if stored_rank != calculated_rank:
            print(f"      ⚠️  WARNING: Stored rank ({stored_rank}) doesn't match calculated rank ({calculated_rank})")
            print(f"      This could cause incorrect rank change calculation")
    
    # Check baseline data timing
    print(f"\n   🔍 BASELINE DATA CHECK:")
    if current_history.get("baseline_total_points") is not None:
        print(f"      ✅ Baseline total points exists: {current_history.get('baseline_total_points')}")
    else:
        print(f"      ⚠️  Baseline total points is NULL")
    
    if current_history.get("previous_mini_league_rank") is not None:
        print(f"      ✅ Previous mini league rank (baseline) exists: {current_history.get('previous_mini_league_rank')}")
    else:
        print(f"      ⚠️  Previous mini league rank (baseline) is NULL")
        if previous_history:
            print(f"      Using previous gameweek rank as fallback: {previous_history.get('mini_league_rank')}")
    
    print(f"\n{'='*70}\n")


def main():
    """Main entry point."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Check rank change calculation for a manager")
    parser.add_argument(
        "--manager",
        type=int,
        required=True,
        help="Manager ID to check"
    )
    parser.add_argument(
        "--league",
        type=int,
        required=True,
        help="League ID"
    )
    
    args = parser.parse_args()
    
    config = Config()
    db_client = SupabaseClient(config)
    
    try:
        check_manager_rank_change(args.manager, args.league, db_client)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()
