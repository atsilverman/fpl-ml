#!/usr/bin/env python3
"""
Stress test for refresh operations.

Measures performance of refreshing all tables and provides detailed timing breakdown.
"""

import asyncio
import sys
import time
from pathlib import Path
from dotenv import load_dotenv
from collections import defaultdict

# Load environment variables
load_dotenv(Path(__file__).parent.parent / ".env")

# Add src directory to path
backend_dir = Path(__file__).parent.parent
src_dir = backend_dir / "src"
sys.path.insert(0, str(src_dir))

from config import Config
from refresh.orchestrator import RefreshOrchestrator
from utils.logger import setup_logging


class RefreshTimer:
    """Track timing for refresh operations."""
    
    def __init__(self):
        self.timings = defaultdict(list)
        self.start_times = {}
    
    def start(self, operation: str):
        """Start timing an operation."""
        self.start_times[operation] = time.time()
    
    def stop(self, operation: str):
        """Stop timing an operation and record duration."""
        if operation in self.start_times:
            duration = time.time() - self.start_times[operation]
            self.timings[operation].append(duration)
            del self.start_times[operation]
            return duration
        return 0
    
    def get_summary(self):
        """Get timing summary."""
        summary = {}
        for operation, durations in self.timings.items():
            if durations:
                summary[operation] = {
                    "count": len(durations),
                    "total": sum(durations),
                    "avg": sum(durations) / len(durations),
                    "min": min(durations),
                    "max": max(durations)
                }
        return summary


async def stress_test_full_refresh(runs: int = 3):
    """Run full refresh cycle multiple times and measure performance."""
    print("\n" + "="*70)
    print("STRESS TEST: Full Refresh Cycle")
    print("="*70)
    print(f"Running {runs} refresh cycles...\n")
    
    setup_logging()
    config = Config()
    orchestrator = RefreshOrchestrator(config)
    timer = RefreshTimer()
    
    try:
        await orchestrator.initialize()
        
        # Get current gameweek info
        gameweeks = orchestrator.db_client.get_gameweeks(is_current=True, limit=1)
        if gameweeks:
            current_gw = gameweeks[0]
            print(f"📅 Current Gameweek: {current_gw['id']} ({current_gw.get('name', 'N/A')})")
            print(f"   Finished: {current_gw.get('finished', False)}")
            print(f"   Data Checked: {current_gw.get('data_checked', False)}\n")
        
        # Get fixture info
        if orchestrator.current_gameweek:
            fixtures = orchestrator.db_client.client.table("fixtures").select("*").eq(
                "gameweek", orchestrator.current_gameweek
            ).execute().data
            
            live_matches = [f for f in fixtures if f.get("started") and not f.get("finished")]
            finished_matches = [f for f in fixtures if f.get("finished")]
            
            print(f"📊 Fixtures: {len(fixtures)} total")
            print(f"   ⚽ Live: {len(live_matches)}")
            print(f"   ✅ Finished: {len(finished_matches)}")
            print(f"   ⏸️  Scheduled: {len(fixtures) - len(live_matches) - len(finished_matches)}\n")
        
        # Run multiple refresh cycles
        for run in range(1, runs + 1):
            print(f"{'='*70}")
            print(f"RUN {run}/{runs}")
            print(f"{'='*70}\n")
            
            # Full refresh cycle
            timer.start("full_cycle")
            await orchestrator._refresh_cycle()
            timer.stop("full_cycle")
            
            print(f"✅ Run {run} completed\n")
        
        # Print summary
        print("\n" + "="*70)
        print("TIMING SUMMARY")
        print("="*70)
        
        summary = timer.get_summary()
        
        if "full_cycle" in summary:
            fc = summary["full_cycle"]
            print(f"\n📊 Full Refresh Cycle:")
            print(f"   Runs: {fc['count']}")
            print(f"   Total Time: {fc['total']:.2f}s")
            print(f"   Average: {fc['avg']:.2f}s")
            print(f"   Min: {fc['min']:.2f}s")
            print(f"   Max: {fc['max']:.2f}s")
        
        print("\n" + "="*70)
        
    except Exception as e:
        print(f"\n❌ Error during stress test: {e}")
        import traceback
        traceback.print_exc()
    finally:
        await orchestrator.shutdown()


async def stress_test_individual_operations():
    """Test individual refresh operations separately."""
    print("\n" + "="*70)
    print("STRESS TEST: Individual Operations")
    print("="*70)
    
    setup_logging()
    config = Config()
    orchestrator = RefreshOrchestrator(config)
    timer = RefreshTimer()
    
    try:
        await orchestrator.initialize()
        
        # Initialize current gameweek
        await orchestrator._refresh_gameweeks()
        
        print("\n🔄 Testing individual refresh operations...\n")
        
        # Test each operation
        operations = [
            ("Gameweeks", orchestrator._refresh_gameweeks),
            ("Fixtures", orchestrator._refresh_fixtures),
            ("Players", orchestrator._refresh_players),
            ("Manager Points", orchestrator._refresh_manager_points),
        ]
        
        for name, operation in operations:
            print(f"Testing {name}...")
            timer.start(name)
            try:
                await operation()
                duration = timer.stop(name)
                print(f"  ✅ {name}: {duration:.2f}s\n")
            except Exception as e:
                duration = timer.stop(name)
                print(f"  ⚠️  {name}: {duration:.2f}s (Error: {str(e)[:50]})\n")
        
        # Print summary
        print("\n" + "="*70)
        print("OPERATION TIMING SUMMARY")
        print("="*70)
        
        summary = timer.get_summary()
        
        total_time = 0
        for name, op_summary in sorted(summary.items()):
            print(f"\n📊 {name}:")
            print(f"   Time: {op_summary['avg']:.2f}s")
            total_time += op_summary['avg']
        
        print(f"\n📈 Total Estimated Time: {total_time:.2f}s")
        print("="*70)
        
    except Exception as e:
        print(f"\n❌ Error during stress test: {e}")
        import traceback
        traceback.print_exc()
    finally:
        await orchestrator.shutdown()


async def stress_test_with_breakdown():
    """Test with detailed breakdown of each phase."""
    print("\n" + "="*70)
    print("STRESS TEST: Detailed Breakdown")
    print("="*70)
    
    setup_logging()
    config = Config()
    orchestrator = RefreshOrchestrator(config)
    timer = RefreshTimer()
    
    try:
        await orchestrator.initialize()
        
        print("\n🔄 Running detailed refresh cycle...\n")
        
        # Phase 1: Gameweeks
        print("Phase 1: Refreshing Gameweeks...")
        timer.start("phase1_gameweeks")
        await orchestrator._refresh_gameweeks()
        phase1_time = timer.stop("phase1_gameweeks")
        print(f"  ✅ Completed in {phase1_time:.2f}s\n")
        
        # Detect state
        print("Detecting State...")
        timer.start("detect_state")
        state = await orchestrator._detect_state()
        state_time = timer.stop("detect_state")
        print(f"  ✅ State: {state.value} ({state_time:.3f}s)\n")
        
        # Phase 2: Fixtures
        print("Phase 2: Refreshing Fixtures...")
        timer.start("phase2_fixtures")
        await orchestrator._refresh_fixtures()
        phase2_time = timer.stop("phase2_fixtures")
        print(f"  ✅ Completed in {phase2_time:.2f}s\n")
        
        # Phase 3: Conditional refreshes
        print(f"Phase 3: Conditional Refreshes (State: {state.value})...")
        
        if state.value in ("live_matches", "bonus_pending"):
            print("  → Refreshing Players...")
            timer.start("phase3_players")
            await orchestrator._refresh_players()
            players_time = timer.stop("phase3_players")
            print(f"    ✅ Completed in {players_time:.2f}s")
            
            print("  → Refreshing Manager Points...")
            timer.start("phase3_manager_points")
            await orchestrator._refresh_manager_points()
            manager_time = timer.stop("phase3_manager_points")
            print(f"    ✅ Completed in {manager_time:.2f}s")
        else:
            print(f"  ⏭️  Skipped (State: {state.value})")
        
        # Phase 4: Materialized Views
        print("\nPhase 4: Refreshing Materialized Views...")
        timer.start("phase4_views")
        try:
            # Refresh all materialized views
            views = [
                "mv_mini_league_standings",
                "mv_manager_gameweek_summary",
                "mv_player_gameweek_performance",
                "mv_league_transfer_aggregation",
                "mv_player_owned_leaderboard",
                "mv_manager_transfer_impacts"
            ]
            
            for view in views:
                try:
                    orchestrator.db_client.refresh_materialized_view(view)
                    print(f"  ✅ {view}")
                except Exception as e:
                    print(f"  ⚠️  {view}: {str(e)[:50]}")
        
        except Exception as e:
            print(f"  ⚠️  Error: {str(e)[:50]}")
        
        views_time = timer.stop("phase4_views")
        print(f"  ✅ Completed in {views_time:.2f}s\n")
        
        # Print summary
        print("\n" + "="*70)
        print("DETAILED TIMING BREAKDOWN")
        print("="*70)
        
        summary = timer.get_summary()
        
        total = 0
        for phase, timing in sorted(summary.items()):
            print(f"\n📊 {phase.replace('_', ' ').title()}:")
            print(f"   Time: {timing['avg']:.2f}s")
            total += timing['avg']
        
        print(f"\n📈 Total Time: {total:.2f}s")
        print("="*70)
        
    except Exception as e:
        print(f"\n❌ Error during stress test: {e}")
        import traceback
        traceback.print_exc()
    finally:
        await orchestrator.shutdown()


async def main():
    """Run all stress tests."""
    print("\n" + "="*70)
    print("REFRESH STRESS TEST SUITE")
    print("="*70)
    print("\nThis will test:")
    print("1. Full refresh cycle (multiple runs)")
    print("2. Individual operations")
    print("3. Detailed breakdown")
    
    import argparse
    parser = argparse.ArgumentParser(description="Stress test refresh operations")
    parser.add_argument("--runs", type=int, default=3, help="Number of full cycle runs")
    parser.add_argument("--test", choices=["full", "individual", "breakdown", "all"], 
                       default="all", help="Which test to run")
    args = parser.parse_args()
    
    if args.test in ("full", "all"):
        await stress_test_full_refresh(runs=args.runs)
    
    if args.test in ("individual", "all"):
        await stress_test_individual_operations()
    
    if args.test in ("breakdown", "all"):
        await stress_test_with_breakdown()
    
    print("\n" + "="*70)
    print("STRESS TEST SUITE COMPLETE")
    print("="*70)


if __name__ == "__main__":
    asyncio.run(main())
