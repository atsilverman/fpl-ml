#!/usr/bin/env python3
"""
Script to backfill overall_rank and gameweek_rank (and previous_overall_rank / rank gain-loss).

By default runs when at least one fixture for the current gameweek has finished_provisional
(same gate as orchestrator "end of gameday"). With --force, runs regardless (e.g. idle period)
so you can pull latest ranks and backfill previous_overall_rank for rank gain/loss display.

Refreshes all tracked managers (mini_league_managers), recalculates mini-league ranks,
and sets fpl_ranks_updated.

Usage:
    python3 scripts/backfill_gameweek_rank.py           # only when at least one matchday done
    python3 scripts/backfill_gameweek_rank.py --force   # now (e.g. idle between GWs)
"""

import asyncio
import sys
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables
load_dotenv(Path(__file__).parent.parent / ".env")

# Add src directory to path
backend_dir = Path(__file__).parent.parent
src_dir = backend_dir / "src"
sys.path.insert(0, str(src_dir))

import logging

from config import Config
from refresh.managers import ManagerDataRefresher
from fpl_api.client import FPLAPIClient
from database.supabase_client import SupabaseClient
from utils.logger import setup_logging

logger = logging.getLogger(__name__)


async def backfill_gameweek_rank(force: bool = False):
    """Backfill gameweek_rank and overall_rank for the current gameweek.
    With force=True, run even when no fixture has finished_provisional (e.g. idle period).
    """
    # Set up logging
    setup_logging()
    
    config = Config()
    fpl_client = FPLAPIClient(config)
    db_client = SupabaseClient(config)
    manager_refresher = ManagerDataRefresher(fpl_client, db_client)
    
    print("🔄 Initializing backfill...\n")
    
    try:
        # Get only the current gameweek
        current_gameweek_result = db_client.client.table("gameweeks").select(
            "id, name"
        ).eq("is_current", True).single().execute()
        
        if not current_gameweek_result.data:
            print("✅ No current gameweek found. Nothing to backfill.")
            return
        
        current_gameweek = current_gameweek_result.data
        gameweek = current_gameweek["id"]
        gameweek_name = current_gameweek["name"]
        
        # Without --force: require at least one fixture finished_provisional (same as orchestrator)
        if not force:
            fixtures = db_client.client.table("fixtures").select(
                "finished_provisional"
            ).eq("gameweek", gameweek).execute().data or []
            
            if not fixtures:
                print(f"⚠️  No fixtures found for {gameweek_name}. Nothing to backfill.")
                return
            
            if not any(f.get("finished_provisional") for f in fixtures):
                print(f"⚠️  No matchday completed yet for {gameweek_name}.")
                print("   At least one fixture must have finished_provisional = true.")
                print("   Run with --force to refresh anyway (e.g. idle period): python3 scripts/backfill_gameweek_rank.py --force")
                return
        
        print(f"📊 Processing current gameweek: {gameweek_name} (ID: {gameweek}){' [--force]' if force else ' [at least one matchday done]'}\n")
        
        # Get all tracked managers (same as orchestrator: mini_league_managers)
        managers_result = db_client.client.table("mini_league_managers").select(
            "manager_id"
        ).execute()
        manager_ids = list(set(m["manager_id"] for m in (managers_result.data or [])))
        
        if not manager_ids:
            print("⚠️  No tracked managers found in mini_league_managers. Nothing to backfill.")
            return
        
        print(f"👥 Found {len(manager_ids)} tracked manager(s) to process\n")
        
        # Process each manager for the current gameweek
        processed = 0
        errors = 0
        
        print(f"🔄 Processing {gameweek_name}...")
        
        for manager_id in manager_ids:
            try:
                # Refresh manager gameweek history (populates overall_rank, gameweek_rank when FPL has them)
                await manager_refresher.refresh_manager_gameweek_history(manager_id, gameweek)
                processed += 1
                
                if processed % 10 == 0:
                    print(f"   ✅ Processed {processed}/{len(manager_ids)} managers...")
                
                # Small delay to avoid rate limiting
                await asyncio.sleep(0.5)
                
            except Exception as e:
                errors += 1
                logger.error("Error backfilling gameweek rank", extra={
                    "manager_id": manager_id,
                    "gameweek": gameweek,
                    "error": str(e)
                })
                print(f"   ⚠️  Error for manager {manager_id}: {e}")
        
        # Recalculate mini-league ranks so league standings and league rank change update
        if processed > 0:
            leagues_result = db_client.client.table("mini_leagues").select("league_id").execute()
            for league in (leagues_result.data or []):
                try:
                    await manager_refresher.calculate_mini_league_ranks(league["league_id"], gameweek)
                except Exception as e:
                    logger.warning("League ranks failed", extra={"league_id": league["league_id"], "error": str(e)})
            print("   - Recalculated mini-league ranks.")
            db_client.update_gameweek_fpl_ranks_updated(gameweek, True)
            print("   - Set fpl_ranks_updated = true for this gameweek (stale indicator will clear).")
        
        print(f"\n✅ Backfill completed!")
        print(f"   - Processed: {processed}/{len(manager_ids)}")
        if errors > 0:
            print(f"   - Errors: {errors}")
        print(f"\n📊 overall_rank, gameweek_rank, and rank gain/loss (previous_overall_rank) should now be updated for {gameweek_name}.")
        
    except Exception as e:
        print(f"\n❌ Error during backfill: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    
    finally:
        # Clean up
        await fpl_client.close()


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Backfill overall_rank and gameweek_rank for current GW.")
    parser.add_argument("--force", action="store_true", help="Run even when no fixture has finished_provisional (e.g. idle period)")
    args = parser.parse_args()
    asyncio.run(backfill_gameweek_rank(force=args.force))
