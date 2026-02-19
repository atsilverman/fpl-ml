#!/usr/bin/env python3
"""
Force a full refresh of player_gameweek_stats for a gameweek.

Re-fetches from the FPL API (element-summary) and rewrites all rows with
per-fixture data. Use this after backend changes (e.g. DEFCON per game) so
the DB gets correct per-fixture defensive_contribution and fixture_id.

Usage (from backend directory):
    python3 scripts/force_refresh_player_stats.py
    python3 scripts/force_refresh_player_stats.py --gw 25
"""

import argparse
import asyncio
import sys
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from config import Config
from database.supabase_client import SupabaseClient
from fpl_api.client import FPLAPIClient
from refresh.players import PlayerDataRefresher
from utils.logger import setup_logging


async def force_refresh_player_stats(gameweek_override: Optional[int] = None) -> None:
    setup_logging()
    config = Config()
    db = SupabaseClient(config)
    fpl = FPLAPIClient(config)
    refresher = PlayerDataRefresher(fpl, db)

    # Resolve gameweek
    if gameweek_override is not None:
        gw = gameweek_override
        print(f"Using gameweek: {gw}\n")
    else:
        r = db.client.table("gameweeks").select("id").eq("is_current", True).limit(1).execute()
        if not r.data:
            print("No current gameweek (is_current=true). Use --gw N.")
            return
        gw = r.data[0]["id"]
        print(f"Current gameweek: {gw}\n")

    # All player IDs that have stats for this gameweek (we'll re-fetch and overwrite)
    r = (
        db.client.table("player_gameweek_stats")
        .select("player_id")
        .eq("gameweek", gw)
        .execute()
    )
    player_ids = {row["player_id"] for row in (r.data or []) if row.get("player_id")}
    if not player_ids:
        print(f"No player_gameweek_stats rows for GW{gw}. Run backfill or wait for live refresh.")
        return

    print(f"Refreshing player stats for GW{gw} ({len(player_ids)} players)...")
    print("(Uses element-summary API; may take a minute.)\n")

    await refresher.refresh_player_gameweek_stats(
        gw,
        player_ids,
        live_data=None,
        fixtures=None,
        bootstrap=None,
        live_only=False,
        expect_live_unavailable=True,
        use_delta=False,
    )

    print("Done. player_gameweek_stats for this gameweek now have per-fixture data (e.g. DEFCON per game).")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Force refresh player_gameweek_stats for a gameweek (re-fetch from API)."
    )
    parser.add_argument(
        "--gw",
        type=int,
        metavar="N",
        help="Gameweek to refresh (default: current gameweek from DB)",
    )
    args = parser.parse_args()
    asyncio.run(force_refresh_player_stats(gameweek_override=args.gw))


if __name__ == "__main__":
    main()
