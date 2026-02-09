#!/usr/bin/env python3
"""
Backfill player current price (cost_tenths) and overall ownership (selected_by_percent) from FPL API.

Uses bootstrap-static so both fields are from the same API source. Run once to populate
existing DBs (e.g. players like B. Fernandes, Semenyo missing price/ownership). Ongoing
maintenance is handled by the refresh orchestrator on every fast cycle.

Requires: migrations 048 (selected_by_percent) and 049 (cost_tenths) applied.

Usage:
    cd backend && python scripts/backfill_player_price_and_ownership.py
"""

import asyncio
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

backend_dir = Path(__file__).parent.parent
src_dir = backend_dir / "src"
sys.path.insert(0, str(src_dir))

from config import Config
from database.supabase_client import SupabaseClient
from fpl_api.client import FPLAPIClient
from refresh.players import PlayerDataRefresher


async def main():
    config = Config()
    db = SupabaseClient(config)
    fpl = FPLAPIClient(config)
    refresher = PlayerDataRefresher(fpl, db)

    print("Fetching bootstrap-static from FPL API...")
    bootstrap = await fpl.get_bootstrap_static()
    elements = bootstrap.get("elements", [])
    if not elements:
        print("No elements in bootstrap.")
        sys.exit(1)

    print(f"Syncing {len(elements)} players (selected_by_percent + cost_tenths)...")
    refresher.sync_players_ownership_from_bootstrap(bootstrap)
    print("Done. players.selected_by_percent and players.cost_tenths are now populated from API.")

    # Optionally populate player_prices for current gameweek so UI has rows there too
    try:
        gw_rows = db.client.table("gameweeks").select("id").order("id", desc=True).limit(1).execute()
        current_gw = gw_rows.data[0]["id"] if gw_rows.data else None
    except Exception as e:
        print(f"Could not read current gameweek: {e}")
        current_gw = None

    if current_gw:
        print(f"Syncing player_prices for gameweek {current_gw}...")
        refresher.sync_player_prices_from_bootstrap(bootstrap, current_gw)
        print("Done. player_prices table updated for current gameweek.")
    else:
        print("No gameweek in DB; skipping player_prices. Run again after gameweeks are loaded, or rely on players.cost_tenths for modal price.")

    print("\nOngoing: the refresh orchestrator runs this sync on every fast cycle, so price/ownership stay in sync when FPL data changes.")


if __name__ == "__main__":
    asyncio.run(main())
