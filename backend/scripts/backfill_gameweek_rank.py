#!/usr/bin/env python3
"""
Script to backfill gameweek_rank for the current gameweek (if finished).

This script will:
1. Get the current gameweek (is_current = true)
2. Check if it's finished
3. Get all tracked managers
4. Refresh manager gameweek history for the current gameweek
   (which will populate gameweek_rank from the picks endpoint)

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
            "id, name, finished"
        ).eq("is_current", True).single().execute()
        
        if not current_gameweek_result.data:
            print("✅ No current gameweek found. Nothing to backfill.")
            return
        
        current_gameweek = current_gameweek_result.data
        
        if not current_gameweek.get("finished"):
            print(f"⚠️  Current gameweek ({current_gameweek['name']}) is not finished yet.")
            print("   gameweek_rank will be populated automatically when the gameweek finishes.")
            return
        
        gameweek = current_gameweek["id"]
        gameweek_name = current_gameweek["name"]
        
        print(f"📊 Processing current gameweek: {gameweek_name} (ID: {gameweek})\n")
        
        # Get all tracked managers
        managers = db_client.client.table("managers").select(
            "manager_id, manager_name"
        ).execute().data
        
        if not managers:
            print("⚠️  No managers found. Nothing to backfill.")
            return
        
        print(f"👥 Found {len(managers)} manager(s) to process\n")
        
        # Process each manager for the current gameweek
        processed = 0
        errors = 0
        
        print(f"🔄 Processing {gameweek_name}...")
        
        for manager in managers:
            manager_id = manager["manager_id"]
            manager_name = manager["manager_name"]
            
            try:
                # Refresh manager gameweek history (will populate gameweek_rank if finished)
                await manager_refresher.refresh_manager_gameweek_history(manager_id, gameweek)
                processed += 1
                
                if processed % 10 == 0:
                    print(f"   ✅ Processed {processed}/{len(managers)} managers...")
                
                # Small delay to avoid rate limiting
                await asyncio.sleep(0.5)
                
            except Exception as e:
                errors += 1
                logger.error("Error backfilling gameweek rank", extra={
                    "manager_id": manager_id,
                    "manager_name": manager_name,
                    "gameweek": gameweek,
                    "error": str(e)
                })
                print(f"   ⚠️  Error for {manager_name}: {e}")
        
        print(f"\n✅ Backfill completed!")
        print(f"   - Processed: {processed}/{len(managers)}")
        if errors > 0:
            print(f"   - Errors: {errors}")
        print(f"\n📊 gameweek_rank should now be populated for {gameweek_name}.")
        
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
