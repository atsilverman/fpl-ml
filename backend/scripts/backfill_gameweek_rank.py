#!/usr/bin/env python3
"""
Script to backfill overall_rank and gameweek_rank at end of match day.

Runs when all fixtures for the current gameweek have finished_provisional
(same gate as orchestrator "end of gameday"), not when gameweek.finished.
Refreshes all tracked managers (mini_league_managers) and sets fpl_ranks_updated.

Usage:
    python3 scripts/backfill_gameweek_rank.py
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


async def backfill_gameweek_rank():
    """Backfill gameweek_rank for the current gameweek (if finished)."""
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
        
        # End of gameday: all fixtures for this gameweek have finished_provisional (same as orchestrator)
        fixtures = db_client.client.table("fixtures").select(
            "finished_provisional"
        ).eq("gameweek", gameweek).execute().data or []
        
        if not fixtures:
            print(f"⚠️  No fixtures found for {gameweek_name}. Nothing to backfill.")
            return
        
        if not any(f.get("finished_provisional") for f in fixtures):
            print(f"⚠️  No matchday completed yet for {gameweek_name}.")
            print("   At least one fixture must have finished_provisional = true.")
            print("   Run again after the first matchday (e.g. Sat), or let the orchestrator handle it.")
            return
        
        print(f"📊 Processing current gameweek: {gameweek_name} (ID: {gameweek}) [at least one matchday done]\n")
        
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
        
        # Mark gameweek as having final ranks so frontend drops the ! stale indicator
        if processed > 0:
            db_client.update_gameweek_fpl_ranks_updated(gameweek, True)
            print("   - Set fpl_ranks_updated = true for this gameweek (stale indicator will clear).")
        
        print(f"\n✅ Backfill completed!")
        print(f"   - Processed: {processed}/{len(manager_ids)}")
        if errors > 0:
            print(f"   - Errors: {errors}")
        print(f"\n📊 overall_rank and gameweek_rank should now be populated for {gameweek_name}.")
        
    except Exception as e:
        print(f"\n❌ Error during backfill: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    
    finally:
        # Clean up
        await fpl_client.close()


if __name__ == "__main__":
    asyncio.run(backfill_gameweek_rank())
