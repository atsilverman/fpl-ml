#!/usr/bin/env python3
"""
Force a full refresh of manager gameweek points for all tracked managers.

Use this when in IDLE (or any state) to immediately recalculate GW points,
total points, and mini league rank (e.g. after fixing auto-sub logic so DNP
starters get bench points, or after fixing DGW so double-gameweek player
points are summed correctly). Updates manager_gameweek_history; optionally
refreshes materialized views so standings UI shows the new totals and ranks.

Usage:
    # From backend dir, using the same Python env as the refresh service (e.g. venv with requirements.txt installed):
    python3 scripts/force_refresh_manager_points.py
    python3 scripts/force_refresh_manager_points.py --no-mvs   # skip MV refresh
    python3 scripts/force_refresh_manager_points.py --db-only  # DB-only recalc (no FPL API), sub-minute
"""

import argparse
import asyncio
import sys
import time
from pathlib import Path
from typing import Optional
from dotenv import load_dotenv

# Load environment variables
load_dotenv(Path(__file__).parent.parent / ".env")

# Add src directory to path
backend_dir = Path(__file__).parent.parent
src_dir = backend_dir / "src"
sys.path.insert(0, str(src_dir))

from config import Config
from refresh.orchestrator import RefreshOrchestrator
from utils.logger import setup_logging


async def force_refresh_manager_points(
    refresh_mvs: bool = True,
    gameweek_override: Optional[int] = None,
    db_only: bool = False,
):
    """Run manager points refresh for all tracked managers, then optionally refresh MVs."""
    setup_logging()

    config = Config()
    orchestrator = RefreshOrchestrator(config)

    print("🔄 Initializing refresh orchestrator...\n")

    try:
        await orchestrator.initialize()
        print("✅ Orchestrator initialized")

        # Set current_gameweek: refresh gameweeks from API then detect state, or use --gw override
        if gameweek_override is not None:
            orchestrator.current_gameweek = gameweek_override
            print(f"📌 Using gameweek override: GW {gameweek_override}\n")
        else:
            bootstrap = await orchestrator._refresh_gameweeks()
            if bootstrap:
                print("✅ Gameweeks refreshed")
            orchestrator.current_state = await orchestrator._detect_state()
            if orchestrator.current_state.value != "idle":
                print(f"📌 State: {orchestrator.current_state.value}\n")

        if not orchestrator.current_gameweek:
            print("⚠️ No current gameweek (DB has no is_current GW). Use --gw N to force a gameweek.")
            return

        gw = orchestrator.current_gameweek
        total_start = time.perf_counter()

        if db_only:
            # DB-only path: no FPL API calls, recalc points from manager_picks + player_gameweek_stats
            manager_ids = orchestrator._get_tracked_manager_ids()
            if not manager_ids:
                print("⚠️ No tracked managers.")
                return
            print(
                f"🔄 Refreshing manager points (DB-only, no API) for {len(manager_ids)} managers (GW {gw})...\n"
            )
            points_start = time.perf_counter()
            ok = await orchestrator.manager_refresher.refresh_manager_gameweek_points_live_only(
                manager_ids, gw
            )
            points_elapsed = time.perf_counter() - points_start
            print(f"✅ Manager points refresh completed in {points_elapsed:.1f}s (DB-only).")
            if not ok:
                print("⚠️ Some managers failed to update.")

            # Recalculate mini-league ranks (same logic as orchestrator)
            try:
                fixtures = orchestrator.db_client.client.table("fixtures").select("started").eq(
                    "gameweek", gw
                ).execute().data
                any_fixture_started = any(f.get("started", False) for f in (fixtures or []))
            except Exception:
                any_fixture_started = False
            if any_fixture_started:
                leagues_result = orchestrator.db_client.client.table("mini_leagues").select(
                    "league_id"
                ).execute()
                for league in (leagues_result.data or []):
                    try:
                        await orchestrator.manager_refresher.calculate_mini_league_ranks(
                            league["league_id"], gw
                        )
                    except Exception as e:
                        print(f"⚠️ League ranks failed for league {league['league_id']}: {e}")
        else:
            print(f"🔄 Refreshing manager points for all tracked managers (GW {gw})...\n")
            points_start = time.perf_counter()
            await orchestrator._refresh_manager_points(force_all_managers=True)
            points_elapsed = time.perf_counter() - points_start
            print(f"✅ Manager points refresh completed in {points_elapsed:.1f}s.")

        if refresh_mvs and orchestrator.db_client:
            print("🔄 Refreshing materialized views (standings)...")
            mv_start = time.perf_counter()
            try:
                orchestrator.db_client.refresh_materialized_views_for_live()
                print(f"✅ Materialized views refreshed in {time.perf_counter() - mv_start:.1f}s.")
            except Exception as e:
                print(f"⚠️ MV refresh failed: {e}")

        total_elapsed = time.perf_counter() - total_start
        print(f"\n📊 Total: {total_elapsed:.1f}s. Manager GW points, total points, and mini league rank updated.")
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        await orchestrator.shutdown()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Force refresh manager gameweek points for all tracked managers.")
    parser.add_argument(
        "--no-mvs",
        action="store_true",
        help="Skip materialized views refresh after manager points",
    )
    parser.add_argument(
        "--db-only",
        action="store_true",
        help="DB-only recalc (no FPL API). Use when only points/standings need updating; sub-minute.",
    )
    parser.add_argument(
        "--gw",
        type=int,
        metavar="N",
        help="Force gameweek N when DB has no is_current (e.g. off-season or script run before gameweeks refresh)",
    )
    args = parser.parse_args()
    asyncio.run(
        force_refresh_manager_points(
            refresh_mvs=not args.no_mvs,
            gameweek_override=args.gw,
            db_only=args.db_only,
        )
    )
