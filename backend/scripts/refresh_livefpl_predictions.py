#!/usr/bin/env python3
"""
Fetch LiveFPL price predictions from their JSON API (livefpl.us/api/prices.json).
progress >= 1 = rise, progress <= -1 = fall. Insert into price_change_predictions.
Schedule via orchestrator (every 30 min) or systemd timer (see backend/systemd/README-scheduling.md).

Usage:
    python3 scripts/refresh_livefpl_predictions.py

Requires: SUPABASE_URL, SUPABASE_SERVICE_KEY in .env (service key for insert).
"""

import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

# Load environment variables
load_dotenv(Path(__file__).parent.parent / ".env")

# Add src directory to path
backend_dir = Path(__file__).parent.parent
src_dir = backend_dir / "src"
sys.path.insert(0, str(src_dir))

from config import Config
from database.supabase_client import SupabaseClient

LIVEFPL_API_URL = "https://livefpl.us/api/prices.json"
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"


def _fetch_team_short_names(client: SupabaseClient) -> dict[int, str]:
    """Return mapping team_id -> short_name from teams table."""
    try:
        r = client.client.table("teams").select("team_id, short_name").execute()
        if not r.data:
            return {}
        return {int(t["team_id"]): t["short_name"] for t in r.data}
    except Exception:
        return {}


def fetch_livefpl_api() -> tuple[list[dict], list[dict]]:
    """
    GET LiveFPL prices JSON API. progress >= 1 = rise (reached/projected target),
    progress <= -1 = fall. Returns (rises, falls) as list of { team_id, player_name, price }.
    """
    resp = httpx.get(
        LIVEFPL_API_URL,
        follow_redirects=True,
        headers={"User-Agent": USER_AGENT},
        timeout=60,
    )
    resp.raise_for_status()
    data = resp.json()

    rises: list[dict] = []
    falls: list[dict] = []

    for _pid, entry in data.items():
        if not isinstance(entry, dict):
            continue
        name = entry.get("name")
        if not name or not str(name).strip():
            continue
        team_code = entry.get("team_code")
        try:
            team_id = int(team_code) if team_code is not None else None
        except (TypeError, ValueError):
            team_id = None
        cost = entry.get("cost")
        if cost is not None:
            price = f"£{float(cost):.1f}"
        else:
            price = "£0.0"
        progress = entry.get("progress")
        if progress is None:
            continue
        try:
            p = float(progress)
        except (TypeError, ValueError):
            continue
        row = {"team_id": team_id, "player_name": str(name).strip(), "price": price}
        if p >= 1:
            rises.append(row)
        elif p <= -1:
            falls.append(row)

    return rises, falls


def main():
    config = Config()
    if not config.supabase_url or not (config.supabase_service_key or config.supabase_key):
        print("SUPABASE_URL and SUPABASE_SERVICE_KEY (or SUPABASE_KEY) required.", file=sys.stderr)
        sys.exit(1)

    client = SupabaseClient(config)
    team_map = _fetch_team_short_names(client)

    try:
        rises_with_id, falls_with_id = fetch_livefpl_api()
    except Exception as e:
        print(f"Fetch failed: {e}", file=sys.stderr)
        sys.exit(1)

    def to_row(item: dict) -> dict:
        return {
            "player_name": item["player_name"],
            "team_short_name": team_map.get(item["team_id"]),
            "price": item["price"],
        }

    rises = [to_row(r) for r in rises_with_id]
    falls = [to_row(f) for f in falls_with_id]

    row = {
        "rises": rises,
        "falls": falls,
    }

    try:
        client.client.table("price_change_predictions").insert(row).execute()
        print(f"Inserted predictions: {len(rises)} rises, {len(falls)} falls.")
    except Exception as e:
        print(f"Insert failed: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
