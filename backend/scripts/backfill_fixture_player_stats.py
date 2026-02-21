#!/usr/bin/env python3
"""
Backfill player_gameweek_stats for full squads per fixture.

This ensures "last H2H" (reverse fixture) views show all players who played,
not just those from manager picks or live-refresh subset.

For each finished fixture we refresh stats for every player in both teams
(via element-summary). The FPL API returns data only for players who played
that gameweek, so we get full 22+ rows per fixture.

Usage:
    # Backfill all finished fixtures for gameweeks 1..current
    python scripts/backfill_fixture_player_stats.py

    # Specific gameweeks only (e.g. GW25 for Brighton v Palace)
    python scripts/backfill_fixture_player_stats.py --gameweeks 25

    # Range
    python scripts/backfill_fixture_player_stats.py --gameweeks 20-25

    # Dry run (no API calls, just list fixtures)
    python scripts/backfill_fixture_player_stats.py --dry-run
"""

import asyncio
import argparse
import logging
import sys
from pathlib import Path
from typing import List, Set, Tuple

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env")

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from config import Config
from database.supabase_client import SupabaseClient
from fpl_api.client import FPLAPIClient
from refresh.players import PlayerDataRefresher

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

PREFIX = "[BACKFILL-FIXTURE-STATS]"


def _log(msg: str) -> None:
    logger.info(f"{PREFIX} {msg}")


def _parse_gameweeks(s: str) -> List[int]:
    """Parse --gameweeks into a sorted list of integers (e.g. '25' or '20-25' or '1,5,25')."""
    out: Set[int] = set()
    for part in s.strip().split(","):
        part = part.strip()
        if "-" in part:
            a, b = part.split("-", 1)
            try:
                lo, hi = int(a.strip()), int(b.strip())
                out.update(range(lo, hi + 1))
            except ValueError:
                continue
        else:
            try:
                out.add(int(part))
            except ValueError:
                continue
    return sorted(out)


async def run(
    gameweeks: List[int],
    dry_run: bool,
    delay_between_fixtures: float,
) -> None:
    config = Config()
    db_client = SupabaseClient(config)
    fpl_client = FPLAPIClient(config)
    player_refresher = PlayerDataRefresher(fpl_client, db_client)

    # Resolve "current" gameweek if we used 0 or max
    gw_table = (
        db_client.client.table("gameweeks")
        .select("id")
        .eq("is_current", True)
        .limit(1)
        .execute()
    )
    current_gw = gw_table.data[0]["id"] if gw_table.data else None
    if not current_gw:
        _log("No current gameweek (is_current=true). Run bootstrap/refresh first.")
        return

    # If gameweeks is empty, default to 1..current
    if not gameweeks:
        gameweeks = list(range(1, current_gw + 1))
    else:
        # Clamp to 1..current so we don't try to backfill future GWs
        gameweeks = [gw for gw in gameweeks if 1 <= gw <= current_gw]

    if not gameweeks:
        _log("No gameweeks to process.")
        return

    _log(f"Gameweeks: {gameweeks}")
    _log(f"Dry run: {dry_run}")

    total_fixtures = 0
    total_players_refreshed = 0
    errors = 0

    for gw in gameweeks:
        fixtures = (
            db_client.client.table("fixtures")
            .select("fpl_fixture_id, home_team_id, away_team_id")
            .eq("gameweek", gw)
            .or_("finished.eq.true,finished_provisional.eq.true")
            .execute()
        )
        if not fixtures.data:
            continue
        for f in fixtures.data:
            home_id = f.get("home_team_id")
            away_id = f.get("away_team_id")
            if not home_id or not away_id:
                continue
            # All players from both teams (squad list; API returns only those with history for this GW)
            players_result = (
                db_client.client.table("players")
                .select("fpl_player_id")
                .in_("team_id", [home_id, away_id])
                .execute()
            )
            player_ids: Set[int] = {r["fpl_player_id"] for r in (players_result.data or []) if r.get("fpl_player_id")}
            if not player_ids:
                _log(f"GW{gw} fixture {f.get('fpl_fixture_id')} (H{home_id} v A{away_id}): no players in DB, skip")
                continue
            total_fixtures += 1
            if dry_run:
                _log(f"GW{gw} fixture {f.get('fpl_fixture_id')} (H{home_id} v A{away_id}): would refresh {len(player_ids)} players")
                total_players_refreshed += len(player_ids)
                continue
            try:
                _log(f"GW{gw} fixture {f.get('fpl_fixture_id')} (H{home_id} v A{away_id}): refreshing {len(player_ids)} players...")
                await player_refresher.refresh_player_gameweek_stats(
                    gw,
                    player_ids,
                    live_data=None,
                    fixtures=None,
                    bootstrap=None,
                    live_only=True,
                    expect_live_unavailable=True,
                )
                total_players_refreshed += len(player_ids)
                if delay_between_fixtures > 0:
                    await asyncio.sleep(delay_between_fixtures)
            except Exception as e:
                logger.exception(f"GW{gw} fixture {f.get('fpl_fixture_id')}: {e}")
                errors += 1

    _log(f"Done. Fixtures: {total_fixtures}, player-refresh sets: {total_players_refreshed}, errors: {errors}")

    if not dry_run and total_fixtures > 0 and errors == 0:
        _log("Refreshing materialized views (including mv_last_h2h_player_stats)...")
        try:
            db_client.refresh_all_materialized_views()
            _log("Materialized views refreshed.")
        except Exception as e:
            logger.warning(f"MV refresh failed: {e}. Run manually: SELECT refresh_all_materialized_views();")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Backfill player_gameweek_stats for full squads per finished fixture (for last H2H views)."
    )
    parser.add_argument(
        "--gameweeks",
        type=str,
        default="",
        help="Comma or range, e.g. 25 or 20-25 or 1,5,25. Default: 1..current_gw",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Only list fixtures and player counts, no API calls",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=1.0,
        help="Seconds to wait between fixtures (default 1.0)",
    )
    args = parser.parse_args()
    gameweeks = _parse_gameweeks(args.gameweeks) if args.gameweeks else []
    asyncio.run(run(gameweeks, args.dry_run, args.delay))


if __name__ == "__main__":
    main()
