#!/usr/bin/env python3
"""
Check GW fixtures vs player_gameweek_stats sync (MUN/MCI / today's games).

Compares:
  - fixtures: started, finished_provisional, finished, home_score, away_score
  - player_gameweek_stats: minutes, total_points, match_finished_provisional

If fixtures show live/finished but PGS still has 0 minutes and 0 points,
the event-live refresh is not updating player_gameweek_stats for those players.

Usage:
    cd backend && python scripts/check_gw_player_stats_sync.py

Uses SUPABASE_URL and SUPABASE_KEY (or SUPABASE_SERVICE_KEY) from .env.
"""

import sys
from pathlib import Path

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env")

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
from config import Config
from database.supabase_client import SupabaseClient


def main():
    config = Config()
    try:
        config.validate()
    except ValueError as e:
        print(f"Config error: {e}")
        sys.exit(1)

    db = SupabaseClient(config)
    client = db.client

    # Current gameweek
    gw_r = client.table("gameweeks").select("id, name").eq("is_current", True).limit(1).execute()
    if not gw_r.data:
        print("No current gameweek found.")
        sys.exit(1)
    gw = gw_r.data[0]["id"]
    gw_name = gw_r.data[0].get("name", f"GW{gw}")
    print(f"Current gameweek: {gw} ({gw_name})\n")

    # MUN / MCI team_ids
    teams_r = client.table("teams").select("team_id, short_name").in_("short_name", ["MUN", "MCI"]).execute()
    mun_mci_ids = [t["team_id"] for t in (teams_r.data or [])]
    team_short = {t["team_id"]: t["short_name"] for t in (teams_r.data or [])}
    if not mun_mci_ids:
        print("MUN/MCI teams not found in teams table.")
        sys.exit(1)
    print(f"MUN/MCI team_ids: {mun_mci_ids} ({', '.join(team_short.get(i, '?') for i in mun_mci_ids)})\n")

    # Fixtures for current GW involving MUN or MCI
    fix_r = client.table("fixtures").select(
        "fpl_fixture_id, home_team_id, away_team_id, home_score, away_score, "
        "started, finished_provisional, finished, minutes, kickoff_time"
    ).eq("gameweek", gw).execute()
    fixtures = fix_r.data or []
    # Filter to fixtures where home or away is MUN/MCI
    fixtures_mun_mci = [f for f in fixtures if f.get("home_team_id") in mun_mci_ids or f.get("away_team_id") in mun_mci_ids]

    # Team short names for fixture display (all teams in those fixtures)
    all_team_ids = set()
    for f in fixtures_mun_mci:
        all_team_ids.add(f.get("home_team_id"))
        all_team_ids.add(f.get("away_team_id"))
    if all_team_ids:
        tn_r = client.table("teams").select("team_id, short_name").in_("team_id", list(all_team_ids)).execute()
        for t in (tn_r.data or []):
            team_short[t["team_id"]] = t["short_name"]

    print("=" * 70)
    print("FIXTURES (current GW, MUN/MCI only)")
    print("=" * 70)
    if not fixtures_mun_mci:
        print("  No fixtures found for MUN/MCI in this gameweek.\n")
    else:
        for f in fixtures_mun_mci:
            home = team_short.get(f["home_team_id"], "?")
            away = team_short.get(f["away_team_id"], "?")
            print(f"  {home} v {away}")
            print(f"    fpl_fixture_id={f.get('fpl_fixture_id')}  started={f.get('started')}  "
                  f"finished_provisional={f.get('finished_provisional')}  finished={f.get('finished')}")
            print(f"    home_score={f.get('home_score')}  away_score={f.get('away_score')}  minutes={f.get('minutes')}  kickoff={f.get('kickoff_time')}")
            print()
    print()

    # player_gameweek_stats for current GW, MUN/MCI players only
    pgs_r = client.table("player_gameweek_stats").select(
        "player_id, team_id, fixture_id, minutes, total_points, kickoff_time, "
        "match_finished, match_finished_provisional"
    ).eq("gameweek", gw).in_("team_id", mun_mci_ids).execute()
    pgs_rows = pgs_r.data or []

    # Player names
    player_ids = list({r["player_id"] for r in pgs_rows})
    players_map = {}
    if player_ids:
        pl_r = client.table("players").select("fpl_player_id, web_name").in_("fpl_player_id", player_ids).execute()
        for p in (pl_r.data or []):
            players_map[p["fpl_player_id"]] = p.get("web_name", "?")

    print("=" * 70)
    print("PLAYER_GAMEWEEK_STATS (current GW, MUN/MCI players)")
    print("=" * 70)
    if not pgs_rows:
        print("  No player_gameweek_stats rows for MUN/MCI in this gameweek.")
        print("  (So GW points table has nothing to show → scheduled/0.)\n")
    else:
        for r in sorted(pgs_rows, key=lambda x: (team_short.get(x["team_id"], "?"), players_map.get(x["player_id"], ""))):
            team = team_short.get(r["team_id"], "?")
            name = players_map.get(r["player_id"], "?")
            mins = r.get("minutes") or 0
            pts = r.get("total_points") or 0
            print(f"  {team}  {name}:  minutes={mins}  total_points={pts}  "
                  f"fixture_id={r.get('fixture_id')}  match_finished_provisional={r.get('match_finished_provisional')}  kickoff={r.get('kickoff_time')}")
        print()
    print()

    # Side-by-side: for each MUN/MCI fixture, do we have PGS rows with minutes > 0?
    print("=" * 70)
    print("SYNC CHECK (fixture status vs PGS)")
    print("=" * 70)
    fixture_ids_mun_mci = {f["fpl_fixture_id"] for f in fixtures_mun_mci}
    pgs_by_fixture = {}
    for r in pgs_rows:
        fid = r.get("fixture_id")
        if fid not in pgs_by_fixture:
            pgs_by_fixture[fid] = []
        pgs_by_fixture[fid].append(r)

    for f in fixtures_mun_mci:
        fid = f["fpl_fixture_id"]
        home = team_short.get(f["home_team_id"], "?")
        away = team_short.get(f["away_team_id"], "?")
        started = f.get("started")
        fin_prov = f.get("finished_provisional")
        finished = f.get("finished")
        rows = pgs_by_fixture.get(fid) or []
        with_mins = [r for r in rows if (r.get("minutes") or 0) > 0]
        status = "started" if started else "not_started"
        if fin_prov:
            status = "finished_provisional"
        if finished:
            status = "finished"
        print(f"  {home} v {away} (fixture_id={fid})")
        print(f"    Fixture: {status}  score {f.get('home_score')}-{f.get('away_score')}")
        print(f"    PGS rows: {len(rows)}  with minutes>0: {len(with_mins)}")
        if rows and len(with_mins) == 0 and (started or fin_prov):
            print("    >>> DISCONNECT: fixture is live/finished but PGS has no minutes (GW points will show scheduled/0)")
        print()
    print("Done. If you see DISCONNECT above, the event-live refresh is not updating player_gameweek_stats for those fixtures.")


if __name__ == "__main__":
    main()
