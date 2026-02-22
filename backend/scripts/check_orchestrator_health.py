#!/usr/bin/env python3
"""
Check orchestrator health by reading the last refresh_events from Supabase.
Shows when the orchestrator last ran and how long it has been down (if no recent event).
Run from repo root or backend/ with .env in backend/ or repo root.
Usage:
  python backend/scripts/check_orchestrator_health.py
  python scripts/check_orchestrator_health.py
Exit code: 0 if last event within --max-age-minutes (default 5), else 1.
"""

import os
import sys
from pathlib import Path
from datetime import datetime, timezone, timedelta

# Load .env from backend or repo root
backend_dir = Path(__file__).resolve().parent.parent
for env_path in [backend_dir / ".env", backend_dir.parent / ".env"]:
    if env_path.exists():
        from dotenv import load_dotenv
        load_dotenv(env_path)
        break

sys.path.insert(0, str(backend_dir / "src"))

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Check orchestrator health from refresh_events")
    parser.add_argument("--max-age-minutes", type=int, default=5,
                        help="Consider orchestrator healthy if last event within this many minutes (default 5)")
    args = parser.parse_args()

    try:
        from database.supabase_client import SupabaseClient
        from config import Config
    except Exception as e:
        print("Error loading config/database:", e, file=sys.stderr)
        sys.exit(2)

    config = Config()
    db = SupabaseClient(config)

    try:
        r = (
            db.client.table("refresh_events")
            .select("path, occurred_at")
            .order("occurred_at", desc=True)
            .limit(10)
            .execute()
        )
    except Exception as e:
        print("Error querying refresh_events:", e, file=sys.stderr)
        sys.exit(2)

    rows = r.data or []
    if not rows:
        print("No refresh_events found. Orchestrator has never written to this DB (or table is empty).")
        print("Start the orchestrator: sudo systemctl start fpl-refresh.service")
        sys.exit(1)

    latest = rows[0]
    occurred = latest.get("occurred_at")
    path = latest.get("path", "?")
    try:
        if occurred.endswith("Z"):
            occurred = occurred.replace("Z", "+00:00")
        last_dt = datetime.fromisoformat(occurred)
        if last_dt.tzinfo is None:
            last_dt = last_dt.replace(tzinfo=timezone.utc)
    except Exception:
        print("Last event: path=%s occurred_at=%s (could not parse time)" % (path, occurred))
        sys.exit(1)

    now = datetime.now(timezone.utc)
    age = now - last_dt
    age_sec = age.total_seconds()
    age_min = age_sec / 60

    print("Last refresh event: path=%s at %s (UTC)" % (path, last_dt.strftime("%Y-%m-%d %H:%M:%S")))
    if age_sec < 60:
        print("Age: %.0f seconds ago" % age_sec)
    else:
        print("Age: %.1f minutes ago" % age_min)

    if age_min > args.max_age_minutes:
        print("\nOrchestrator appears DOWN (no event in the last %d minutes)." % args.max_age_minutes)
        print("Restart: sudo systemctl restart fpl-refresh.service")
        print("Logs:   sudo journalctl -u fpl-refresh.service -f")
        sys.exit(1)

    print("\nOrchestrator appears healthy.")
    sys.exit(0)


if __name__ == "__main__":
    main()
