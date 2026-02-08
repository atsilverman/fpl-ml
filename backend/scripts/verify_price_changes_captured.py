#!/usr/bin/env python3
"""
Verify that overnight FPL price changes were captured.

Compares the latest snapshot in player_price_changes_by_date against an
expected list (e.g. from @FPLPriceChanges). Loads backend/.env automatically.

Usage:
  cd backend && python3 scripts/verify_price_changes_captured.py

Set in backend/.env (or export):
  Option 1: DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres
  Option 2: SUPABASE_URL=https://PROJECT_REF.supabase.co  and  DATABASE_PASSWORD=your_db_password

Get database password: Supabase Dashboard → Settings → Database → Connection string → URI (password in the URI).
"""

import os
import sys
from pathlib import Path

# Load backend/.env so SUPABASE_URL and DATABASE_PASSWORD are set
try:
    from dotenv import load_dotenv
    backend_dir = Path(__file__).resolve().parent.parent
    load_dotenv(backend_dir / ".env")
except ImportError:
    pass

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
except ImportError:
    print("Install: pip install psycopg2-binary")
    sys.exit(1)


def get_conn():
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        supabase_url = os.getenv("SUPABASE_URL", "")
        password = os.getenv("DATABASE_PASSWORD", "")
        if not supabase_url or not password:
            print("Set DATABASE_URL or SUPABASE_URL + DATABASE_PASSWORD")
            sys.exit(1)
        from urllib.parse import urlparse
        parsed = urlparse(supabase_url)
        hostname = parsed.hostname or supabase_url.replace("https://", "").split("/")[0]
        project_ref = hostname.replace(".supabase.co", "") if ".supabase.co" in hostname else ""
        if not project_ref:
            print("Could not get project ref from SUPABASE_URL")
            sys.exit(1)
        database_url = f"postgresql://postgres:{password}@db.{project_ref}.supabase.co:5432/postgres"
    return psycopg2.connect(database_url)


def main():
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT recorded_date, web_name, team_short_name,
                       prior_price_tenths, price_tenths, is_rise
                FROM player_price_changes_by_date
                ORDER BY recorded_date DESC, is_rise DESC, web_name
                LIMIT 500
            """)
            rows = cur.fetchall()
    finally:
        conn.close()

    if not rows:
        print("No price changes in player_price_changes_by_date.")
        print("Either no snapshot has run yet, or no changes were recorded.")
        print("\nExpected from @FPLPriceChanges screenshot:")
        print("  Fallers: Thiago, Neto, Bruno G., Tavernier, Isidor")
        print("  Risers:  B.Fernandes, João Pedro, Saliba")
        return

    # Group by date
    by_date = {}
    for r in rows:
        d = r["recorded_date"].isoformat() if hasattr(r["recorded_date"], "isoformat") else str(r["recorded_date"])
        if d not in by_date:
            by_date[d] = {"rises": [], "falls": []}
        name = r["web_name"] or "?"
        price = f"£{(r['price_tenths'] or 0) / 10:.1f}M" if r.get("price_tenths") else ""
        entry = f"{name} ({price})"
        if r["is_rise"]:
            by_date[d]["rises"].append(entry)
        else:
            by_date[d]["falls"].append(entry)

    for date in sorted(by_date.keys(), reverse=True)[:5]:
        data = by_date[date]
        print(f"\n--- Snapshot date: {date} ---")
        print("Rises:", ", ".join(data["rises"]) if data["rises"] else "(none)")
        print("Falls:", ", ".join(data["falls"]) if data["falls"] else "(none)")

    print("\n--- Expected from @FPLPriceChanges (overnight) ---")
    print("Rises:  B.Fernandes (£9.8M), João Pedro (£7.6M), Saliba (£6.1M)")
    print("Fallers: Thiago (£7.0M), Neto (£7.0M), Bruno G. (£7.0M), Tavernier (£5.3M), Isidor (£5.1M)")
    print("\nCompare names/prices above; FPL web_name may differ (e.g. Fernandes vs B.Fernandes).")


if __name__ == "__main__":
    main()
