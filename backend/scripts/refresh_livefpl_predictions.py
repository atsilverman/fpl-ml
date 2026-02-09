#!/usr/bin/env python3
"""
Scrape LiveFPL price predictor for "Already reached target" and "Projected to reach target"
rows (rises/falls); merge and dedupe; insert into price_change_predictions.
Schedule via systemd timer or cron every 30 minutes (see backend/systemd/README-scheduling.md).

Usage:
    python3 scripts/refresh_livefpl_predictions.py

Requires: SUPABASE_URL, SUPABASE_SERVICE_KEY in .env (service key for insert).
"""

import re
import sys
from pathlib import Path

import httpx
from bs4 import BeautifulSoup
from dotenv import load_dotenv

# Load environment variables
load_dotenv(Path(__file__).parent.parent / ".env")

# Add src directory to path
backend_dir = Path(__file__).parent.parent
src_dir = backend_dir / "src"
sys.path.insert(0, str(src_dir))

from config import Config
from database.supabase_client import SupabaseClient

LIVEFPL_URL = "https://www.livefpl.net/prices"
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

# In each player block, after the shirt img we have name then "POS £X.X"
PRICE_RE = re.compile(r"(GK|DEF|MID|FW)\s*£(\d+\.\d+)", re.IGNORECASE)

# Fallback: regex for server-rendered content that looks like markdown (e.g. ##### Name on next line)
PLAYER_BLOCK_TEXT_RE = re.compile(
    r"new_logos2/(\d+)\.png"
    r"[^|]*?"
    r"(?:#####\s*([^\n|]+?)\s*\n|>([^<]+?)</[^>]*>)"
    r"[\s\S]*?"
    r"(?:GK|DEF|MID|FW)\s*£(\d+\.\d+)",
    re.IGNORECASE | re.DOTALL,
)


def _dedupe_player_name(name: str) -> str:
    """Collapse duplicate or 'FullName ShortName' (truncated) into a single name."""
    if not name or not name.strip():
        return name
    name = name.strip()
    parts = name.split()
    if len(parts) == 2:
        a, b = parts[0], parts[1]
        if a == b:
            return a
        if a.startswith(b) or b.startswith(a):
            return a if len(a) >= len(b) else b
    # Remove consecutive duplicate words (e.g. "A A B" -> "A B")
    seen = []
    for p in parts:
        if seen and seen[-1] == p:
            continue
        seen.append(p)
    return " ".join(seen).strip() or name


def _extract_players_from_text(text: str) -> list[dict]:
    """Fallback: parse player blocks from raw text (markdown-like or HTML)."""
    out = []
    for m in PLAYER_BLOCK_TEXT_RE.finditer(text):
        team_id = int(m.group(1))
        name = _dedupe_player_name((m.group(2) or m.group(3) or "").strip())
        price = m.group(4)
        if name:
            out.append({"team_id": team_id, "player_name": name, "price": f"£{price}"})
    return out


def _extract_players_from_cell(cell) -> list[dict]:
    """From a BeautifulSoup table cell, extract list of { player_name, team_id, price }."""
    if not cell:
        return []
    out = []
    # Find all club shirt images (team id in src)
    for img in cell.find_all("img", src=re.compile(r"new_logos2/(\d+)\.png")):
        src = img.get("src") or ""
        m = re.search(r"new_logos2/(\d+)\.png", src)
        if not m:
            continue
        team_id = int(m.group(1))
        # Name and price are usually in a sibling or parent block
        block = img.find_parent(["div", "td", "span"]) or img
        text = block.get_text(separator=" ", strip=True)
        # Also include next siblings text (e.g. name in next element)
        next_ = img.find_next_sibling()
        if next_:
            text = (next_.get_text(separator=" ", strip=True) + " " + text).strip()
        price_m = PRICE_RE.search(text)
        if not price_m:
            continue
        pos, price_val = price_m.groups()
        # Name is the text before "POS £X.X" (strip trailing numbers/percent)
        name_part = text[: price_m.start()].strip()
        # Drop position abbreviations and percentages that might be in the same line
        name = re.sub(r"\s*(?:GK|DEF|MID|FW)\s*$", "", name_part)
        name = re.sub(r"\s*[-+]?\d+\.?\d*%?\s*$", "", name).strip()
        if not name or len(name) > 50:
            name = name_part.split()[0] if name_part.split() else "Unknown"
        name = _dedupe_player_name(name)
        out.append({
            "team_id": team_id,
            "player_name": name,
            "price": f"£{price_val}",
        })
    return out


def _merge_dedupe(players: list[dict]) -> list[dict]:
    """Merge list of player dicts and dedupe by (player_name, team_id)."""
    seen: set[tuple[str, int]] = set()
    out = []
    for p in players:
        key = (p["player_name"], p["team_id"])
        if key in seen:
            continue
        seen.add(key)
        out.append(p)
    return out


def _fetch_team_short_names(client: SupabaseClient) -> dict[int, str]:
    """Return mapping team_id -> short_name from teams table."""
    try:
        r = client.client.table("teams").select("team_id, short_name").execute()
        if not r.data:
            return {}
        return {int(t["team_id"]): t["short_name"] for t in r.data}
    except Exception:
        return {}


def scrape_livefpl() -> tuple[list[dict], list[dict]]:
    """
    GET LiveFPL prices page; parse "Already reached target" and "Projected to reach target"
    rows for rises and falls; merge and dedupe. Returns (rises, falls).
    """
    resp = httpx.get(
        LIVEFPL_URL,
        follow_redirects=True,
        headers={"User-Agent": USER_AGENT},
        timeout=30,
    )
    resp.raise_for_status()
    text = resp.text
    soup = BeautifulSoup(text, "html.parser")

    all_rises: list[dict] = []
    all_falls: list[dict] = []

    for td in soup.find_all("td"):
        label = (td.get_text() or "").strip()
        if "Already reached target" in label or "Projected to reach target" in label:
            row = td.find_parent("tr")
            if row:
                cells = row.find_all("td")
                if len(cells) >= 3:
                    r = _extract_players_from_cell(cells[1])
                    f = _extract_players_from_cell(cells[2])
                    all_rises.extend(r)
                    all_falls.extend(f)

    if all_rises or all_falls:
        return _merge_dedupe(all_rises), _merge_dedupe(all_falls)

    # Fallback: parse raw text for both sections
    for anchor in ("Already reached target", "Projected to reach target"):
        start = text.find(anchor)
        if start == -1:
            continue
        end = text.find("Others who will be close", start)
        if end == -1:
            end = text.find("|Player|", start)
        segment = text[start:end] if end != -1 else text[start:]
        rest = segment.split("|", 2)
        if len(rest) >= 3:
            r = _extract_players_from_text(rest[1])
            f = _extract_players_from_text(rest[2])
            all_rises.extend(r)
            all_falls.extend(f)

    return _merge_dedupe(all_rises), _merge_dedupe(all_falls)


def main():
    config = Config()
    if not config.supabase_url or not (config.supabase_service_key or config.supabase_key):
        print("SUPABASE_URL and SUPABASE_SERVICE_KEY (or SUPABASE_KEY) required.", file=sys.stderr)
        sys.exit(1)

    client = SupabaseClient(config)
    team_map = _fetch_team_short_names(client)

    try:
        rises_with_id, falls_with_id = scrape_livefpl()
    except Exception as e:
        print(f"Scrape failed: {e}", file=sys.stderr)
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
