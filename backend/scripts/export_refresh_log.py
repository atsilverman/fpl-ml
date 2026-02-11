#!/usr/bin/env python3
"""
Export refresh_duration_log, refresh_frontend_duration_log, and refresh_snapshot_log for plotting in refresh_log_viewer.html.

Usage:
    python3 scripts/export_refresh_log.py
    python3 scripts/export_refresh_log.py -o refresh_log.json
    python3 scripts/export_refresh_log.py --hours 2   # last 2 hours
"""

import argparse
import json
import sys
from pathlib import Path
from datetime import datetime, timezone, timedelta

# Load environment
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env")

from config import Config
from database.supabase_client import SupabaseClient


def main():
    parser = argparse.ArgumentParser(description="Export refresh log data for plotting")
    parser.add_argument("-o", "--output", default=None, help="Output file (default: stdout)")
    parser.add_argument("--hours", type=float, default=24, help="Hours of data to export (default: 24)")
    args = parser.parse_args()

    config = Config()
    if not config.supabase_url or not (config.supabase_service_key or config.supabase_key):
        print("Error: SUPABASE_URL and SUPABASE_KEY (or SUPABASE_SERVICE_KEY) required", file=sys.stderr)
        sys.exit(1)

    client = SupabaseClient(config)
    since = datetime.now(timezone.utc) - timedelta(hours=args.hours)
    since_iso = since.isoformat()

    duration_rows = []
    frontend_duration_rows = []
    snapshot_rows = []

    try:
        r = (
            client.client.table("refresh_duration_log")
            .select("*")
            .gte("occurred_at", since_iso)
            .order("occurred_at", desc=False)
            .execute()
        )
        duration_rows = r.data or []
    except Exception as e:
        print(f"Warning: could not fetch refresh_duration_log: {e}", file=sys.stderr)

    try:
        r = (
            client.client.table("refresh_frontend_duration_log")
            .select("*")
            .gte("occurred_at", since_iso)
            .order("occurred_at", desc=False)
            .execute()
        )
        frontend_duration_rows = r.data or []
    except Exception as e:
        print(f"Warning: could not fetch refresh_frontend_duration_log: {e}", file=sys.stderr)

    try:
        r = (
            client.client.table("refresh_snapshot_log")
            .select("*")
            .gte("occurred_at", since_iso)
            .order("occurred_at", desc=False)
            .execute()
        )
        snapshot_rows = r.data or []
    except Exception as e:
        print(f"Warning: could not fetch refresh_snapshot_log: {e}", file=sys.stderr)

    out = {
        "duration": duration_rows,
        "frontend_duration": frontend_duration_rows,
        "snapshot": snapshot_rows,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "since": since_iso,
    }

    json_str = json.dumps(out, indent=2)

    if args.output:
        Path(args.output).write_text(json_str, encoding="utf-8")
        print(f"Exported to {args.output} ({len(duration_rows)} backend, {len(frontend_duration_rows)} frontend duration, {len(snapshot_rows)} snapshot rows)")
    else:
        print(json_str)


if __name__ == "__main__":
    main()
