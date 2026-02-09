#!/usr/bin/env python3
"""
Script to manually trigger a full data refresh cycle.

This will:
1. Refresh gameweeks
2. Refresh fixtures
3. Refresh player stats (if live matches)
4. Refresh manager points and mini league ranks
5. Refresh materialized views (including mv_mini_league_standings)

Usage:
    python3 scripts/refresh_data.py
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

from config import Config
from refresh.orchestrator import RefreshOrchestrator
from utils.logger import setup_logging


async def refresh_data():
    """Run a single refresh cycle."""
    # Set up logging
    setup_logging()
    
    config = Config()
    orchestrator = RefreshOrchestrator(config)
    
    print("🔄 Initializing refresh orchestrator...\n")
    
    try:
        # Initialize orchestrator
        await orchestrator.initialize()
        
        print("✅ Orchestrator initialized")
        print("🔄 Running refresh cycle...\n")
        
        # Run a single fast cycle (gameweeks, state, fixtures, players when live, etc.)
        await orchestrator._fast_cycle()
        
        print("\n✅ Refresh cycle completed successfully!")
        print("\n📊 Mini league standings should now be updated.")
        
    except Exception as e:
        print(f"\n❌ Error during refresh cycle: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    
    finally:
        # Clean up
        await orchestrator.shutdown()


if __name__ == "__main__":
    asyncio.run(refresh_data())
