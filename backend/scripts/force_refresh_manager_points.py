#!/usr/bin/env python3
"""
Force a full refresh of manager gameweek points for all tracked managers.

Use this when in IDLE (or any state) to immediately recalculate GW points,
total points, and mini league rank (e.g. after fixing auto-sub logic so DNP
starters get bench points). Updates manager_gameweek_history; optionally
refreshes materialized views so standings UI shows the new totals and ranks.

Usage:
    # From backend dir, using the same Python env as the refresh service (e.g. venv with requirements.txt installed):
    python3 scripts/force_refresh_manager_points.py
    python3 scripts/force_refresh_manager_points.py --no-mvs   # skip MV refresh
"""

import argparse
import asyncio
import sys
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


async def force_refresh_manager_points(refresh_mvs: bool = True, gameweek_override: Optional[int] = None):
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
        print(
            f"🔄 Refreshing manager points for all tracked managers (GW {orchestrator.current_gameweek})...\n"
        )
        await orchestrator._refresh_manager_points(force_all_managers=True)
        print("✅ Manager points refresh completed.")

        if refresh_mvs and orchestrator.db_client:
            print("🔄 Refreshing materialized views (standings)...")
            try:
                orchestrator.db_client.refresh_materialized_views_for_live()
                print("✅ Materialized views refreshed.")
            except Exception as e:
                print(f"⚠️ MV refresh failed: {e}")

        print("\n📊 Manager GW points, total points, and mini league rank now reflect auto-subs.")
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
        "--gw",
        type=int,
        metavar="N",
        help="Force gameweek N when DB has no is_current (e.g. off-season or script run before gameweeks refresh)",
    )
    args = parser.parse_args()
    asyncio.run(force_refresh_manager_points(refresh_mvs=not args.no_mvs, gameweek_override=args.gw))
