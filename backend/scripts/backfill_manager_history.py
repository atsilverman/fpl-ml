#!/usr/bin/env python3
"""
Backfill Manager Gameweek History

This script backfills historical gameweek data for tracked managers
by fetching from the FPL API and storing in the database.

The script:
1. Fetches all historical gameweeks from FPL API for each manager
2. Stores them in manager_gameweek_history table
3. OPTIMIZATION: For finished gameweeks, uses FPL API data directly (no calculation)
4. For live gameweeks, calculates points (needed for real-time updates)

Usage:
    # Backfill all tracked managers for all gameweeks
    python scripts/backfill_manager_history.py
    
    # Backfill specific manager
    python scripts/backfill_manager_history.py --manager-id 344182
    
    # Backfill specific gameweeks only
    python scripts/backfill_manager_history.py --gameweeks 1,2,3,4,5
"""

import asyncio
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

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


async def backfill_manager_history(
    manager_id: Optional[int] = None,
    gameweeks: Optional[List[int]] = None,
    all_tracked: bool = True,
    force: bool = False
):
    """
    Backfill historical gameweek data for managers.
    
    OPTIMIZATION: For finished gameweeks, uses FPL API data directly
    instead of calculating points (much faster).
    
    Args:
        manager_id: Specific manager ID to backfill (optional)
        gameweeks: List of specific gameweeks to backfill (optional)
        all_tracked: If True, backfill all tracked managers
        force: If True, overwrite existing data (default: False)
    """
    config = Config()
    db_client = SupabaseClient(config)
    fpl_client = FPLAPIClient(config)
    manager_refresher = ManagerDataRefresher(fpl_client, db_client)
    
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
        
        # OPTIMIZATION: Batch fetch gameweek finished status upfront (one query instead of per-gameweek)
        gameweeks_result = db_client.client.table("gameweeks").select(
            "id, finished"
        ).in_("id", gameweek_list).execute()
        finished_by_gw = {gw["id"]: gw["finished"] for gw in gameweeks_result.data}
        logger.info(f"Fetched finished status for {len(finished_by_gw)} gameweeks")
        
        # Backfill each manager
        total_managers = len(manager_ids)
        completed = 0
        skipped = 0
        errors = 0
        not_found = 0  # Gameweeks not found in FPL API
        
        for idx, mid in enumerate(manager_ids, 1):
            logger.info(f"[{idx}/{total_managers}] Processing manager {mid}...")
            
            # Fetch manager history from FPL API (contains all gameweeks)
            try:
                history = await fpl_client.get_entry_history(mid)
                fpl_history = history.get("current", [])
                
                if not fpl_history:
                    logger.warning(f"Manager {mid}: No history data found in FPL API")
                    continue
                
                logger.info(f"Manager {mid}: Found {len(fpl_history)} gameweeks in FPL API")
                
                # Create a map of gameweek -> FPL data for quick lookup
                fpl_data_by_gw = {h.get("event"): h for h in fpl_history if h.get("event")}
                
                # Backfill each gameweek
                for gw in gameweek_list:
                    # Check if already exists in database (skip if not forcing)
                    if not force:
                        existing = db_client.client.table("manager_gameweek_history").select(
                            "id, overall_rank"
                        ).eq("manager_id", mid).eq("gameweek", gw).execute()
                        
                        if existing.data and existing.data[0].get("overall_rank") is not None:
                            skipped += 1
                            logger.debug(f"Manager {mid} GW {gw}: Already exists with rank, skipping (use --force to overwrite)")
                            continue
                    
                    # Check if this gameweek exists in FPL API data
                    if gw not in fpl_data_by_gw:
                        not_found += 1
                        logger.debug(f"Manager {mid} GW {gw}: Not found in FPL API data")
                        continue
                    
                    # Refresh this gameweek (will create/update the record)
                    # OPTIMIZATION: For finished gameweeks, uses FPL API data directly (no calculation)
                    # Pass pre-fetched history and finished status to avoid redundant API/DB calls
                    try:
                        is_finished = finished_by_gw.get(gw, False)
                        await manager_refresher.refresh_manager_gameweek_history(
                            mid, 
                            gw,
                            pre_fetched_history=history,  # Pass pre-fetched history
                            is_finished=is_finished  # Pass pre-fetched finished status
                        )
                        completed += 1
                        action = "Overwritten" if force else "Backfilled"
                        total_processed = completed + skipped + errors + not_found
                        logger.info(f"Manager {mid} GW {gw}: {action} successfully ({completed} completed, {skipped} skipped, {errors} errors)")
                        
                        # Reduced delay - FPL API allows 30 req/min (2s per request)
                        # We're making 1 request per gameweek (picks endpoint), so 1.5s is safe
                        await asyncio.sleep(1.5)
                        
                    except Exception as e:
                        errors += 1
                        logger.error(f"Manager {mid} GW {gw}: Error - {e}")
                        continue
                
            except Exception as e:
                logger.error(f"Manager {mid}: Error fetching history - {e}")
                errors += 1
                continue
        
        logger.info("=" * 60)
        logger.info("Backfill Summary:")
        logger.info(f"  Completed: {completed}")
        logger.info(f"  Skipped (already exists): {skipped}")
        logger.info(f"  Not found in FPL API: {not_found}")
        logger.info(f"  Errors: {errors}")
        logger.info(f"  Total processed: {completed + skipped + errors + not_found}")
        logger.info("=" * 60)
        logger.info("Backfill complete!")
        
    finally:
        await fpl_client.close()


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(
        description="Backfill manager gameweek history from FPL API"
    )
    parser.add_argument(
        "--manager-id",
        type=int,
        help="Specific manager ID to backfill"
    )
    parser.add_argument(
        "--gameweeks",
        type=str,
        help="Comma-separated list of gameweeks (e.g., '1,2,3')"
    )
    parser.add_argument(
        "--all-tracked",
        action="store_true",
        default=True,
        help="Backfill all tracked managers (default: True)"
    )
    parser.add_argument(
        "--force",
        action="store_true",
        default=False,
        help="Force overwrite existing data (default: False). Recommended for finished gameweeks to use authoritative FPL API data."
    )
    
    args = parser.parse_args()
    
    gameweeks = None
    if args.gameweeks:
        gameweeks = [int(gw.strip()) for gw in args.gameweeks.split(",")]
    
    asyncio.run(backfill_manager_history(
        manager_id=args.manager_id,
        gameweeks=gameweeks,
        all_tracked=args.all_tracked,
        force=args.force
    ))
