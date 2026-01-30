#!/usr/bin/env python3
"""
Backfill Manager Picks

This script backfills historical manager picks for all gameweeks.
It populates the manager_picks table with position, auto-subs, multipliers, etc.

The script:
1. Loops through all tracked managers
2. For each manager, loops through all gameweeks
3. Calls refresh_manager_picks() which handles position, auto-subs, multipliers
4. Also refreshes player_gameweek_stats for owned players
5. Handles rate limiting (FPL API allows ~30 req/min)

Usage:
    # Backfill all tracked managers for all gameweeks
    python scripts/backfill_manager_picks.py
    
    # Backfill specific manager
    python scripts/backfill_manager_picks.py --manager-id 344182
    
    # Backfill specific gameweeks only
    python scripts/backfill_manager_picks.py --gameweeks 1,2,3,4,5
    
    # Force refresh (overwrite existing picks)
    python scripts/backfill_manager_picks.py --force
"""

import asyncio
import argparse
import logging
import sys
from pathlib import Path
from typing import List, Optional

# Load environment variables
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env")

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from config import Config
from database.supabase_client import SupabaseClient
from fpl_api.client import FPLAPIClient
from refresh.managers import ManagerDataRefresher
from refresh.players import PlayerDataRefresher

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


async def backfill_manager_picks(
    manager_id: Optional[int] = None,
    gameweeks: Optional[List[int]] = None,
    all_tracked: bool = True,
    force: bool = False
):
    """
    Backfill historical manager picks for all gameweeks.
    
    Args:
        manager_id: Specific manager ID to backfill (optional)
        gameweeks: List of specific gameweeks to backfill (optional)
        all_tracked: If True, backfill all tracked managers
        force: If True, overwrite existing picks (default: False)
    """
    config = Config()
    db_client = SupabaseClient(config)
    fpl_client = FPLAPIClient(config)
    manager_refresher = ManagerDataRefresher(fpl_client, db_client)
    player_refresher = PlayerDataRefresher(fpl_client, db_client)
    
    try:
        # Get list of managers to backfill
        if manager_id:
            manager_ids = [manager_id]
            logger.info(f"Backfilling manager {manager_id}")
        elif all_tracked:
            # Get all tracked managers from mini_league_managers
            managers_result = db_client.client.table("mini_league_managers").select(
                "manager_id"
            ).execute()
            manager_ids = list(set([m["manager_id"] for m in managers_result.data]))
            logger.info(f"Found {len(manager_ids)} tracked managers to backfill")
        else:
            logger.error("Must specify manager_id or set all_tracked=True")
            return
        
        # Get list of gameweeks to backfill
        if gameweeks:
            gameweek_list = gameweeks
            logger.info(f"Backfilling specific gameweeks: {gameweek_list}")
        else:
            # Get all gameweeks from database
            gameweeks_result = db_client.client.table("gameweeks").select(
                "id"
            ).order("id", desc=False).execute()
            gameweek_list = [gw["id"] for gw in gameweeks_result.data]
            logger.info(f"Found {len(gameweek_list)} gameweeks to backfill: {gameweek_list}")
        
        # Backfill each manager
        total_managers = len(manager_ids)
        completed = 0
        skipped = 0
        errors = 0
        
        for idx, mid in enumerate(manager_ids, 1):
            logger.info(f"[{idx}/{total_managers}] Processing manager {mid}...")
            
            # Backfill each gameweek
            for gw in gameweek_list:
                try:
                    # Check if picks already exist (skip if not forcing)
                    if not force:
                        existing_picks = db_client.client.table("manager_picks").select(
                            "id"
                        ).eq("manager_id", mid).eq("gameweek", gw).limit(1).execute()
                        
                        if existing_picks.data:
                            skipped += 1
                            logger.debug(f"Manager {mid} GW {gw}: Picks already exist, skipping (use --force to overwrite)")
                            continue
                    
                    # Refresh manager picks (handles position, auto-subs, multipliers)
                    logger.info(f"Refreshing picks for manager {mid}, gameweek {gw}")
                    await manager_refresher.refresh_manager_picks(
                        mid,
                        gw,
                        use_cache=False  # Force refresh from API
                    )
                    
                    # Get picks to refresh player stats
                    picks_result = db_client.client.table("manager_picks").select(
                        "player_id"
                    ).eq("manager_id", mid).eq("gameweek", gw).execute()
                    
                    if picks_result.data:
                        player_ids = list(set([p["player_id"] for p in picks_result.data]))
                        
                        # Refresh player stats for owned players
                        logger.debug(f"Refreshing player stats for {len(player_ids)} players in GW {gw}")
                        await player_refresher.refresh_player_gameweek_stats(gw, player_ids)
                    
                    completed += 1
                    logger.debug(f"Manager {mid} GW {gw}: Completed")
                    
                    # Rate limiting: FPL API allows ~30 req/min, so wait 2 seconds between requests
                    await asyncio.sleep(2)
                    
                except Exception as e:
                    errors += 1
                    logger.error(f"Error processing manager {mid} GW {gw}: {str(e)}", exc_info=True)
                    # Continue with next gameweek
                    continue
            
            logger.info(f"Manager {mid}: Completed {completed} gameweeks, skipped {skipped}, errors {errors}")
        
        logger.info("=" * 60)
        logger.info("Backfill Summary:")
        logger.info(f"  Total managers processed: {total_managers}")
        logger.info(f"  Total gameweeks processed: {completed}")
        logger.info(f"  Skipped (already exists): {skipped}")
        logger.info(f"  Errors: {errors}")
        logger.info("=" * 60)
        
    except Exception as e:
        logger.error(f"Fatal error during backfill: {str(e)}", exc_info=True)
        raise
    finally:
        if fpl_client:
            await fpl_client.close()


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description="Backfill manager picks for historical gameweeks")
    parser.add_argument(
        "--manager-id",
        type=int,
        help="Specific manager ID to backfill"
    )
    parser.add_argument(
        "--gameweeks",
        type=str,
        help="Comma-separated list of gameweeks to backfill (e.g., '1,2,3')"
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Force refresh even if picks already exist"
    )
    
    args = parser.parse_args()
    
    # Parse gameweeks if provided
    gameweeks = None
    if args.gameweeks:
        gameweeks = [int(gw.strip()) for gw in args.gameweeks.split(",")]
    
    # Run backfill
    asyncio.run(backfill_manager_picks(
        manager_id=args.manager_id,
        gameweeks=gameweeks,
        all_tracked=args.manager_id is None,
        force=args.force
    ))


if __name__ == "__main__":
    main()
