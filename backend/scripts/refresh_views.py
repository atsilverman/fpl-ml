#!/usr/bin/env python3
"""
Quick script to refresh all materialized views.

Usage:
    python3 scripts/refresh_views.py
"""

import sys
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables
load_dotenv(Path(__file__).parent.parent / ".env")

# Add src directory to path
backend_dir = Path(__file__).parent.parent
src_dir = backend_dir / "src"
sys.path.insert(0, str(src_dir))

from config import Config
from database.supabase_client import SupabaseClient


def refresh_views():
    """Refresh all materialized views."""
    config = Config()
    db_client = SupabaseClient(config)
    
    print("🔄 Refreshing all materialized views...\n")
    
    try:
        # Refresh all views
        db_client.refresh_all_materialized_views()
        print("✅ Successfully refreshed all materialized views")
        
        # Verify they have data now
        print("\n📊 Verifying materialized views have data...")
        views = [
            "mv_mini_league_standings",
            "mv_manager_gameweek_summary",
            "mv_player_gameweek_performance",
            "mv_league_transfer_aggregation",
            "mv_player_owned_leaderboard",
            "mv_research_player_stats_all",
            "mv_research_player_stats_last_6",
            "mv_research_player_stats_last_12",
        ]
        
        for view in views:
            try:
                result = db_client.client.table(view).select("*", count="exact").limit(1).execute()
                count = result.count if hasattr(result, 'count') else len(result.data) if result.data else 0
                status = "✅" if count > 0 else "⚠️"
                print(f"  {status} {view}: {count} rows")
            except Exception as e:
                print(f"  ❌ {view}: Error - {e}")
        
    except Exception as e:
        print(f"❌ Error refreshing materialized views: {e}")
        print("\n💡 Try refreshing manually in Supabase SQL Editor:")
        print("   SELECT refresh_all_materialized_views();")
        sys.exit(1)


if __name__ == "__main__":
    refresh_views()
