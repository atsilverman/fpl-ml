#!/usr/bin/env python3
"""
Populate test data from FPL API for development/testing.

This script fetches initial data from FPL API and populates the database:
- Teams (all 20 teams with names and abbreviations)
- Players (all ~800 players)
- Gameweeks (all 38 gameweeks)
- Fixtures (all 380 fixtures)
- Optionally: Manager picks, transfers for specific managers

Usage:
    # Populate all managers from a league (recommended)
    python scripts/populate_test_data.py --league 814685
    
    # Populate specific managers
    python scripts/populate_test_data.py --managers 12345,67890
    
    # Populate specific gameweeks
    python scripts/populate_test_data.py --league 814685 --gameweeks 1,2,3
    
    # Skip manager data (only populate players, gameweeks, fixtures)
    python scripts/populate_test_data.py --skip-managers
"""

import asyncio
import logging
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional, Dict, Any

# Load environment variables from .env file
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env")

# Add src directory to path (like main.py does)
backend_dir = Path(__file__).parent.parent
src_dir = backend_dir / "src"
sys.path.insert(0, str(src_dir))

from config import Config
from database.supabase_client import SupabaseClient
from fpl_api.client import FPLAPIClient

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def batch_upsert_with_retry(
    db_client: SupabaseClient,
    table_name: str,
    data_list: List[Dict[str, Any]],
    on_conflict: str,
    batch_size: int = 50,
    max_retries: int = 3,
    retry_delay: float = 2.0
) -> int:
    """
    Batch upsert data with retry logic and rate limiting.
    
    Args:
        db_client: Supabase client
        table_name: Table name to upsert into
        data_list: List of data dictionaries to upsert
        on_conflict: Conflict resolution column(s)
        batch_size: Number of records per batch
        max_retries: Maximum retry attempts per batch
        retry_delay: Initial delay between retries (exponential backoff)
        
    Returns:
        Number of successfully inserted records
    """
    total_inserted = 0
    total_batches = (len(data_list) + batch_size - 1) // batch_size
    
    for batch_num in range(0, len(data_list), batch_size):
        batch = data_list[batch_num:batch_num + batch_size]
        batch_index = (batch_num // batch_size) + 1
        
        for attempt in range(max_retries):
            try:
                result = db_client.client.table(table_name).upsert(
                    batch,
                    on_conflict=on_conflict
                ).execute()
                
                inserted_count = len(result.data) if result.data else len(batch)
                total_inserted += inserted_count
                logger.info(
                    f"✅ Batch {batch_index}/{total_batches}: Inserted {inserted_count} records into {table_name}"
                )
                break  # Success, move to next batch
                
            except Exception as e:
                if attempt < max_retries - 1:
                    wait_time = retry_delay * (2 ** attempt)  # Exponential backoff
                    logger.warning(
                        f"⚠️ Batch {batch_index}/{total_batches} failed (attempt {attempt + 1}/{max_retries}): {e}. "
                        f"Retrying in {wait_time:.1f}s..."
                    )
                    time.sleep(wait_time)
                else:
                    logger.error(
                        f"❌ Batch {batch_index}/{total_batches} failed after {max_retries} attempts: {e}"
                    )
                    # Continue with next batch instead of failing completely
        
        # Rate limiting: small delay between batches
        if batch_num + batch_size < len(data_list):
            time.sleep(0.1)  # 100ms delay between batches
    
    return total_inserted


async def populate_players(fpl_client: FPLAPIClient, db_client: SupabaseClient):
    """Populate players table from bootstrap-static."""
    logger.info("Populating players table...")
    
    bootstrap = await fpl_client.get_bootstrap_static()
    players = bootstrap.get("elements", [])
    
    # Prepare all player data
    players_data = []
    for player in players:
        player_data = {
            "fpl_player_id": player["id"],
            "first_name": player.get("first_name", ""),
            "second_name": player.get("second_name", ""),
            "web_name": player.get("web_name", ""),
            "team_id": player.get("team", 0),
            "position": player.get("element_type", 0),
            "updated_at": datetime.now(timezone.utc).isoformat()
        }
        players_data.append(player_data)
    
    # Batch insert with retry
    inserted = batch_upsert_with_retry(
        db_client,
        "players",
        players_data,
        on_conflict="fpl_player_id",
        batch_size=50
    )
    
    logger.info(f"✅ Populated {inserted}/{len(players)} players")


async def populate_gameweeks(fpl_client: FPLAPIClient, db_client: SupabaseClient):
    """Populate gameweeks table from bootstrap-static."""
    logger.info("Populating gameweeks table...")
    
    bootstrap = await fpl_client.get_bootstrap_static()
    events = bootstrap.get("events", [])
    
    # Prepare all gameweek data
    gameweeks_data = []
    for event in events:
        gameweek_data = {
            "id": event["id"],
            "name": event["name"],
            "deadline_time": event["deadline_time"],
            "is_current": event.get("is_current", False),
            "is_previous": event.get("is_previous", False),
            "is_next": event.get("is_next", False),
            "finished": event.get("finished", False),
            "data_checked": event.get("data_checked", False),
            "highest_score": event.get("highest_score"),
            "average_entry_score": event.get("average_entry_score"),
            "updated_at": datetime.now(timezone.utc).isoformat()
        }
        gameweeks_data.append(gameweek_data)
    
    # Batch insert with retry
    inserted = batch_upsert_with_retry(
        db_client,
        "gameweeks",
        gameweeks_data,
        on_conflict="id",
        batch_size=50
    )
    
    logger.info(f"✅ Populated {inserted}/{len(events)} gameweeks")


async def populate_teams(fpl_client: FPLAPIClient, db_client: SupabaseClient):
    """Populate teams table from bootstrap-static."""
    logger.info("Populating teams table...")
    
    bootstrap = await fpl_client.get_bootstrap_static()
    teams = bootstrap.get("teams", [])
    
    # Prepare all team data
    teams_data = []
    for team in teams:
        team_data = {
            "team_id": team["id"],
            "team_name": team.get("name", ""),
            "short_name": team.get("short_name", ""),
            "updated_at": datetime.now(timezone.utc).isoformat()
        }
        teams_data.append(team_data)
    
    # Batch insert with retry (only 20 teams, so single batch is fine)
    inserted = batch_upsert_with_retry(
        db_client,
        "teams",
        teams_data,
        on_conflict="team_id",
        batch_size=50
    )
    
    logger.info(f"✅ Populated {inserted}/{len(teams)} teams")


async def populate_fixtures(fpl_client: FPLAPIClient, db_client: SupabaseClient):
    """Populate fixtures table from fixtures endpoint."""
    logger.info("Populating fixtures table...")
    
    fixtures = await fpl_client.get_fixtures()
    
    # Get gameweeks to map deadline_time (FPL fixtures API doesn't provide deadline_time)
    # deadline_time is a gameweek-level property, not fixture-level
    gameweeks = db_client.get_gameweeks()
    deadline_time_map = {
        gw["id"]: gw["deadline_time"]
        for gw in gameweeks
        if gw.get("deadline_time")
    }
    
    # Prepare all fixture data
    fixtures_data = []
    for fixture in fixtures:
        gameweek_id = fixture.get("event")
        fixture_data = {
            "fpl_fixture_id": fixture["id"],
            "gameweek": gameweek_id,
            "home_team_id": fixture["team_h"],
            "away_team_id": fixture["team_a"],
            "home_score": fixture.get("team_h_score"),
            "away_score": fixture.get("team_a_score"),
            "started": fixture.get("started", False),
            "finished": fixture.get("finished", False),
            "finished_provisional": fixture.get("finished_provisional", False),
            "minutes": fixture.get("minutes", 0),
            "kickoff_time": fixture.get("kickoff_time"),
            # deadline_time comes from gameweeks table, not fixtures API
            "deadline_time": deadline_time_map.get(gameweek_id),
            "updated_at": datetime.now(timezone.utc).isoformat()
        }
        fixtures_data.append(fixture_data)
    
    # Batch insert with retry
    inserted = batch_upsert_with_retry(
        db_client,
        "fixtures",
        fixtures_data,
        on_conflict="fpl_fixture_id",
        batch_size=50
    )
    
    logger.info(f"✅ Populated {inserted}/{len(fixtures)} fixtures")


async def populate_league_and_managers(
    fpl_client: FPLAPIClient,
    db_client: SupabaseClient,
    league_id: int
) -> List[int]:
    """
    Populate league and all managers from FPL API.
    
    Args:
        fpl_client: FPL API client
        db_client: Supabase client
        league_id: FPL league ID
        
    Returns:
        List of manager IDs in the league
    """
    logger.info(f"Fetching managers from league {league_id}...")
    
    # Fetch league standings (may need pagination - 50 managers per page)
    all_managers = []
    page = 1
    
    while True:
        try:
            league_data = await fpl_client.get_league_standings(league_id, page)
            standings = league_data.get("standings", {})
            results = standings.get("results", [])
            
            if not results:
                break
            
            all_managers.extend(results)
            logger.info(f"Fetched page {page}: {len(results)} managers (total: {len(all_managers)})")
            
            # Check if there are more pages
            # FPL API returns has_next in standings object
            has_next = standings.get("has_next", False)
            
            # Also check if we got fewer than expected (usually 50 per page)
            # If we got fewer, we're probably on the last page
            if len(results) < 50:
                break
            
            if not has_next:
                break
            
            page += 1
            await asyncio.sleep(1)  # Rate limiting
            
        except Exception as e:
            logger.error(f"Error fetching league page {page}: {e}")
            break
    
    if not all_managers:
        logger.warning(f"No managers found in league {league_id}")
        return []
    
    # Try to get league name from first manager's entry
    league_name = None
    if all_managers:
        try:
            first_manager = all_managers[0]
            first_manager_id = first_manager.get("entry")
            if first_manager_id:
                entry_data = await fpl_client.get_entry(first_manager_id)
                leagues = entry_data.get("leagues", {})
                classic_leagues = leagues.get("classic", [])
                for classic_league in classic_leagues:
                    if classic_league.get("id") == league_id:
                        league_name = classic_league.get("name")
                        break
        except Exception as e:
            logger.debug(f"Could not fetch league name from entry: {e}")
    
    # Fallback to default name if not found
    if not league_name:
        league_name = f"League {league_id}"
    
    # Store league
    league_data_to_store = {
        "league_id": league_id,
        "league_name": league_name,
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    db_client.client.table("mini_leagues").upsert(
        league_data_to_store,
        on_conflict="league_id"
    ).execute()
    logger.info(f"✅ Stored league {league_id} ({league_name})")
    
    # Store all managers and their league membership
    manager_ids = []
    for manager in all_managers:
        manager_id = manager.get("entry")
        manager_name = manager.get("entry_name", f"Manager {manager_id}")
        player_name = manager.get("player_name", "")
        
        if not manager_id:
            continue
        
        manager_ids.append(manager_id)
        
        # Store manager
        manager_data = {
            "manager_id": manager_id,
            "manager_name": manager_name or player_name,
            "favourite_team_id": None,  # Will be updated when we fetch entry data
            "joined_time": None,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }
        db_client.upsert_manager(manager_data)
        
        # Store league membership
        membership_data = {
            "league_id": league_id,
            "manager_id": manager_id,
            "joined_time": None
        }
        db_client.client.table("mini_league_managers").upsert(
            membership_data,
            on_conflict="league_id,manager_id"
        ).execute()
    
    logger.info(f"✅ Stored {len(manager_ids)} managers for league {league_id}")
    return manager_ids


async def populate_manager_data(
    fpl_client: FPLAPIClient,
    db_client: SupabaseClient,
    manager_ids: List[int],
    gameweeks: Optional[List[int]] = None
):
    """Populate manager picks, transfers, and gameweek history for specific managers."""
    from refresh.managers import ManagerDataRefresher
    from refresh.players import PlayerDataRefresher
    
    manager_refresher = ManagerDataRefresher(fpl_client, db_client)
    player_refresher = PlayerDataRefresher(fpl_client, db_client)
    
    # Get current gameweek if not specified
    if not gameweeks:
        bootstrap = await fpl_client.get_bootstrap_static()
        events = bootstrap.get("events", [])
        current_gw = next((e["id"] for e in events if e.get("is_current")), None)
        if current_gw:
            gameweeks = [current_gw]
        else:
            logger.warning("No current gameweek found, skipping manager data")
            return
    
    logger.info(f"Populating manager data for {len(manager_ids)} managers, gameweeks {gameweeks}...")
    
    # First, collect all unique players from manager picks
    all_player_ids = set()
    
    for manager_id in manager_ids:
        for gameweek in gameweeks:
            try:
                # Refresh manager picks
                await manager_refresher.refresh_manager_picks(manager_id, gameweek)
                logger.info(f"✅ Populated picks for manager {manager_id}, GW {gameweek}")
                
                # Collect player IDs from picks for later player stats refresh
                picks = db_client.client.table("manager_picks").select(
                    "player_id"
                ).eq("manager_id", manager_id).eq("gameweek", gameweek).execute().data
                for pick in picks:
                    all_player_ids.add(pick["player_id"])
                
                # Refresh manager transfers
                await manager_refresher.refresh_manager_transfers(manager_id, gameweek)
                logger.info(f"✅ Populated transfers for manager {manager_id}, GW {gameweek}")
                
                # Refresh manager gameweek history (needed for standings views)
                await manager_refresher.refresh_manager_gameweek_history(manager_id, gameweek)
                logger.info(f"✅ Populated gameweek history for manager {manager_id}, GW {gameweek}")
                
                # Small delay to avoid rate limiting
                await asyncio.sleep(1)
                
            except Exception as e:
                logger.error(f"Error populating manager {manager_id}, GW {gameweek}: {e}")
    
    # Refresh player gameweek stats for all players owned by managers
    if all_player_ids:
        logger.info(f"Refreshing player gameweek stats for {len(all_player_ids)} players...")
        for gameweek in gameweeks:
            try:
                await player_refresher.refresh_player_gameweek_stats(gameweek, all_player_ids)
                logger.info(f"✅ Refreshed player stats for {len(all_player_ids)} players, GW {gameweek}")
            except Exception as e:
                logger.error(f"Error refreshing player stats for GW {gameweek}: {e}")
    
    logger.info(f"✅ Completed manager data population for {len(manager_ids)} managers")


async def build_whitelist_for_league(
    db_client: SupabaseClient,
    league_id: int,
    gameweek: int
):
    """Build player whitelist for a league after manager picks are populated."""
    logger.info(f"Building player whitelist for league {league_id}, gameweek {gameweek}...")
    
    try:
        # Get all managers in league
        managers = db_client.client.table("mini_league_managers").select(
            "manager_id"
        ).eq("league_id", league_id).execute().data
        
        manager_ids = [m["manager_id"] for m in managers]
        
        if not manager_ids:
            logger.warning(f"No managers found in league {league_id}")
            return
        
        # Get all picks for these managers in this gameweek
        owned_players = set()
        
        for manager_id in manager_ids:
            picks = db_client.client.table("manager_picks").select(
                "player_id"
            ).eq("manager_id", manager_id).eq("gameweek", gameweek).execute().data
            
            for pick in picks:
                owned_players.add(pick["player_id"])
        
        # Store whitelist
        for player_id in owned_players:
            whitelist_data = {
                "league_id": league_id,
                "gameweek": gameweek,
                "player_id": player_id
            }
            db_client.client.table("player_whitelist").upsert(
                whitelist_data,
                on_conflict="league_id,gameweek,player_id"
            ).execute()
        
        logger.info(f"✅ Built player whitelist for league {league_id}: {len(owned_players)} unique players from {len(manager_ids)} managers")
        
    except Exception as e:
        logger.error(f"Error building whitelist for league {league_id}: {e}", exc_info=True)


async def main():
    """Main entry point."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Populate test data from FPL API")
    parser.add_argument(
        "--league",
        type=int,
        help="League ID to fetch all managers from (e.g., 814685)"
    )
    parser.add_argument(
        "--managers",
        type=str,
        help="Comma-separated list of manager IDs (e.g., 12345,67890). Ignored if --league is provided."
    )
    parser.add_argument(
        "--gameweeks",
        type=str,
        help="Comma-separated list of gameweeks (e.g., 1,2,3). Defaults to current gameweek."
    )
    parser.add_argument(
        "--skip-managers",
        action="store_true",
        help="Skip manager data population (only populate players, gameweeks, fixtures)"
    )
    
    args = parser.parse_args()
    
    # Initialize clients
    config = Config()
    fpl_client = FPLAPIClient(config)
    db_client = SupabaseClient(config)
    
    try:
        logger.info("Starting test data population...")
        
        # Always populate core data (teams first since it's small and fast)
        await populate_teams(fpl_client, db_client)
        await populate_gameweeks(fpl_client, db_client)
        await populate_players(fpl_client, db_client)
        await populate_fixtures(fpl_client, db_client)
        
        # Optionally populate manager data
        if not args.skip_managers:
            manager_ids = []
            
            # Option 1: Fetch all managers from a league
            if args.league:
                logger.info(f"Fetching all managers from league {args.league}...")
                manager_ids = await populate_league_and_managers(fpl_client, db_client, args.league)
                logger.info(f"Found {len(manager_ids)} managers in league {args.league}")
            
            # Option 2: Use specific manager IDs
            elif args.managers:
                manager_ids = [int(m.strip()) for m in args.managers.split(",")]
            
            # Populate manager picks/transfers
            if manager_ids:
                gameweeks = None
                if args.gameweeks:
                    gameweeks = [int(gw.strip()) for gw in args.gameweeks.split(",")]
                else:
                    # Get current gameweek
                    bootstrap = await fpl_client.get_bootstrap_static()
                    events = bootstrap.get("events", [])
                    current_gw = next((e["id"] for e in events if e.get("is_current")), None)
                    if current_gw:
                        gameweeks = [current_gw]
                
                await populate_manager_data(fpl_client, db_client, manager_ids, gameweeks)
                
                # Build whitelist if we populated from a league
                if args.league and gameweeks:
                    for gameweek in gameweeks:
                        await build_whitelist_for_league(db_client, args.league, gameweek)
            else:
                logger.warning("No managers specified. Use --league or --managers to populate manager data.")
        
        logger.info("✅ Test data population complete!")
        logger.info("\nNext steps:")
        logger.info("1. Refresh materialized views: SELECT refresh_all_materialized_views();")
        logger.info("2. Start frontend: cd frontend && npm run dev")
        logger.info("3. Frontend can now query Supabase for data")
        
    except Exception as e:
        logger.error(f"Error during population: {e}", exc_info=True)
        sys.exit(1)
    finally:
        await fpl_client.close()


if __name__ == "__main__":
    asyncio.run(main())
