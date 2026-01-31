#!/usr/bin/env python3
"""
Update league and manager names from FPL API.

This script:
1. Fetches league names from FPL API (from manager entry endpoints)
2. Fetches manager names from league standings
3. Updates the database with the correct names
"""

import asyncio
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
from fpl_api.client import FPLAPIClient
from utils.logger import setup_logging


async def update_league_name(fpl_client: FPLAPIClient, db_client: SupabaseClient, league_id: int):
    """Update league name from FPL API."""
    try:
        # Get first manager in league to fetch league name
        league_managers = db_client.client.table("mini_league_managers").select(
            "manager_id"
        ).eq("league_id", league_id).limit(1).execute().data
        
        if not league_managers:
            print(f"  ⚠️  No managers found in league {league_id}, skipping")
            return None
        
        first_manager_id = league_managers[0]["manager_id"]
        
        # Fetch manager entry to get league name
        entry_data = await fpl_client.get_entry(first_manager_id)
        leagues = entry_data.get("leagues", {})
        classic_leagues = leagues.get("classic", [])
        
        league_name = None
        for classic_league in classic_leagues:
            if classic_league.get("id") == league_id:
                league_name = classic_league.get("name")
                break
        
        if league_name:
            # Update league name in database
            db_client.client.table("mini_leagues").update({
                "league_name": league_name
            }).eq("league_id", league_id).execute()
            print(f"  ✅ Updated league {league_id} name to: {league_name}")
            return league_name
        else:
            print(f"  ⚠️  Could not find league name for league {league_id}")
            return None
            
    except Exception as e:
        print(f"  ❌ Error updating league {league_id} name: {e}")
        return None


async def update_manager_names(fpl_client: FPLAPIClient, db_client: SupabaseClient, league_id: int):
    """Update manager names from league standings."""
    try:
        print(f"  📋 Fetching manager names from league {league_id}...")
        
        all_manager_data = []
        page = 1
        
        while True:
            try:
                league_data = await fpl_client.get_league_standings(league_id, page)
                standings = league_data.get("standings", {})
                results = standings.get("results", [])
                
                if not results:
                    break
                
                for result in results:
                    manager_id = result.get("entry")
                    if manager_id:
                        all_manager_data.append({
                            "manager_id": manager_id,
                            "entry_name": result.get("entry_name", ""),
                            "player_name": result.get("player_name", "")
                        })
                
                if len(results) < 50:
                    break
                
                page += 1
                await asyncio.sleep(0.5)  # Rate limiting
                
            except Exception as e:
                print(f"    ⚠️  Error fetching page {page}: {e}")
                break
        
        # Update manager names: manager_team_name = squad/entry name, manager_name = person name
        updated_count = 0
        for manager_data in all_manager_data:
            manager_id = manager_data["manager_id"]
            entry_name = (manager_data.get("entry_name") or "").strip()
            player_name = (manager_data.get("player_name") or "").strip()
            # manager_team_name = FPL squad/entry name (for table display and modal title)
            # manager_name = person name (for modal subtitle; fallback to entry name)
            team_name = entry_name or player_name
            person_name = player_name or entry_name
            if not team_name and not person_name:
                continue
            update_payload = {
                "manager_team_name": team_name or person_name,
                "manager_name": person_name or team_name,
            }
            db_client.client.table("managers").update(update_payload).eq("manager_id", manager_id).execute()
            updated_count += 1
        
        print(f"  ✅ Updated {updated_count} manager names")
        
        # Refresh materialized view to reflect updated names
        try:
            print(f"  🔄 Refreshing materialized view...")
            db_client.refresh_materialized_view("mv_mini_league_standings")
            print(f"  ✅ Materialized view refreshed")
        except Exception as e:
            print(f"  ⚠️  Could not refresh materialized view: {e}")
            print(f"  💡 Refresh manually: SELECT refresh_mini_league_standings();")
        
        return updated_count
        
    except Exception as e:
        print(f"  ❌ Error updating manager names: {e}")
        return 0


async def main():
    """Main entry point."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Update league and manager names from FPL API")
    parser.add_argument(
        "--leagues",
        type=str,
        help="Comma-separated list of league IDs (e.g., 814685,123456). If not provided, updates all leagues in database"
    )
    parser.add_argument(
        "--league-names-only",
        action="store_true",
        help="Only update league names, skip manager names"
    )
    parser.add_argument(
        "--manager-names-only",
        action="store_true",
        help="Only update manager names, skip league names"
    )
    
    args = parser.parse_args()
    
    setup_logging()
    config = Config()
    fpl_client = FPLAPIClient(config)
    db_client = SupabaseClient(config)
    
    try:
        # Get league IDs to update
        if args.leagues:
            league_ids = [int(l.strip()) for l in args.leagues.split(",")]
        else:
            # Get all leagues from database
            leagues = db_client.client.table("mini_leagues").select("league_id").execute().data
            league_ids = [l["league_id"] for l in leagues]
        
        print("\n" + "="*70)
        print("UPDATING LEAGUE AND MANAGER NAMES")
        print("="*70)
        print(f"Updating {len(league_ids)} leagues: {league_ids}\n")
        
        # Update each league
        for league_id in league_ids:
            print(f"\n📊 Processing League {league_id}...")
            
            if not args.manager_names_only:
                await update_league_name(fpl_client, db_client, league_id)
                await asyncio.sleep(0.5)  # Rate limiting
            
            if not args.league_names_only:
                await update_manager_names(fpl_client, db_client, league_id)
                await asyncio.sleep(1)  # Rate limiting between leagues
        
        print("\n" + "="*70)
        print("✅ Update complete!")
        print("="*70)
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        await fpl_client.close()


if __name__ == "__main__":
    asyncio.run(main())
