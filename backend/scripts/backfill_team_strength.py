#!/usr/bin/env python3
"""
Backfill team strength (1-5) from FPL API for schedule difficulty coloring.

Fetches bootstrap-static and upserts teams with strength. Run once if the
research schedule page doesn't show difficulty colors.

Requires: migration 035_add_teams_strength.sql applied (adds teams.strength).
If you get PGRST204 about 'strength' column, run that migration in Supabase
SQL editor, then re-run this script.

Usage:
    cd backend && source venv/bin/activate && python scripts/backfill_team_strength.py
"""

import asyncio
import sys
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


async def main():
    config = Config()
    db = SupabaseClient(config)
    fpl = FPLAPIClient(config)

    print("Fetching bootstrap-static...")
    bootstrap = await fpl.get_bootstrap_static()
    teams = bootstrap.get("teams", [])
    if not teams:
        print("No teams in bootstrap.")
        return

    payload_with_strength = [
        {
            "team_id": t["id"],
            "team_name": t.get("name", ""),
            "short_name": t.get("short_name", ""),
            "strength": t.get("strength"),
            "strength_overall_home": t.get("strength_overall_home"),
            "strength_overall_away": t.get("strength_overall_away"),
            "strength_attack_home": t.get("strength_attack_home"),
            "strength_attack_away": t.get("strength_attack_away"),
            "strength_defence_home": t.get("strength_defence_home"),
            "strength_defence_away": t.get("strength_defence_away"),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        for t in teams
    ]
    payload_without_strength = [
        {
            "team_id": p["team_id"],
            "team_name": p["team_name"],
            "short_name": p["short_name"],
            "updated_at": p["updated_at"],
        }
        for p in payload_with_strength
    ]

    print(f"Upserting {len(teams)} teams...")
    try:
        for p in payload_with_strength:
            db.upsert_team(p)
        print("Done. Reload the research schedule page to see difficulty colors.")
    except Exception as e:
        err_msg = str(e)
        if "strength" in err_msg and ("PGRST204" in err_msg or "schema" in err_msg.lower()):
            print(
                "The 'strength' column was not found. Apply migration 035_add_teams_strength.sql\n"
                "  (Supabase Dashboard → SQL Editor → run backend/supabase/migrations/035_add_teams_strength.sql),\n"
                "  then re-run this script."
            )
            print("\nUpserting teams without strength so the script does not fail...")
            for p in payload_without_strength:
                db.upsert_team(p)
            print("Done. After applying the migration, run this script again to backfill strength.")
        else:
            raise


if __name__ == "__main__":
    asyncio.run(main())
