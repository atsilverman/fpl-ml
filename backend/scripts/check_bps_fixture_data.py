#!/usr/bin/env python3
"""
Check BPS / fixture_id alignment for current gameweek.

For each fixture, reports:
  - Count of player_gameweek_stats rows by team_id (home vs away)
  - Top 5 BPS per fixture
  - Any rows with team_id not in (home_team_id, away_team_id) [data bug]

Use this to verify Wolves v Arsenal has both teams, and BRE v ARS has correct data.

Usage (from backend directory):
    python3 scripts/check_bps_fixture_data.py
    python3 scripts/check_bps_fixture_data.py --gw 25
"""

import argparse
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from config import Config
from database.supabase_client import SupabaseClient


def main():
    parser = argparse.ArgumentParser(description="Check BPS/fixture_id per fixture for a gameweek.")
    parser.add_argument("--gw", type=int, metavar="N", help="Gameweek (default: current)")
    args = parser.parse_args()

    config = Config()
    try:
        config.validate()
    except ValueError as e:
        print(f"Config error: {e}")
        sys.exit(1)

    client = SupabaseClient(config).client

    if args.gw is not None:
        gw = args.gw
        print(f"Gameweek: {gw}\n")
    else:
        r = client.table("gameweeks").select("id").eq("is_current", True).limit(1).execute()
        if not r.data:
            print("No current gameweek. Use --gw N.")
            sys.exit(1)
        gw = r.data[0]["id"]
        print(f"Current gameweek: {gw}\n")

    # All fixtures this GW
    fix_r = client.table("fixtures").select(
        "fpl_fixture_id, home_team_id, away_team_id, kickoff_time, started, finished_provisional, finished"
    ).eq("gameweek", gw).order("kickoff_time").execute()
    fixtures = fix_r.data or []

    # Team short names
    team_ids = set()
    for f in fixtures:
        team_ids.add(f.get("home_team_id"))
        team_ids.add(f.get("away_team_id"))
    teams_r = client.table("teams").select("team_id, short_name").in_("team_id", list(team_ids)).execute()
    team_short = {t["team_id"]: t["short_name"] for t in (teams_r.data or [])}

    # All stats for this GW
    stats_r = client.table("player_gameweek_stats").select(
        "player_id, fixture_id, team_id, bps, minutes, total_points, bonus"
    ).eq("gameweek", gw).execute()
    stats = stats_r.data or []

    # Player names for top BPS
    player_ids = {s["player_id"] for s in stats if s.get("player_id")}
    players_r = client.table("players").select("fpl_player_id, web_name, team_id").in_(
        "fpl_player_id", list(player_ids)
    ).execute() if player_ids else type("Dummy", (), {"data": []})()
    player_map = {p["fpl_player_id"]: p for p in (players_r.data or [])}

    print("=" * 72)
    print("FIXTURE vs player_gameweek_stats (fixture_id, team counts, top BPS)")
    print("=" * 72)

    for f in fixtures:
        fid = f.get("fpl_fixture_id")
        home_id = f.get("home_team_id")
        away_id = f.get("away_team_id")
        home_short = team_short.get(home_id, "?")
        away_short = team_short.get(away_id, "?")
        rows = [s for s in stats if (s.get("fixture_id") or 0) == fid]
        home_rows = [r for r in rows if r.get("team_id") == home_id]
        away_rows = [r for r in rows if r.get("team_id") == away_id]
        other_rows = [r for r in rows if r.get("team_id") not in (home_id, away_id)]

        status = "scheduled"
        if f.get("finished"):
            status = "final"
        elif f.get("finished_provisional"):
            status = "provisional"
        elif f.get("started"):
            status = "live"

        print(f"\n{home_short} v {away_short}  (fixture_id={fid}, {status})")
        print(f"  Home ({home_short}): {len(home_rows)} rows  |  Away ({away_short}): {len(away_rows)} rows  |  Total: {len(rows)}")
        if other_rows:
            team_ids_seen = {r.get("team_id") for r in other_rows}
            bad_teams = ", ".join(team_short.get(t, str(t)) for t in team_ids_seen)
            print(f"  *** BAD: {len(other_rows)} rows with team_id not in (home, away): {bad_teams} ***")
        if not rows:
            print("  (no player_gameweek_stats for this fixture_id)")
        else:
            by_bps = sorted(rows, key=lambda r: (r.get("bps") or 0), reverse=True)[:5]
            names = []
            for r in by_bps:
                info = player_map.get(r["player_id"], {})
                name = info.get("web_name", "?")
                team = team_short.get(r.get("team_id"), "?")
                names.append(f"{name}({team}) {r.get('bps') or 0}")
            print("  Top 5 BPS:", "  |  ".join(names))

    print("\n" + "=" * 72)
    print("If a fixture shows 0 rows for one side, run: python3 scripts/force_refresh_player_stats.py")
    print("To backfill full squads per fixture: python3 scripts/backfill_fixture_player_stats.py")
    print("=" * 72)


if __name__ == "__main__":
    main()
