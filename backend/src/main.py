#!/usr/bin/env python3
"""
FPL Data Refresh Service - Main Entry Point

This service continuously syncs data from the FPL API to Supabase,
maintaining real-time standings, player stats, and manager data.
"""

import asyncio
import logging
import signal
import sys
from pathlib import Path

# Load .env from backend directory before Config() is used
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# Add src to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from config import Config
from refresh.orchestrator import RefreshOrchestrator
from utils.logger import setup_logging

logger = logging.getLogger(__name__)


class FPLRefreshService:
    """Main service class for FPL data refresh."""
    
    def __init__(self):
        self.config = Config()
        self.orchestrator = None
        self.running = False
        
    async def start(self):
        """Start the refresh service."""
        logger.info("Starting FPL Refresh Service", extra={
            "version": "1.0.0",
            "environment": self.config.environment
        })
        
        try:
            # Initialize orchestrator
            self.orchestrator = RefreshOrchestrator(self.config)
            await self.orchestrator.initialize()
            
            # Set up signal handlers for graceful shutdown
            loop = asyncio.get_event_loop()
            for sig in (signal.SIGTERM, signal.SIGINT):
                loop.add_signal_handler(sig, self._handle_shutdown, sig)
            
            self.running = True
            
            # Start refresh loop
            await self.orchestrator.run()
            
        except Exception as e:
            logger.error("Fatal error in refresh service", extra={
                "error": str(e),
                "error_type": type(e).__name__
            }, exc_info=True)
            raise
    
    def _handle_shutdown(self, signum):
        """Handle shutdown signals gracefully."""
        logger.info("Received shutdown signal", extra={"signal": signum})
        self.running = False
        if self.orchestrator:
            asyncio.create_task(self.orchestrator.shutdown())


async def main():
    """Main entry point."""
    # Set up logging
    setup_logging()
    
    # Create and start service
    service = FPLRefreshService()
    try:
        await service.start()
    except KeyboardInterrupt:
        logger.info("Service interrupted by user")
    except Exception as e:
        logger.error("Service crashed", extra={"error": str(e)}, exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
