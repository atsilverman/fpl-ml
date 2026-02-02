#!/usr/bin/env python3
"""
Backfill Manager Transfers (ML Top Transfers)

Populates manager_transfers for the current (or given) gameweek and refreshes
mv_league_transfer_aggregation so the ML Top Transfers UI has data.

Use when the orchestrator didn't capture transfers after the FPL freeze (e.g. server off,
status-change trigger too early before transfers endpoint updated).

Usage:
    # Backfill current gameweek for all tracked managers
    python scripts/backfill_manager_transfers.py

    # Backfill a specific gameweek
    python scripts/backfill_manager_transfers.py --gameweek 24

    # Backfill a single manager
    python scripts/backfill_manager_transfers.py --manager-id 344182
"""

import asyncio
import argparse
import logging
import sys
from pathlib import Path

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env")

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from config import Config
from database.supabase_client import SupabaseClient
from fpl_api.client import FPLAPIClient
from refresh.managers import ManagerDataRefresher

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

RATE_LIMIT_SLEEP_SEC = 2


async def backfill_manager_transfers(
    gameweek: int = None,
    manager_id: int = None,
    all_tracked: bool = True,
):
    config = Config()
    db_client = SupabaseClient(config)
    fpl_client = FPLAPIClient(config)
    manager_refresher = ManagerDataRefresher(fpl_client, db_client)

    try:
        if gameweek is None:
            gw_result = db_client.client.table("gameweeks").select("id").eq("is_current", True).limit(1).execute()
            if not gw_result.data:
                logger.error("No current gameweek (is_current=true). Run bootstrap/refresh first or pass --gameweek.")
                return
            gameweek = gw_result.data[0]["id"]
            logger.info("Using current gameweek: %s", gameweek)
        else:
            logger.info("Using gameweek: %s", gameweek)

        if manager_id is not None:
            manager_ids = [manager_id]
            logger.info("Backfilling manager %s", manager_id)
        elif all_tracked:
            managers_result = db_client.client.table("mini_league_managers").select("manager_id").execute()
            manager_ids = list(set(m["manager_id"] for m in managers_result.data))
            logger.info("Found %s tracked managers", len(manager_ids))
        else:
            logger.error("Specify --manager-id or run with all tracked managers")
            return

        for i, mid in enumerate(manager_ids, 1):
            try:
                logger.info("[%s/%s] Refreshing transfers for manager %s GW %s", i, len(manager_ids), mid, gameweek)
                await manager_refresher.refresh_manager_transfers(mid, gameweek)
            except Exception as e:
                logger.warning("Manager %s failed: %s", mid, e)
            if i < len(manager_ids):
                await asyncio.sleep(RATE_LIMIT_SLEEP_SEC)

        logger.info("Refreshing league transfer aggregation (ML Top Transfers MV)...")
        try:
            db_client.refresh_league_transfer_aggregation()
            logger.info("Done. ML Top Transfers data should now be available.")
        except Exception as e:
            logger.error("MV refresh failed: %s. Run: SELECT refresh_league_transfer_aggregation();", e)
    finally:
        await fpl_client.close()


def main():
    parser = argparse.ArgumentParser(description="Backfill manager_transfers for ML Top Transfers")
    parser.add_argument("--gameweek", type=int, help="Gameweek to backfill (default: current)")
    parser.add_argument("--manager-id", type=int, help="Single manager ID (default: all tracked)")
    args = parser.parse_args()
    asyncio.run(backfill_manager_transfers(
        gameweek=args.gameweek,
        manager_id=args.manager_id,
        all_tracked=args.manager_id is None,
    ))


if __name__ == "__main__":
    main()
