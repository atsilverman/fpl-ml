#!/usr/bin/env python3
"""
Force-run the deadline batch (post-deadline refresh) for a gameweek.

Bypasses state and DB "already completed" checks. Runs the full batch:
picks+transfers, seed history from previous GW, league ranks, baselines,
whitelist, transfer aggregation, materialized views. Use this to populate
player lists and league tables when the service didn't run after the deadline.

Managers: all from mini_league_managers (tracked leagues) plus REQUIRED_MANAGER_IDS
or VITE_MANAGER_ID from env so a specific manager (e.g. 344182) is included.

Usage:
    cd backend && python scripts/run_deadline_batch_test.py
    cd backend && python scripts/run_deadline_batch_test.py --gameweek 27
    cd backend && python scripts/run_deadline_batch_test.py --gameweek 27 --record-success
"""

import argparse
import asyncio
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

backend_dir = Path(__file__).parent.parent
src_dir = backend_dir / "src"
sys.path.insert(0, str(src_dir))

from config import Config
from refresh.orchestrator import RefreshOrchestrator
from utils.logger import setup_logging

PHASE_LABELS = {
    "bootstrap_check_sec": "Bootstrap check",
    "settle_sec": "Settle",
    "picks_and_transfers_sec": "Picks + transfers",
    "history_refresh_sec": "History refresh",
    "baselines_sec": "Baselines",
    "whitelist_sec": "Whitelist",
    "transfer_aggregation_sec": "Transfer aggregation",
    "materialized_views_sec": "Materialized views",
}


def format_sec(s: float) -> str:
    if s < 60:
        return f"{int(s)}s"
    m = int(s // 60)
    r = int(s % 60)
    return f"{m}m {r}s" if r > 0 else f"{m}m"


async def main():
    parser = argparse.ArgumentParser(description="Force-run deadline batch (post-deadline refresh)")
    parser.add_argument("--gameweek", type=int, default=None, help="Gameweek to run for (default: current)")
    parser.add_argument("--record-success", action="store_true", help="Record run in deadline_batch_runs so the service won't re-run")
    args = parser.parse_args()

    setup_logging()
    config = Config()
    orchestrator = RefreshOrchestrator(config)

    print("Deadline batch test run")
    print("=" * 50)

    try:
        await orchestrator.initialize()
        result = await orchestrator.run_deadline_batch_test(
            gameweek=args.gameweek, record_success=args.record_success
        )
        await orchestrator.shutdown()
    except Exception as e:
        print(f"\nError: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

    if "error" in result and "phase" not in result:
        print(f"\nFailed: {result['error']}")
        sys.exit(1)

    if "error" in result:
        err = result["error"]
        if err and " fixtures for GW have started" in str(err):
            print(f"\nFailed: {err}")
            sys.exit(1)
        print(f"\nWarning: {err}")

    phase = result.get("phase", {})
    total = result.get("total_sec", 0)

    print(f"\nGameweek: GW {result.get('gameweek')}")
    print(f"Managers: {result.get('manager_count')}")
    print(f"Leagues: {result.get('league_count')}")
    print(f"Total: {format_sec(total)}")
    print("\nPhase breakdown:")
    for k, v in phase.items():
        if v is not None:
            label = PHASE_LABELS.get(k, k)
            print(f"  {label}: {format_sec(v)}")

    print("\n" + "=" * 50)
    print(f"Completed in {format_sec(total)}")


if __name__ == "__main__":
    asyncio.run(main())
