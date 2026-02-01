#!/usr/bin/env python3
"""
Backfill Manager Picks

This script backfills historical manager picks. It populates the manager_picks
table with position, auto-subs, multipliers, etc.

By default it only backfills gameweeks 1 through the current gameweek (from
gameweeks.is_current), since the FPL API has no picks for future gameweeks.

The script:
1. Processes managers in parallel (cap 5) for speed
2. Only sleeps for rate limiting after actual FPL API work (skips are instant)
3. Reuses bootstrap and fixtures once per run to avoid redundant API calls
4. Calls refresh_manager_picks() and refresh_player_gameweek_stats()

Usage:
    # Backfill all tracked managers for gameweeks 1..current
    python scripts/backfill_manager_picks.py
    
    # Backfill your configured manager (if not in a mini league they are not "tracked")
    python scripts/backfill_manager_picks.py --manager-id 344182
    
    # Backfill specific gameweeks only
    python scripts/backfill_manager_picks.py --gameweeks 1,2,3,4,5,24
    
    # Force refresh (overwrite existing picks)
    python scripts/backfill_manager_picks.py --force
    
    # Concurrency (default 5)
    python scripts/backfill_manager_picks.py --concurrency 3
"""

import asyncio
import argparse
import logging
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

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

# Default concurrency (FPL ~30 req/min; 5 workers × ~4 req each = ~20 req per 2s window)
DEFAULT_CONCURRENCY = 5
RATE_LIMIT_SLEEP_SEC = 2
PREFIX = "[BACKFILL]"


def _log(msg: str) -> None:
    """Single place for backfill progress messages."""
    logger.info(f"{PREFIX} {msg}")


async def _process_one(
    item_idx: int,
    total_work: int,
    mid: int,
    gw: int,
    db_client: SupabaseClient,
    manager_refresher: ManagerDataRefresher,
    player_refresher: PlayerDataRefresher,
    force: bool,
    bootstrap: Optional[Dict],
    fixtures_by_gw: Dict[int, Dict],
    semaphore: asyncio.Semaphore,
) -> Tuple[int, int, int]:
    """Process one (manager, gameweek). Returns (completed, skipped, errors)."""
    async with semaphore:
        try:
            if not force:
                existing = db_client.client.table("manager_picks").select("id").eq(
                    "manager_id", mid
                ).eq("gameweek", gw).limit(1).execute()
                if existing.data:
                    _log(f"{item_idx}/{total_work} manager {mid} GW{gw} – skipped (picks exist)")
                    return (0, 1, 0)
            _log(f"{item_idx}/{total_work} manager {mid} GW{gw} – refreshing picks + player stats...")
            await manager_refresher.refresh_manager_picks(mid, gw, use_cache=False)
            picks_result = db_client.client.table("manager_picks").select(
                "player_id"
            ).eq("manager_id", mid).eq("gameweek", gw).execute()
            if picks_result.data:
                player_ids = set(p["player_id"] for p in picks_result.data)
                await player_refresher.refresh_player_gameweek_stats(
                    gw,
                    player_ids,
                    fixtures=fixtures_by_gw.get(gw),
                    bootstrap=bootstrap,
                    expect_live_unavailable=True,
                )
            await asyncio.sleep(RATE_LIMIT_SLEEP_SEC)
            _log(f"{item_idx}/{total_work} manager {mid} GW{gw} – done")
            return (1, 0, 0)
        except Exception as e:
            _log(f"{item_idx}/{total_work} manager {mid} GW{gw} – error: {e}")
            logger.debug("Full traceback", exc_info=True)
            return (0, 0, 1)


async def backfill_manager_picks(
    manager_id: Optional[int] = None,
    gameweeks: Optional[List[int]] = None,
    all_tracked: bool = True,
    force: bool = False,
    concurrency: int = DEFAULT_CONCURRENCY,
):
    """
    Backfill historical manager picks for all gameweeks.
    
    Args:
        manager_id: Specific manager ID to backfill (optional)
        gameweeks: List of specific gameweeks to backfill (optional)
        all_tracked: If True, backfill all tracked managers
        force: If True, overwrite existing picks (default: False)
        concurrency: Max concurrent (manager, gameweek) tasks (default 5)
    """
    config = Config()
    db_client = SupabaseClient(config)
    fpl_client = FPLAPIClient(config)
    manager_refresher = ManagerDataRefresher(fpl_client, db_client)
    player_refresher = PlayerDataRefresher(fpl_client, db_client)
    
    # Quiet httpx/httpcore so [BACKFILL] progress lines are readable
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    
    try:
        if manager_id:
            manager_ids = [manager_id]
            _log(f"Backfilling manager {manager_id}")
        elif all_tracked:
            managers_result = db_client.client.table("mini_league_managers").select(
                "manager_id"
            ).execute()
            manager_ids = list(set([m["manager_id"] for m in managers_result.data]))
            _log(f"Found {len(manager_ids)} tracked managers to backfill")
        else:
            logger.error("Must specify manager_id or set all_tracked=True")
            return
        
        if gameweeks:
            gameweek_list = gameweeks
            _log(f"Gameweeks: {gameweek_list}")
        else:
            current_result = db_client.client.table("gameweeks").select(
                "id"
            ).eq("is_current", True).limit(1).execute()
            if not current_result.data:
                logger.error("No current gameweek found (is_current=true). Run bootstrap/refresh first or pass --gameweeks.")
                return
            current_gw = current_result.data[0]["id"]
            gameweek_list = list(range(1, current_gw + 1))
            _log(f"Gameweeks: 1..{current_gw} (current)")
        
        _log("Pre-fetching bootstrap and fixtures (reused for all managers)...")
        bootstrap = await fpl_client.get_bootstrap_static()
        all_fixtures = await fpl_client.get_fixtures()
        fixtures_by_gw: Dict[int, Dict] = {}
        for f in all_fixtures:
            gw = f.get("event")
            if gw is not None:
                if gw not in fixtures_by_gw:
                    fixtures_by_gw[gw] = {}
                fixtures_by_gw[gw][f["id"]] = f
        
        work = [(mid, gw) for mid in manager_ids for gw in gameweek_list]
        total_work = len(work)
        _log(f"Processing {total_work} items (concurrency={concurrency})...")
        
        semaphore = asyncio.Semaphore(concurrency)
        tasks = [
            _process_one(
                idx, total_work, mid, gw, db_client, manager_refresher, player_refresher,
                force, bootstrap, fixtures_by_gw, semaphore,
            )
            for idx, (mid, gw) in enumerate(work, 1)
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        completed = skipped = errors = 0
        for r in results:
            if isinstance(r, Exception):
                errors += 1
                _log(f"Task failed: {r}")
            else:
                c, s, e = r
                completed += c
                skipped += s
                errors += e
        
        _log("=" * 50)
        _log("Summary:")
        _log(f"  Total: {total_work}  Completed: {completed}  Skipped: {skipped}  Errors: {errors}")
        _log("=" * 50)
        
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
    parser.add_argument(
        "--concurrency",
        type=int,
        default=DEFAULT_CONCURRENCY,
        help=f"Max concurrent (manager, gameweek) tasks (default {DEFAULT_CONCURRENCY})"
    )
    
    args = parser.parse_args()
    
    gameweeks = None
    if args.gameweeks:
        gameweeks = [int(gw.strip()) for gw in args.gameweeks.split(",")]
    
    asyncio.run(backfill_manager_picks(
        manager_id=args.manager_id,
        gameweeks=gameweeks,
        all_tracked=args.manager_id is None,
        force=args.force,
        concurrency=args.concurrency,
    ))


if __name__ == "__main__":
    main()
