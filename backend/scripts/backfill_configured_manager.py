#!/usr/bin/env python3
"""
Backfill Data for Configured Manager

This script checks and backfills all missing data for the configured manager,
including:
1. Manager picks (needed for total points bar graph)
2. Player gameweek stats (needed for total points bar graph)
3. Manager gameweek history (needed for overall rank chart, team value chart)
4. Refreshes materialized views (especially mv_player_owned_leaderboard)

The configured manager ID is read from environment variable VITE_MANAGER_ID
or can be passed as a command-line argument.

Usage:
    # Backfill all tracked managers (recommended)
    python scripts/backfill_configured_manager.py --all-managers
    
    # Backfill configured manager (from env var)
    python scripts/backfill_configured_manager.py
    
    # Backfill specific manager
    python scripts/backfill_configured_manager.py --manager-id 344182
    
    # Check what's missing without backfilling
    python scripts/backfill_configured_manager.py --all-managers --check-only
    
    # Force refresh (overwrite existing data)
    python scripts/backfill_configured_manager.py --all-managers --force
"""

import asyncio
import argparse
import logging
import os
import sys
from pathlib import Path
from typing import List, Optional

# Load environment variables
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env")

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from config import Config
from database.supabase_client import SupabaseClient
from fpl_api.client import FPLAPIClient
from refresh.managers import ManagerDataRefresher
from refresh.players import PlayerDataRefresher

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


async def check_missing_data(
    db_client: SupabaseClient,
    manager_id: int
) -> dict:
    """
    Check what data is missing for the configured manager.
    Only considers the current (live) gameweek (is_current=true).
    
    Returns a dict with missing data information.
    """
    logger.info(f"Checking missing data for manager {manager_id}...")
    
    # Only the current (live) gameweek
    current_gw_result = db_client.client.table("gameweeks").select(
        "id"
    ).eq("is_current", True).limit(1).execute()
    if not current_gw_result.data:
        logger.warning("No current gameweek (is_current=true) in DB; run bootstrap/refresh first.")
        return {
            "all_gameweeks": [],
            "missing_picks": [],
            "missing_history": [],
            "missing_player_stats": [],
            "has_mv_data": False,
            "total_gameweeks": 0,
            "picks_coverage": 0,
            "history_coverage": 0,
        }
    all_gameweeks = [current_gw_result.data[0]["id"]]
    
    # Check manager_picks (only for current gameweek)
    picks_result = db_client.client.table("manager_picks").select(
        "gameweek"
    ).eq("manager_id", manager_id).in_("gameweek", all_gameweeks).execute()
    picks_gameweeks = set([p["gameweek"] for p in picks_result.data])
    missing_picks = [gw for gw in all_gameweeks if gw not in picks_gameweeks]
    
    # Check manager_gameweek_history (only for current gameweek)
    history_result = db_client.client.table("manager_gameweek_history").select(
        "gameweek"
    ).eq("manager_id", manager_id).in_("gameweek", all_gameweeks).execute()
    history_gameweeks = set([h["gameweek"] for h in history_result.data])
    missing_history = [gw for gw in all_gameweeks if gw not in history_gameweeks]
    
    # Check player_gameweek_stats only for the current gameweek (players owned this GW)
    owned_players_result = db_client.client.table("manager_picks").select(
        "player_id, gameweek"
    ).eq("manager_id", manager_id).in_("gameweek", all_gameweeks).execute()
    
    owned_players_by_gw = {}
    for pick in owned_players_result.data:
        gw = pick["gameweek"]
        player_id = pick["player_id"]
        if gw not in owned_players_by_gw:
            owned_players_by_gw[gw] = set()
        owned_players_by_gw[gw].add(player_id)
    
    # Only check stats for gameweeks we care about (current GW)
    missing_player_stats = []
    for gw in all_gameweeks:
        player_ids = owned_players_by_gw.get(gw) or set()
        if not player_ids:
            continue
        stats_result = db_client.client.table("player_gameweek_stats").select(
            "player_id"
        ).eq("gameweek", gw).in_("player_id", list(player_ids)).execute()
        stats_player_ids = set([s["player_id"] for s in stats_result.data])
        missing_for_gw = player_ids - stats_player_ids
        if missing_for_gw:
            missing_player_stats.append({
                "gameweek": gw,
                "player_ids": list(missing_for_gw),
                "count": len(missing_for_gw)
            })
    
    # Check materialized view mv_player_owned_leaderboard
    mv_result = db_client.client.table("mv_player_owned_leaderboard").select(
        "player_id"
    ).eq("manager_id", manager_id).limit(1).execute()
    has_mv_data = len(mv_result.data) > 0
    
    return {
        "all_gameweeks": all_gameweeks,
        "missing_picks": missing_picks,
        "missing_history": missing_history,
        "missing_player_stats": missing_player_stats,
        "has_mv_data": has_mv_data,
        "total_gameweeks": len(all_gameweeks),
        "picks_coverage": len(picks_gameweeks),
        "history_coverage": len(history_gameweeks)
    }


async def backfill_all_managers(
    check_only: bool = False,
    force: bool = False
):
    """
    Backfill all tracked managers.
    
    Args:
        check_only: If True, only check what's missing without backfilling
        force: If True, overwrite existing data (default: False)
    """
    config = Config()
    db_client = SupabaseClient(config)
    
    try:
        # Get all tracked managers
        managers_result = db_client.client.table("mini_league_managers").select(
            "manager_id"
        ).execute()
        
        if not managers_result.data:
            logger.error("No tracked managers found in database")
            return
        
        manager_ids = list(set([m["manager_id"] for m in managers_result.data]))
        logger.info(f"Found {len(manager_ids)} tracked managers to process")
        
        if check_only:
            # Just check all managers
            for idx, manager_id in enumerate(manager_ids, 1):
                logger.info(f"\n[{idx}/{len(manager_ids)}] Checking manager {manager_id}...")
                missing_data = await check_missing_data(db_client, manager_id)
                
                logger.info(f"Manager {manager_id}:")
                logger.info(f"  Picks coverage: {missing_data['picks_coverage']}/{missing_data['total_gameweeks']} gameweeks")
                logger.info(f"  History coverage: {missing_data['history_coverage']}/{missing_data['total_gameweeks']} gameweeks")
                logger.info(f"  Materialized view has data: {missing_data['has_mv_data']}")
                
                if missing_data['missing_picks']:
                    logger.info(f"  ⚠️  Missing picks: {len(missing_data['missing_picks'])} gameweeks")
                if missing_data['missing_history']:
                    logger.info(f"  ⚠️  Missing history: {len(missing_data['missing_history'])} gameweeks")
        else:
            # Backfill all managers
            fpl_client = FPLAPIClient(config)
            manager_refresher = ManagerDataRefresher(fpl_client, db_client)
            player_refresher = PlayerDataRefresher(fpl_client, db_client)
            
            try:
                for idx, manager_id in enumerate(manager_ids, 1):
                    logger.info(f"\n{'='*60}")
                    logger.info(f"[{idx}/{len(manager_ids)}] Processing manager {manager_id}...")
                    logger.info(f"{'='*60}")
                    
                    await backfill_configured_manager(
                        manager_id=manager_id,
                        check_only=False,
                        force=force,
                        db_client=db_client,
                        fpl_client=fpl_client,
                        manager_refresher=manager_refresher,
                        player_refresher=player_refresher
                    )
                    
                    # Small delay between managers
                    await asyncio.sleep(1)
                
                # Refresh materialized views once at the end
                logger.info(f"\n{'='*60}")
                logger.info("Refreshing all materialized views...")
                logger.info(f"{'='*60}")
                try:
                    db_client.refresh_all_materialized_views()
                    logger.info("✅ All materialized views refreshed")
                except Exception as e:
                    logger.error(f"❌ Error refreshing materialized views: {str(e)}")
                
            finally:
                if fpl_client:
                    await fpl_client.close()
                    
    except Exception as e:
        logger.error(f"Fatal error during backfill: {str(e)}", exc_info=True)
        raise


async def backfill_configured_manager(
    manager_id: Optional[int] = None,
    check_only: bool = False,
    force: bool = False,
    db_client: Optional[SupabaseClient] = None,
    fpl_client: Optional[FPLAPIClient] = None,
    manager_refresher: Optional[ManagerDataRefresher] = None,
    player_refresher: Optional[PlayerDataRefresher] = None
):
    """
    Backfill all data for the configured manager.
    
    Args:
        manager_id: Specific manager ID (optional, uses env var if not provided)
        check_only: If True, only check what's missing without backfilling
        force: If True, overwrite existing data (default: False)
    """
    # Initialize clients if not provided (for single manager mode)
    config = Config()
    if db_client is None:
        db_client = SupabaseClient(config)
    if fpl_client is None:
        fpl_client = FPLAPIClient(config)
    if manager_refresher is None:
        manager_refresher = ManagerDataRefresher(fpl_client, db_client)
    if player_refresher is None:
        player_refresher = PlayerDataRefresher(fpl_client, db_client)
    
    should_close_fpl_client = fpl_client is not None and db_client is None
    
    try:
        # Get manager ID
        if not manager_id:
            # Try environment variable
            manager_id = os.getenv("VITE_MANAGER_ID") or os.getenv("MANAGER_ID")
            if manager_id:
                manager_id = int(manager_id)
            else:
                # List available managers from mini_league_managers
                logger.info("No manager ID provided. Listing available managers...")
                try:
                    managers_result = db_client.client.table("mini_league_managers").select(
                        "manager_id, managers(manager_name)"
                    ).limit(20).execute()
                    
                    if managers_result.data:
                        logger.info("\nAvailable managers:")
                        manager_ids = list(set([m["manager_id"] for m in managers_result.data]))
                        for mid in manager_ids[:10]:  # Show first 10
                            manager_info = next((m for m in managers_result.data if m["manager_id"] == mid), None)
                            name = manager_info.get("managers", {}).get("manager_name", "Unknown") if manager_info else "Unknown"
                            logger.info(f"  Manager ID: {mid} - {name}")
                        if len(manager_ids) > 10:
                            logger.info(f"  ... and {len(manager_ids) - 10} more")
                        logger.info("\n💡 Usage: python3 scripts/backfill_configured_manager.py --manager-id <ID>")
                        logger.info("   Or set VITE_MANAGER_ID in your .env file")
                    else:
                        logger.error("No tracked managers found in database")
                except Exception as e:
                    logger.error(f"Error listing managers: {str(e)}")
                logger.error("\nNo manager ID provided. Set VITE_MANAGER_ID env var or use --manager-id")
                return
        
        logger.info(f"Processing manager {manager_id}")
        
        # Check what's missing
        missing_data = await check_missing_data(db_client, manager_id)
        
        logger.info("=" * 60)
        logger.info("Data Coverage Report:")
        logger.info(f"  Total gameweeks: {missing_data['total_gameweeks']}")
        logger.info(f"  Manager picks coverage: {missing_data['picks_coverage']}/{missing_data['total_gameweeks']} gameweeks")
        logger.info(f"  Manager history coverage: {missing_data['history_coverage']}/{missing_data['total_gameweeks']} gameweeks")
        logger.info(f"  Materialized view has data: {missing_data['has_mv_data']}")
        logger.info("=" * 60)
        
        if missing_data['missing_picks']:
            logger.info(f"⚠️  Missing manager picks for {len(missing_data['missing_picks'])} gameweeks: {missing_data['missing_picks']}")
        if missing_data['missing_history']:
            logger.info(f"⚠️  Missing manager history for {len(missing_data['missing_history'])} gameweeks: {missing_data['missing_history']}")
        if missing_data['missing_player_stats']:
            total_missing = sum(m['count'] for m in missing_data['missing_player_stats'])
            logger.info(f"⚠️  Missing player stats for {total_missing} player-gameweek combinations across {len(missing_data['missing_player_stats'])} gameweeks")
        if not missing_data['has_mv_data']:
            logger.info("⚠️  Materialized view mv_player_owned_leaderboard has no data for this manager")
        
        if check_only:
            logger.info("\n✅ Check complete. Use without --check-only to backfill missing data.")
            return
        
        # Backfill manager picks
        if missing_data['missing_picks']:
            logger.info(f"\n📥 Backfilling manager picks for {len(missing_data['missing_picks'])} gameweeks...")
            for gw in missing_data['missing_picks']:
                try:
                    if not force:
                        existing = db_client.client.table("manager_picks").select(
                            "id"
                        ).eq("manager_id", manager_id).eq("gameweek", gw).limit(1).execute()
                        if existing.data:
                            logger.debug(f"  GW {gw}: Already exists, skipping")
                            continue
                    
                    logger.info(f"  Backfilling picks for GW {gw}...")
                    await manager_refresher.refresh_manager_picks(
                        manager_id,
                        gw,
                        use_cache=False
                    )
                    
                    # Refresh player stats for owned players
                    picks_result = db_client.client.table("manager_picks").select(
                        "player_id"
                    ).eq("manager_id", manager_id).eq("gameweek", gw).execute()
                    
                    if picks_result.data:
                        player_ids = list(set([p["player_id"] for p in picks_result.data]))
                        logger.debug(f"  Refreshing stats for {len(player_ids)} players...")
                        await player_refresher.refresh_player_gameweek_stats(gw, player_ids)
                    
                    await asyncio.sleep(2)  # Rate limiting
                except Exception as e:
                    logger.error(f"  Error backfilling picks for GW {gw}: {str(e)}")
                    continue
            logger.info("✅ Manager picks backfill complete")
        else:
            logger.info("✅ Manager picks already complete")
        
        # Backfill manager history
        if missing_data['missing_history']:
            logger.info(f"\n📥 Backfilling manager history for {len(missing_data['missing_history'])} gameweeks...")
            for gw in missing_data['missing_history']:
                try:
                    if not force:
                        existing = db_client.client.table("manager_gameweek_history").select(
                            "id"
                        ).eq("manager_id", manager_id).eq("gameweek", gw).limit(1).execute()
                        if existing.data:
                            logger.debug(f"  GW {gw}: Already exists, skipping")
                            continue
                    
                    logger.info(f"  Backfilling history for GW {gw}...")
                    await manager_refresher.refresh_manager_gameweek_history(
                        manager_id,
                        gw
                    )
                    await asyncio.sleep(2)  # Rate limiting
                except Exception as e:
                    logger.error(f"  Error backfilling history for GW {gw}: {str(e)}")
                    continue
            logger.info("✅ Manager history backfill complete")
        else:
            logger.info("✅ Manager history already complete")
        
        # Backfill missing player stats
        if missing_data['missing_player_stats']:
            logger.info(f"\n📥 Backfilling missing player stats...")
            for missing in missing_data['missing_player_stats']:
                gw = missing['gameweek']
                player_ids = missing['player_ids']
                try:
                    logger.info(f"  Backfilling stats for GW {gw}, {len(player_ids)} players...")
                    await player_refresher.refresh_player_gameweek_stats(gw, player_ids)
                    await asyncio.sleep(2)  # Rate limiting
                except Exception as e:
                    logger.error(f"  Error backfilling stats for GW {gw}: {str(e)}")
                    continue
            logger.info("✅ Player stats backfill complete")
        else:
            logger.info("✅ Player stats already complete")
        
        # Refresh materialized views (especially mv_player_owned_leaderboard)
        logger.info("\n🔄 Refreshing materialized views...")
        try:
            db_client.refresh_all_materialized_views()
            logger.info("✅ Materialized views refreshed")
        except Exception as e:
            logger.error(f"❌ Error refreshing materialized views: {str(e)}")
            logger.info("💡 Try refreshing manually: SELECT refresh_all_materialized_views();")
        
        # Final check
        logger.info("\n" + "=" * 60)
        logger.info("Final Status Check:")
        final_check = await check_missing_data(db_client, manager_id)
        logger.info(f"  Manager picks coverage: {final_check['picks_coverage']}/{final_check['total_gameweeks']} gameweeks")
        logger.info(f"  Manager history coverage: {final_check['history_coverage']}/{final_check['total_gameweeks']} gameweeks")
        logger.info(f"  Materialized view has data: {final_check['has_mv_data']}")
        
        if final_check['missing_picks'] or final_check['missing_history'] or not final_check['has_mv_data']:
            logger.warning("⚠️  Some data may still be missing. Check the errors above.")
        else:
            logger.info("✅ All data backfilled successfully!")
        logger.info("=" * 60)
        
    except Exception as e:
        logger.error(f"Fatal error during backfill: {str(e)}", exc_info=True)
        raise
    finally:
        if should_close_fpl_client and fpl_client:
            await fpl_client.close()


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description="Backfill data for configured manager(s)")
    parser.add_argument(
        "--manager-id",
        type=int,
        help="Specific manager ID to backfill (uses VITE_MANAGER_ID env var if not provided)"
    )
    parser.add_argument(
        "--all-managers",
        action="store_true",
        help="Backfill all tracked managers (from mini_league_managers table)"
    )
    parser.add_argument(
        "--check-only",
        action="store_true",
        help="Only check what's missing without backfilling"
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Force refresh even if data already exists"
    )
    
    args = parser.parse_args()
    
    # If --all-managers is set, backfill all tracked managers
    if args.all_managers:
        asyncio.run(backfill_all_managers(
            check_only=args.check_only,
            force=args.force
        ))
    else:
        # Run backfill for single manager
        asyncio.run(backfill_configured_manager(
            manager_id=args.manager_id,
            check_only=args.check_only,
            force=args.force
        ))


if __name__ == "__main__":
    main()
