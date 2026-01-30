#!/usr/bin/env python3
"""
Load multiple leagues and analyze data/computation requirements.

This script:
1. Loads 3 leagues (specified by league IDs)
2. Counts total managers across all leagues
3. Estimates refresh time and data requirements
4. Provides performance metrics
"""

import asyncio
import sys
import time
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
from fpl_api.client import FPLAPIClient
from refresh.orchestrator import RefreshOrchestrator
from utils.logger import setup_logging


async def load_league(fpl_client: FPLAPIClient, db_client: SupabaseClient, league_id: int):
    """Load a single league and return manager count."""
    print(f"\n📊 Loading League {league_id}...")
    
    try:
        # Fetch league standings (may need pagination - 50 managers per page)
        all_manager_data = []  # Store full manager data, not just IDs
        league_name = None
        page = 1
        
        while True:
            try:
                league_data = await fpl_client.get_league_standings(league_id, page)
                standings = league_data.get("standings", {})
                results = standings.get("results", [])
                
                # Try to get league name from first page (if available)
                if page == 1 and not league_name:
                    # League name might be in the league_data structure
                    league_name = league_data.get("league", {}).get("name") or standings.get("league", {}).get("name")
                
                if not results:
                    break
                
                # Store full manager data including names
                for result in results:
                    manager_id = result.get("entry")
                    if manager_id:
                        all_manager_data.append({
                            "manager_id": manager_id,
                            "entry_name": result.get("entry_name", ""),
                            "player_name": result.get("player_name", "")
                        })
                
                # Check if there are more pages
                if len(results) < 50:  # Last page
                    break
                
                page += 1
                await asyncio.sleep(0.5)  # Rate limiting
                
            except Exception as e:
                print(f"  ⚠️  Error fetching page {page}: {e}")
                break
        
        if not all_manager_data:
            print(f"  ❌ No managers found in league {league_id}")
            return 0
        
        # Try to get league name from first manager's entry if not found in standings
        if not league_name:
            try:
                first_manager_id = all_manager_data[0]["manager_id"]
                entry_data = await fpl_client.get_entry(first_manager_id)
                # Check if this manager is in the league and get league name
                leagues = entry_data.get("leagues", {})
                classic_leagues = leagues.get("classic", [])
                for classic_league in classic_leagues:
                    if classic_league.get("id") == league_id:
                        league_name = classic_league.get("name")
                        break
            except Exception as e:
                print(f"  ⚠️  Could not fetch league name from entry: {e}")
        
        # Fallback to default name if still not found
        if not league_name:
            league_name = f"League {league_id}"
        
        # Store league
        league_data_to_store = {
            "league_id": league_id,
            "league_name": league_name,
            "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        }
        
        db_client.client.table("mini_leagues").upsert(
            league_data_to_store,
            on_conflict="league_id"
        ).execute()
        
        # Store all managers and their league membership
        manager_records = []
        membership_records = []
        
        for manager_data in all_manager_data:
            manager_id = manager_data["manager_id"]
            manager_name = manager_data.get("entry_name") or manager_data.get("player_name") or f"Manager {manager_id}"
            
            # Store manager (basic info with name)
            manager_records.append({
                "manager_id": manager_id,
                "manager_name": manager_name,
                "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            })
            
            # Store league membership
            membership_records.append({
                "league_id": league_id,
                "manager_id": manager_id,
                "joined_time": None  # FPL API doesn't provide this in standings
            })
        
        # Batch upsert managers
        if manager_records:
            db_client.client.table("managers").upsert(
                manager_records,
                on_conflict="manager_id"
            ).execute()
        
        # Batch upsert league memberships
        if membership_records:
            db_client.client.table("mini_league_managers").upsert(
                membership_records,
                on_conflict="league_id,manager_id"
            ).execute()
        
        print(f"  ✅ Loaded {len(all_managers)} managers from league {league_id}")
        return len(all_managers)
        
    except Exception as e:
        print(f"  ❌ Error loading league {league_id}: {e}")
        import traceback
        traceback.print_exc()
        return 0


async def analyze_data_requirements(db_client: SupabaseClient):
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
    print(f"   - Manager Points ({unique_managers} managers): ~{unique_managers * 0.5:.1f}-{unique_managers * 2:.1f} seconds")
    print(f"   - Materialized Views: ~0.5-1.0 seconds")
    print(f"\n   📊 Total Estimated Time (Live Matches):")
    print(f"      ~{4 + 2 + (unique_managers * 1) + 1:.1f} seconds ({4 + 2 + (unique_managers * 1) + 1:.1f} / 30 = {(4 + 2 + (unique_managers * 1) + 1) / 30:.1f}x refresh interval)")
    
    # Data storage estimates
    print(f"\n💾 Data Storage Estimates (per gameweek):")
    print(f"   - Manager Gameweek History: {unique_managers} records")
    print(f"   - Manager Transfers: ~{unique_managers * 0.5:.0f} records (assuming 50% make transfers)")
    print(f"   - Manager Picks: {unique_managers * 15} records (15 players per manager)")
    print(f"   - Player Gameweek Stats: ~300 records (active players)")
    
    # API call estimates
    print(f"\n🌐 API Call Estimates (per refresh during live matches):")
    print(f"   - Bootstrap Static: 1 call")
    print(f"   - Fixtures: 1 call")
    print(f"   - Live Endpoint: 1 call (optimized - replaces 300+ element-summary calls)")
    print(f"   - Manager Picks: {unique_managers} calls")
    print(f"   - Total: {1 + 1 + 1 + unique_managers} calls")
    
    if unique_managers > 0:
        calls_per_minute = (1 + 1 + 1 + unique_managers) * 2  # 30 second refresh = 2 per minute
        print(f"   - Calls per Minute: {calls_per_minute}")
        print(f"   - Rate Limit Check: {'✅ Within limits' if calls_per_minute < 30 else '⚠️  May exceed limits'}")
    
    print("\n" + "="*70)


async def main():
    """Main entry point."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Load multiple leagues and analyze requirements")
    parser.add_argument(
        "--leagues",
        type=str,
        required=True,
        help="Comma-separated list of league IDs (e.g., 814685,123456,789012)"
    )
    parser.add_argument(
        "--analyze-only",
        action="store_true",
        help="Skip loading, only analyze existing data"
    )
    
    args = parser.parse_args()
    
    setup_logging()
    config = Config()
    fpl_client = FPLAPIClient(config)
    db_client = SupabaseClient(config)
    
    try:
        if not args.analyze_only:
            # Parse league IDs
            league_ids = [int(l.strip()) for l in args.leagues.split(",")]
            
            print("\n" + "="*70)
            print("LOADING LEAGUES")
            print("="*70)
            print(f"Loading {len(league_ids)} leagues: {league_ids}\n")
            
            # Load each league
            total_managers = 0
            for league_id in league_ids:
                managers = await load_league(fpl_client, db_client, league_id)
                total_managers += managers
                await asyncio.sleep(1)  # Rate limiting between leagues
            
            print(f"\n✅ Loaded {len(league_ids)} leagues with {total_managers} total managers")
        
        # Analyze requirements
        await analyze_data_requirements(db_client)
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        await fpl_client.close()


if __name__ == "__main__":
    asyncio.run(main())
