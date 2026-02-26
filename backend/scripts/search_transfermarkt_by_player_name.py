#!/usr/bin/env python3
"""
Search Transfermarkt by player name (FPL web_name), log result, and upsert player_transfermarkt on match.

Reads players from DB; for each (optionally skipping those already in player_transfermarkt),
GETs TM quick search, parses first player profile link, logs to player_transfermarkt_search_log,
and on status=matched upserts player_transfermarkt.

Usage:
    python3 scripts/search_transfermarkt_by_player_name.py           # all players not yet matched
    python3 scripts/search_transfermarkt_by_player_name.py --all     # all players (re-search)
    python3 scripts/search_transfermarkt_by_player_name.py --limit 50

Requires: SUPABASE_URL, SUPABASE_SERVICE_KEY in .env.
"""

import argparse
import re
import sys
import time
from pathlib import Path
from urllib.parse import quote_plus

import httpx
from bs4 import BeautifulSoup
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

backend_dir = Path(__file__).parent.parent
src_dir = backend_dir / "src"
sys.path.insert(0, str(src_dir))

from config import Config
from database.supabase_client import SupabaseClient

SEARCH_BASE = "https://www.transfermarkt.com/schnellsuche/ergebnis/schnellsuche"
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
RATE_LIMIT_SEC = 2.5


def _fetch_players_to_search(client: SupabaseClient, only_unmatched: bool, limit: int | None):
    """Return list of { fpl_player_id, web_name } to search."""
    r = client.client.table("players").select("fpl_player_id, web_name").not_.is_("web_name", "null").execute()
    rows = r.data or []
    if not rows:
        return []

    if only_unmatched:
        existing = client.client.table("player_transfermarkt").select("fpl_player_id").execute()
        existing_ids = {x["fpl_player_id"] for x in (existing.data or [])}
        rows = [p for p in rows if p["fpl_player_id"] not in existing_ids]

    if limit is not None:
        rows = rows[:limit]
    return rows


def _search_and_parse(query: str) -> tuple[str, int | None, str | None]:
    """
    GET TM quick search, parse first player profile link.
    Returns (status, transfermarkt_player_id, transfermarkt_slug).
    status: 'matched' | 'no_result' | 'multiple_candidates' | 'error'
    """
    url = f"{SEARCH_BASE}?query={quote_plus(query)}"
    try:
        resp = httpx.get(
            url,
            follow_redirects=True,
            headers={"User-Agent": USER_AGENT},
            timeout=20,
        )
        if resp.status_code != 200:
            return ("error", None, None)
        html = resp.text
    except Exception:
        return ("error", None, None)

    # Player profile links: /slug/profil/spieler/123 or /slug/spieler/123
    # We want the first one from the "Search results for players" section (first table of players).
    soup = BeautifulSoup(html, "html.parser")
    profile_re = re.compile(r"/([^/]+)/(?:profil/)?spieler/(\d+)")
    found = []
    for a in soup.find_all("a", href=True):
        href = a.get("href", "")
        if "/spieler/" not in href or "/verein/" in href or "/trainer/" in href or "/berater/" in href:
            continue
        m = profile_re.search(href)
        if m:
            slug, pid = m.group(1), int(m.group(2))
            # Avoid duplicates and non-player pages
            if slug in ("schnellsuche", "detailsuche", "transfers", "startseite"):
                continue
            found.append((pid, slug))

    if not found:
        return ("no_result", None, None)
    if len(found) > 1:
        # Take first as best match; caller can treat as matched or multiple_candidates
        pid, slug = found[0]
        return ("matched", pid, slug)
    pid, slug = found[0]
    return ("matched", pid, slug)


def main():
    ap = argparse.ArgumentParser(description="Search Transfermarkt by FPL player name and log/upsert mappings.")
    ap.add_argument("--all", action="store_true", help="Search all players (default: only those not in player_transfermarkt)")
    ap.add_argument("--limit", type=int, default=None, help="Max number of players to search")
    args = ap.parse_args()

    config = Config()
    if not config.supabase_url or not (config.supabase_service_key or config.supabase_key):
        print("SUPABASE_URL and SUPABASE_SERVICE_KEY (or SUPABASE_KEY) required.", file=sys.stderr)
        sys.exit(1)

    client = SupabaseClient(config)
    players = _fetch_players_to_search(client, only_unmatched=not args.all, limit=args.limit)
    if not players:
        print("No players to search.", file=sys.stderr)
        sys.exit(0)

    matched = 0
    no_result = 0
    errors = 0

    for i, p in enumerate(players):
        fpl_id = p["fpl_player_id"]
        web_name = (p.get("web_name") or "").strip()
        if not web_name:
            continue
        query = web_name
        status, tm_id, slug = _search_and_parse(query)

        log_row = {
            "fpl_player_id": fpl_id,
            "search_query": query,
            "status": status,
            "transfermarkt_player_id": tm_id,
            "transfermarkt_slug": slug,
        }
        try:
            client.client.table("player_transfermarkt_search_log").insert(log_row).execute()
        except Exception as e:
            print(f"Log insert failed for {fpl_id}: {e}", file=sys.stderr)
            errors += 1
            time.sleep(RATE_LIMIT_SEC)
            continue

        if status == "matched" and tm_id and slug:
            try:
                client.client.table("player_transfermarkt").upsert(
                    {
                        "fpl_player_id": fpl_id,
                        "transfermarkt_player_id": tm_id,
                        "transfermarkt_slug": slug,
                    },
                    on_conflict="fpl_player_id",
                ).execute()
                matched += 1
            except Exception as e:
                print(f"Upsert failed for {fpl_id}: {e}", file=sys.stderr)
                errors += 1

        if status == "no_result":
            no_result += 1
        elif status == "error":
            errors += 1

        time.sleep(RATE_LIMIT_SEC)

    print(f"Done: {matched} matched (upserted), {no_result} no result, {errors} errors. Total searched: {len(players)}.")


if __name__ == "__main__":
    main()
