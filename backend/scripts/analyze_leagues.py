#!/usr/bin/env python3
"""
Analyze existing league data and compute requirements.

This script analyzes already-loaded leagues to provide:
- Total managers across all leagues
- Estimated refresh times
- Data/computation requirements
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


def analyze_data_requirements(db_client: SupabaseClient):
    """Analyze data and computation requirements."""
    print("\n" + "="*70)
    print("DATA & COMPUTATION ANALYSIS")
    print("="*70)
    
    # Get league count
    leagues = db_client.client.table("mini_leagues").select("league_id, league_name").execute().data
    print(f"\n📊 Leagues Loaded: {len(leagues)}")
    for league in leagues:
        print(f"   - League {league['league_id']}: {league.get('league_name', 'N/A')}")
    
    # Get total managers
    managers = db_client.client.table("mini_league_managers").select("manager_id").execute().data
    unique_managers = len(set(m["manager_id"] for m in managers))
    total_memberships = len(managers)
    
    print(f"\n👥 Managers:")
    print(f"   - Unique Managers: {unique_managers}")
    print(f"   - Total Memberships: {total_memberships}")
    
    # Get managers per league
    print(f"\n📈 Managers per League:")
    for league in leagues:
        league_managers = db_client.client.table("mini_league_managers").select(
            "manager_id"
        ).eq("league_id", league["league_id"]).execute().data
        print(f"   - League {league['league_id']}: {len(league_managers)} managers")
    
    # Estimate refresh time
    print(f"\n⏱️  Estimated Refresh Times (with optimizations):")
    print(f"   - No Live Matches: ~4-5 seconds")
    print(f"   - Live Matches (Players): ~1-3 seconds (optimized)")
    
    if unique_managers > 0:
        # Estimate manager points refresh: 0.5-2 seconds per manager
        manager_time_min = unique_managers * 0.5
        manager_time_max = unique_managers * 2
        print(f"   - Manager Points ({unique_managers} managers): ~{manager_time_min:.1f}-{manager_time_max:.1f} seconds")
        print(f"   - Materialized Views: ~0.5-1.0 seconds")
        
        total_time = 4 + 2 + (unique_managers * 1) + 1
        print(f"\n   📊 Total Estimated Time (Live Matches):")
        print(f"      ~{total_time:.1f} seconds")
        print(f"      Refresh Interval: 30 seconds")
        print(f"      Utilization: {total_time / 30 * 100:.1f}% of refresh interval")
        
        if total_time < 30:
            print(f"      ✅ Feasible: Refresh completes in {30 - total_time:.1f}s before next cycle")
        else:
            print(f"      ⚠️  Warning: Refresh may exceed interval by {total_time - 30:.1f}s")
    else:
        print(f"   - Manager Points: 0 seconds (no managers loaded)")
        print(f"   - Materialized Views: ~0.5-1.0 seconds")
    
    # Data storage estimates
    print(f"\n💾 Data Storage Estimates (per gameweek):")
    if unique_managers > 0:
        print(f"   - Manager Gameweek History: {unique_managers} records")
        print(f"   - Manager Transfers: ~{unique_managers * 0.5:.0f} records (assuming 50% make transfers)")
        print(f"   - Manager Picks: {unique_managers * 15} records (15 players per manager)")
    print(f"   - Player Gameweek Stats: ~300 records (active players)")
    
    # API call estimates
    print(f"\n🌐 API Call Estimates (per refresh during live matches):")
    print(f"   - Bootstrap Static: 1 call")
    print(f"   - Fixtures: 1 call")
    print(f"   - Live Endpoint: 1 call (optimized - replaces 300+ element-summary calls)")
    if unique_managers > 0:
        print(f"   - Manager Picks: {unique_managers} calls")
        total_calls = 1 + 1 + 1 + unique_managers
        print(f"   - Total: {total_calls} calls")
        
        calls_per_minute = total_calls * 2  # 30 second refresh = 2 per minute
        print(f"   - Calls per Minute: {calls_per_minute}")
        print(f"   - Rate Limit (30/min): {'✅ Within limits' if calls_per_minute < 30 else '⚠️  May exceed limits'}")
        
        if calls_per_minute >= 30:
            print(f"      💡 Consider: Increase refresh interval to {60 / (total_calls / 30):.0f} seconds")
    else:
        print(f"   - Manager Picks: 0 calls (no managers loaded)")
        print(f"   - Total: 3 calls")
    
    print("\n" + "="*70)


def main():
    """Main entry point."""
    print("\n" + "="*70)
    print("LEAGUE DATA ANALYSIS")
    print("="*70)
    
    config = Config()
    db_client = SupabaseClient(config)
    
    try:
        analyze_data_requirements(db_client)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()
