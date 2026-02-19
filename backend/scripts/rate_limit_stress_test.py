#!/usr/bin/env python3
"""
Rate-limit stress test for the FPL API.

Runs configurable workloads (players via element-summary, managers via refresh_manager_points)
with different throttle and batching strategies. Records request count, 429 count, duration,
and requests/min to a CSV and logs everything to a timestamped file. Use results to choose
production env values and plan scaling (managers/leagues).

Usage (from backend directory):
    python scripts/rate_limit_stress_test.py --workload players --runs-per-strategy 3
    python scripts/rate_limit_stress_test.py --workload both --log-dir logs --runs-per-strategy 5
    python scripts/rate_limit_stress_test.py --workload managers --sustained-minutes 10
    # Find ceiling: run highest first, then taper (max=180, ultra=150, very_aggressive=120)
    python scripts/rate_limit_stress_test.py --workload players --runs-per-strategy 1 --log-dir logs --strategies max,ultra,very_aggressive
"""

import argparse
import asyncio
import csv
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

backend_dir = Path(__file__).parent.parent
src_dir = backend_dir / "src"
sys.path.insert(0, str(src_dir))

from config import Config
from database.supabase_client import SupabaseClient
from fpl_api.client import FPLAPIClient
from refresh.orchestrator import RefreshOrchestrator
from refresh.players import PlayerDataRefresher
from utils.logger import setup_logging


# Strategy grid: name -> env/batch overrides for stress runs
STRATEGIES = [
    {
        "name": "conservative",
        "max_requests_per_minute": 30,
        "min_request_interval": 1.0,
        "manager_points_batch_size": 10,
        "manager_points_batch_sleep_seconds": 0.5,
        "element_summary_batch_size": 10,
    },
    {
        "name": "moderate",
        "max_requests_per_minute": 60,
        "min_request_interval": 0.5,
        "manager_points_batch_size": 20,
        "manager_points_batch_sleep_seconds": 0.25,
        "element_summary_batch_size": 20,
    },
    {
        "name": "aggressive",
        "max_requests_per_minute": 90,
        "min_request_interval": 0.34,
        "manager_points_batch_size": 25,
        "manager_points_batch_sleep_seconds": 0.0,
        "element_summary_batch_size": 30,
    },
    {
        "name": "very_aggressive",
        "max_requests_per_minute": 120,
        "min_request_interval": 0.25,
        "manager_points_batch_size": 30,
        "manager_points_batch_sleep_seconds": 0.0,
        "element_summary_batch_size": 40,
    },
    # Ceiling finders: run these first to trigger 429s, then taper to find limit
    {
        "name": "ultra",
        "max_requests_per_minute": 150,
        "min_request_interval": 0.2,
        "manager_points_batch_size": 35,
        "manager_points_batch_sleep_seconds": 0.0,
        "element_summary_batch_size": 50,
    },
    {
        "name": "max",
        "max_requests_per_minute": 180,
        "min_request_interval": 0.17,
        "manager_points_batch_size": 40,
        "manager_points_batch_sleep_seconds": 0.0,
        "element_summary_batch_size": 50,
    },
    {
        "name": "ceiling_400",
        "max_requests_per_minute": 400,
        "min_request_interval": 0.15,
        "manager_points_batch_size": 50,
        "manager_points_batch_sleep_seconds": 0.0,
        "element_summary_batch_size": 50,
    },
]


def _apply_strategy_env(strategy: dict) -> None:
    """Set environment variables for this strategy so Config() picks them up."""
    os.environ["MAX_REQUESTS_PER_MINUTE"] = str(strategy["max_requests_per_minute"])
    os.environ["MIN_REQUEST_INTERVAL"] = str(strategy["min_request_interval"])
    os.environ["MANAGER_POINTS_BATCH_SIZE"] = str(strategy["manager_points_batch_size"])
    os.environ["MANAGER_POINTS_BATCH_SLEEP_SECONDS"] = str(
        strategy["manager_points_batch_sleep_seconds"]
    )


def _max_requests_in_60s(timestamps: list) -> float:
    """Return max number of requests in any 60-second sliding window."""
    if not timestamps:
        return 0.0
    ts = sorted(timestamps)
    left = 0
    best = 0
    for right, t in enumerate(ts):
        while ts[left] < t - 60:
            left += 1
        best = max(best, right - left + 1)
    return float(best)


async def _run_players_workload(
    gw: int,
    player_ids: list,
    strategy: dict,
    run_id: int,
    sustained_minutes: float | None,
) -> dict:
    """Run players workload (element-summary path) with strategy env; return metrics row."""
    _apply_strategy_env(strategy)
    config = Config()
    db = SupabaseClient(config)
    fpl = FPLAPIClient(config)
    fpl.enable_metrics()
    refresher = PlayerDataRefresher(fpl, db)

    batch_size = strategy["element_summary_batch_size"]
    ids_set = set(player_ids)

    start = time.time()
    total_requests = 0
    total_429 = 0
    iterations = 0
    all_timestamps = []

    if sustained_minutes and sustained_minutes > 0:
        end_at = start + sustained_minutes * 60
        while time.time() < end_at:
            fpl.reset_metrics()
            await refresher.refresh_player_gameweek_stats(
                gw,
                ids_set,
                live_data=None,
                fixtures=None,
                bootstrap=None,
                live_only=False,
                expect_live_unavailable=True,
                element_summary_batch_size=batch_size,
                use_delta=False,
            )
            m = fpl.get_metrics()
            total_requests += m["request_count"]
            total_429 += m["count_429"]
            iterations += 1
            await asyncio.sleep(1)
        duration_sec = time.time() - start
        max_1min_rate = 0.0
    else:
        fpl.reset_metrics()
        await refresher.refresh_player_gameweek_stats(
            gw,
            ids_set,
            live_data=None,
            fixtures=None,
            bootstrap=None,
            live_only=False,
            expect_live_unavailable=True,
            element_summary_batch_size=batch_size,
            use_delta=False,
        )
        duration_sec = time.time() - start
        m = fpl.get_metrics()
        total_requests = m["request_count"]
        total_429 = m["count_429"]
        all_timestamps = m.get("request_timestamps", [])
        max_1min_rate = _max_requests_in_60s(all_timestamps)
        iterations = 1

    await fpl.close()
    fpl.disable_metrics()

    req_per_min = (total_requests / (duration_sec / 60)) if duration_sec > 0 else 0
    row = {
        "strategy_id": strategy["name"],
        "workload": "players",
        "run_id": run_id,
        "duration_sec": round(duration_sec, 2),
        "total_requests": total_requests,
        "429_count": total_429,
        "requests_per_minute": round(req_per_min, 2),
        "iterations": iterations,
    }
    row["max_1min_rate"] = round(max_1min_rate, 2) if not (sustained_minutes and sustained_minutes > 0) else ""
    return row


async def _run_managers_workload(
    gw: int,
    strategy: dict,
    run_id: int,
    sustained_minutes: float | None,
) -> dict:
    """Run managers workload (_refresh_manager_points) with strategy env; return metrics row."""
    _apply_strategy_env(strategy)
    config = Config()
    orchestrator = RefreshOrchestrator(config)
    await orchestrator.initialize()
    orchestrator.current_gameweek = gw

    client = orchestrator.fpl_client
    client.enable_metrics()

    start = time.time()
    total_requests = 0
    total_429 = 0
    iterations = 0
    max_1min_rate = 0.0

    if sustained_minutes and sustained_minutes > 0:
        end_at = start + sustained_minutes * 60
        while time.time() < end_at:
            client.reset_metrics()
            await orchestrator._refresh_manager_points(force_all_managers=True)
            m = client.get_metrics()
            total_requests += m["request_count"]
            total_429 += m["count_429"]
            iterations += 1
            await asyncio.sleep(2)
        duration_sec = time.time() - start
    else:
        client.reset_metrics()
        await orchestrator._refresh_manager_points(force_all_managers=True)
        duration_sec = time.time() - start
        m = client.get_metrics()
        total_requests = m["request_count"]
        total_429 = m["count_429"]
        max_1min_rate = _max_requests_in_60s(m.get("request_timestamps", []))
        iterations = 1

    client.disable_metrics()
    await orchestrator.shutdown()

    req_per_min = (total_requests / (duration_sec / 60)) if duration_sec > 0 else 0
    row = {
        "strategy_id": strategy["name"],
        "workload": "managers",
        "run_id": run_id,
        "duration_sec": round(duration_sec, 2),
        "total_requests": total_requests,
        "429_count": total_429,
        "requests_per_minute": round(req_per_min, 2),
        "iterations": iterations,
    }
    row["max_1min_rate"] = round(max_1min_rate, 2) if not (sustained_minutes and sustained_minutes > 0) else ""
    return row


def _append_csv_row(log_dir: Path, row: dict, csv_path: Path) -> None:
    """Append one result row to CSV; write header if new file."""
    file_exists = csv_path.exists()
    with open(csv_path, "a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=row.keys())
        if not file_exists:
            w.writeheader()
        w.writerow(row)


def _print_summary(rows: list, log_dir: Path) -> None:
    """Print and optionally write summary of results."""
    from collections import defaultdict

    by_strategy_workload = defaultdict(list)
    for r in rows:
        key = (r["strategy_id"], r["workload"])
        by_strategy_workload[key].append(r)

    summary_path = log_dir / "stress_test_summary.txt"
    lines = [
        "",
        "=" * 60,
        "RATE LIMIT STRESS TEST SUMMARY",
        "=" * 60,
    ]

    best_safe = None
    best_safe_req_min = -1

    for (strategy_id, workload), run_rows in sorted(by_strategy_workload.items()):
        total_429 = sum(r["429_count"] for r in run_rows)
        avg_duration = sum(r["duration_sec"] for r in run_rows) / len(run_rows)
        avg_req_min = sum(r["requests_per_minute"] for r in run_rows) / len(run_rows)
        recommendation = "safe" if total_429 == 0 else "aggressive (429s seen)"
        if total_429 == 0 and avg_req_min > best_safe_req_min:
            best_safe_req_min = avg_req_min
            best_safe = (strategy_id, workload)

        block = [
            f"\n{strategy_id} / {workload}:",
            f"  runs: {len(run_rows)}",
            f"  avg duration (s): {avg_duration:.2f}",
            f"  avg requests/min: {avg_req_min:.2f}",
            f"  total 429s: {total_429}",
            f"  recommendation: {recommendation}",
        ]
        text = "\n".join(block)
        lines.append(text)
        print(text)

    if best_safe:
        rec_text = (
            f"\nRecommended production (highest req/min with 0 429s): "
            f"{best_safe[0]} for {best_safe[1]} workload (~{best_safe_req_min:.1f} req/min)"
        )
        lines.append(rec_text)
        print(rec_text)

    lines.append("\n" + "=" * 60)
    full = "\n".join(lines)
    with open(summary_path, "w", encoding="utf-8") as f:
        f.write(full)
    print(f"\nSummary written to {summary_path}")


async def main() -> None:
    parser = argparse.ArgumentParser(
        description="Rate-limit stress test: try strategies and record rates/429s to logs and CSV."
    )
    parser.add_argument(
        "--log-dir",
        type=Path,
        default=backend_dir / "logs",
        help="Directory for log file and results CSV (default: backend/logs)",
    )
    parser.add_argument(
        "--workload",
        choices=["players", "managers", "both"],
        default="players",
        help="Workload to run (default: players)",
    )
    parser.add_argument(
        "--runs-per-strategy",
        type=int,
        default=3,
        help="Number of runs per strategy when not using --sustained-minutes (default: 3)",
    )
    parser.add_argument(
        "--sustained-minutes",
        type=float,
        default=None,
        metavar="N",
        help="Run workload in a loop for N minutes (one aggregated row per strategy)",
    )
    parser.add_argument(
        "--gw",
        type=int,
        default=None,
        help="Gameweek (default: current from DB)",
    )
    parser.add_argument(
        "--max-players",
        type=int,
        default=400,
        help="Max player IDs for players workload (default: 400)",
    )
    parser.add_argument(
        "--strategies",
        type=str,
        default=None,
        metavar="NAMES",
        help="Comma-separated strategy names to run (default: all). e.g. aggressive,very_aggressive",
    )
    args = parser.parse_args()

    log_dir = args.log_dir.resolve()
    log_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    log_file = log_dir / f"stress_{timestamp}.log"
    setup_logging(log_file=log_file)
    print(f"Logging to {log_file}")

    csv_path = log_dir / "stress_test_results.csv"
    all_rows = []

    # Resolve gameweek and player/manager IDs using default config (no overrides)
    config = Config()
    db = SupabaseClient(config)
    if args.gw is not None:
        gw = args.gw
    else:
        r = db.client.table("gameweeks").select("id").eq("is_current", True).limit(1).execute()
        if not r.data:
            r = db.client.table("gameweeks").select("id").order("id", desc=True).limit(1).execute()
        if not r.data:
            print("No gameweek in DB. Use --gw N or run backfill.")
            sys.exit(1)
        gw = r.data[0]["id"]
    print(f"Gameweek: {gw}\n")

    player_ids = []
    manager_ids = []
    if args.workload in ("players", "both"):
        bootstrap = await FPLAPIClient(config).get_bootstrap_static(use_cache=False)
        elements = bootstrap.get("elements", [])
        player_ids = [int(e["id"]) for e in elements if e.get("id")][: args.max_players]
        await FPLAPIClient(config).close()
        print(f"Players workload: {len(player_ids)} player IDs (max {args.max_players})")
    if args.workload in ("managers", "both"):
        r = db.client.table("mini_league_managers").select("manager_id").execute()
        manager_ids = list({row["manager_id"] for row in (r.data or []) if row.get("manager_id")})
        if not manager_ids:
            print("No tracked managers in DB. Load leagues first (e.g. load_leagues.py).")
            if args.workload == "managers":
                sys.exit(1)
        else:
            print(f"Managers workload: {len(manager_ids)} tracked managers")

    workloads = []
    if args.workload == "players":
        workloads.append("players")
    elif args.workload == "managers":
        workloads.append("managers")
    else:
        workloads = ["players", "managers"]

    strategies_to_run = STRATEGIES
    if args.strategies:
        names = [s.strip().lower() for s in args.strategies.split(",") if s.strip()]
        strategies_to_run = [s for s in STRATEGIES if s["name"].lower() in names]
        if not strategies_to_run:
            print(f"No strategies match: {args.strategies}. Available: {[s['name'] for s in STRATEGIES]}")
            sys.exit(1)
        print(f"Strategies: {[s['name'] for s in strategies_to_run]}\n")

    for strategy in strategies_to_run:
        for wl in workloads:
            if wl == "players" and not player_ids:
                continue
            if wl == "managers" and not manager_ids:
                continue
            runs = 1 if args.sustained_minutes else args.runs_per_strategy
            for run_id in range(1, runs + 1):
                print(f"\nStrategy={strategy['name']} workload={wl} run={run_id}/{runs} ...")
                try:
                    if wl == "players":
                        row = await _run_players_workload(
                            gw, player_ids, strategy, run_id, args.sustained_minutes,
                        )
                    else:
                        row = await _run_managers_workload(
                            gw, strategy, run_id, args.sustained_minutes,
                        )
                    _append_csv_row(log_dir, row, csv_path)
                    all_rows.append(row)
                    msg = (
                        f"  duration={row['duration_sec']}s requests={row['total_requests']} "
                        f"429s={row['429_count']} req/min={row['requests_per_minute']}"
                    )
                    if "max_1min_rate" in row:
                        msg += f" max_1m={row['max_1min_rate']}"
                    print(msg)
                except Exception as e:
                    print(f"  Error: {e}")
                    import traceback
                    traceback.print_exc()

    if all_rows:
        _print_summary(all_rows, log_dir)
    print(f"\nResults CSV: {csv_path}")


if __name__ == "__main__":
    asyncio.run(main())
