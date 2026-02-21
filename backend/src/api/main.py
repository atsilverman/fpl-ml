"""
Backend API: serves stats and fixtures from MVs in one response to reduce round-trips for mobile.
"""

import sys
from pathlib import Path

from dotenv import load_dotenv

# Load .env and ensure backend/src is on path
backend_dir = Path(__file__).resolve().parent.parent.parent
load_dotenv(backend_dir / ".env")
sys.path.insert(0, str(backend_dir / "src"))

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from config import Config
from database.supabase_client import SupabaseClient

app = FastAPI(title="FPL API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Lazy init so we don't require Supabase in tests
_db: SupabaseClient | None = None


def get_db() -> SupabaseClient:
    global _db
    if _db is None:
        _db = SupabaseClient(Config())
    return _db


MV_TABLE_BY_GW = {
    "all": "mv_research_player_stats_all",
    "last6": "mv_research_player_stats_last_6",
    "last12": "mv_research_player_stats_last_12",
}

MV_SELECT = (
    "player_id, location, minutes, effective_total_points, goals_scored, assists, "
    "clean_sheets, saves, bps, defensive_contribution, yellow_cards, red_cards, "
    "expected_goals, expected_assists, expected_goal_involvements, expected_goals_conceded, goals_conceded"
)


def _current_gameweek(db: SupabaseClient) -> int | None:
    r = db.client.table("gameweeks").select("id").eq("is_current", True).limit(1).execute()
    if not r.data or len(r.data) == 0:
        return None
    return int(r.data[0]["id"])


@app.get("/api/v1/stats")
def get_stats(
    gw_filter: str = Query("all", description="all | last6 | last12"),
    location: str = Query("all", description="all | home | away"),
):
    """One response: player stats from research MV + player dimension. UI filters client-side."""
    if gw_filter not in MV_TABLE_BY_GW or location not in ("all", "home", "away"):
        return {"players": [], "error": "Invalid gw_filter or location"}
    db = get_db()
    table = MV_TABLE_BY_GW[gw_filter]
    try:
        r = db.client.table(table).select(MV_SELECT).eq("location", location).execute()
    except Exception as e:
        return {"players": [], "error": str(e)}
    mv_rows = r.data or []
    if not mv_rows:
        return {"players": []}
    player_ids = list({row["player_id"] for row in mv_rows if row.get("player_id") is not None})
    if not player_ids:
        return {"players": []}
    try:
        players_r = (
            db.client.table("players")
            .select("fpl_player_id, web_name, team_id, position, cost_tenths, selected_by_percent, teams(short_name, team_name)")
            .in_("fpl_player_id", player_ids)
            .execute()
        )
    except Exception as e:
        return {"players": [], "error": str(e)}
    players_list = players_r.data or []
    player_map = {}
    for p in players_list:
        pid = p.get("fpl_player_id")
        if pid is None:
            continue
        team = p.get("teams") or {}
        player_map[pid] = {
            "web_name": p.get("web_name") or "Unknown",
            "team_id": p.get("team_id"),
            "team_short_name": team.get("short_name"),
            "team_name": team.get("team_name"),
            "position": p.get("position"),
            "cost_tenths": p.get("cost_tenths"),
            "selected_by_percent": p.get("selected_by_percent"),
        }
    players = []
    for row in mv_rows:
        pid = row.get("player_id")
        info = player_map.get(pid) or {
            "web_name": "Unknown",
            "team_id": None,
            "team_short_name": None,
            "team_name": None,
            "position": None,
            "cost_tenths": None,
            "selected_by_percent": None,
        }
        players.append({
            "player_id": pid,
            "web_name": info["web_name"],
            "team_id": info["team_id"],
            "team_short_name": info["team_short_name"],
            "team_name": info["team_name"],
            "position": info["position"],
            "cost_tenths": info["cost_tenths"],
            "selected_by_percent": info["selected_by_percent"],
            "points": row.get("effective_total_points") or 0,
            "minutes": row.get("minutes") or 0,
            "goals_scored": row.get("goals_scored") or 0,
            "assists": row.get("assists") or 0,
            "clean_sheets": row.get("clean_sheets") or 0,
            "saves": row.get("saves") or 0,
            "bps": row.get("bps") or 0,
            "defensive_contribution": row.get("defensive_contribution") or 0,
            "yellow_cards": row.get("yellow_cards") or 0,
            "red_cards": row.get("red_cards") or 0,
            "expected_goals": float(row.get("expected_goals") or 0),
            "expected_assists": float(row.get("expected_assists") or 0),
            "expected_goal_involvements": float(row.get("expected_goal_involvements") or 0),
            "expected_goals_conceded": float(row.get("expected_goals_conceded") or 0),
            "goals_conceded": row.get("goals_conceded") or 0,
        })
    # Deduped team goals conceded (MAX per fixture then SUM) so team view does not inflate
    team_goals_conceded = {}
    try:
        rpc = db.client.rpc("get_team_goals_conceded_bulk", {"p_gw_filter": gw_filter, "p_location": location})
        if rpc.data:
            for item in rpc.data:
                tid = item.get("team_id")
                if tid is not None:
                    team_goals_conceded[int(tid)] = int(item.get("goals_conceded") or 0)
    except Exception:
        pass
    return {"players": players, "team_goals_conceded": team_goals_conceded}


@app.get("/api/v1/teams/{team_id:int}/stats")
def get_team_stats(
    team_id: int,
    gw_filter: str = Query("all", description="all | last6 | last12"),
    location: str = Query("all", description="all | home | away"),
):
    """Team-level stats from the same research MV as get_stats; matches compare team mode aggregation."""
    if gw_filter not in MV_TABLE_BY_GW or location not in ("all", "home", "away"):
        return {"error": "Invalid gw_filter or location"}
    db = get_db()
    table = MV_TABLE_BY_GW[gw_filter]
    try:
        r = db.client.table(table).select(MV_SELECT).eq("location", location).execute()
    except Exception as e:
        return {"error": str(e)}
    mv_rows = r.data or []
    if not mv_rows:
        return {"team": None, "points": 0, "minutes": 0, "goals_scored": 0, "assists": 0, "clean_sheets": 0, "saves": 0, "bps": 0, "defensive_contribution": 0, "yellow_cards": 0, "red_cards": 0, "expected_goals": 0, "expected_assists": 0, "expected_goal_involvements": 0, "expected_goals_conceded": 0, "goals_conceded": 0}

    player_ids = list({row["player_id"] for row in mv_rows if row.get("player_id") is not None})
    if not player_ids:
        return {"team": None, "points": 0, "minutes": 0, "goals_scored": 0, "assists": 0, "clean_sheets": 0, "saves": 0, "bps": 0, "defensive_contribution": 0, "yellow_cards": 0, "red_cards": 0, "expected_goals": 0, "expected_assists": 0, "expected_goal_involvements": 0, "expected_goals_conceded": 0, "goals_conceded": 0}

    try:
        players_r = (
            db.client.table("players")
            .select("fpl_player_id, team_id")
            .in_("fpl_player_id", player_ids)
            .eq("team_id", team_id)
            .execute()
        )
    except Exception as e:
        return {"error": str(e)}
    team_player_ids = {p["fpl_player_id"] for p in (players_r.data or []) if p.get("fpl_player_id") is not None}
    if not team_player_ids:
        try:
            team_r = db.client.table("teams").select("team_id, short_name, team_name").eq("team_id", team_id).maybe_single().execute()
            team_row = (team_r.data or {}) if team_r.data else None
        except Exception:
            team_row = None
        return {
            "team": {"team_id": team_id, "short_name": team_row.get("short_name"), "team_name": team_row.get("team_name")} if team_row else None,
            "points": 0, "minutes": 0, "goals_scored": 0, "assists": 0, "clean_sheets": 0, "saves": 0, "bps": 0,
            "defensive_contribution": 0, "yellow_cards": 0, "red_cards": 0,
            "expected_goals": 0, "expected_assists": 0, "expected_goal_involvements": 0, "expected_goals_conceded": 0, "goals_conceded": 0,
        }

    points = 0
    minutes = 0
    goals_scored = 0
    assists = 0
    clean_sheets = 0
    saves = 0
    bps = 0
    defensive_contribution = 0
    yellow_cards = 0
    red_cards = 0
    expected_goals = 0.0
    expected_assists = 0.0
    expected_goal_involvements = 0.0
    expected_goals_conceded = 0.0
    goals_conceded = 0
    for row in mv_rows:
        if row.get("player_id") not in team_player_ids:
            continue
        points += row.get("effective_total_points") or 0
        minutes += row.get("minutes") or 0
        goals_scored += row.get("goals_scored") or 0
        assists += row.get("assists") or 0
        clean_sheets += row.get("clean_sheets") or 0
        saves += row.get("saves") or 0
        bps += row.get("bps") or 0
        defensive_contribution += row.get("defensive_contribution") or 0
        yellow_cards += row.get("yellow_cards") or 0
        red_cards += row.get("red_cards") or 0
        expected_goals += float(row.get("expected_goals") or 0)
        expected_assists += float(row.get("expected_assists") or 0)
        expected_goal_involvements += float(row.get("expected_goal_involvements") or 0)
        expected_goals_conceded += float(row.get("expected_goals_conceded") or 0)

    # Team goals_conceded must be deduped (not summed from players). Use RPC.
    try:
        rpc = db.client.rpc("get_team_goals_conceded_bulk", {"p_gw_filter": gw_filter, "p_location": location})
        if rpc.data:
            for item in rpc.data:
                if item.get("team_id") == team_id:
                    goals_conceded = int(item.get("goals_conceded") or 0)
                    break
    except Exception:
        pass

    try:
        team_r = db.client.table("teams").select("team_id, short_name, team_name").eq("team_id", team_id).maybe_single().execute()
        team_row = team_r.data if team_r.data else None
    except Exception:
        team_row = None
    team_info = {"team_id": team_id, "short_name": team_row.get("short_name"), "team_name": team_row.get("team_name")} if team_row else {"team_id": team_id, "short_name": None, "team_name": None}

    return {
        "team": team_info,
        "points": points,
        "minutes": minutes,
        "goals_scored": goals_scored,
        "assists": assists,
        "clean_sheets": clean_sheets,
        "saves": saves,
        "bps": bps,
        "defensive_contribution": defensive_contribution,
        "yellow_cards": yellow_cards,
        "red_cards": red_cards,
        "expected_goals": expected_goals,
        "expected_assists": expected_assists,
        "expected_goal_involvements": expected_goal_involvements,
        "expected_goals_conceded": expected_goals_conceded,
        "goals_conceded": goals_conceded,
    }


@app.get("/api/v1/fixtures")
def get_fixtures(gameweek: int = Query(..., description="Gameweek number")):
    """One response: fixtures with team names + all player stats per fixture from master MV. UI filters client-side."""
    db = get_db()
    try:
        r = (
            db.client.table("mv_master_player_fixture_stats")
            .select("*")
            .eq("gameweek", gameweek)
            .execute()
        )
    except Exception as e:
        return {"fixtures": [], "playerStatsByFixture": {}, "error": str(e)}
    rows = r.data or []
    # Build distinct fixtures (one row per fixture has same fixture metadata)
    seen = set()
    fixtures = []
    for row in rows:
        fid = row.get("fixture_id")
        if fid is None or fid in seen:
            continue
        seen.add(fid)
        fixtures.append({
            "fpl_fixture_id": fid,
            "gameweek": row.get("gameweek"),
            "home_team_id": row.get("home_team_id"),
            "away_team_id": row.get("away_team_id"),
            "home_team_short_name": row.get("home_team_short_name"),
            "away_team_short_name": row.get("away_team_short_name"),
            "kickoff_time": row.get("kickoff_time"),
            "deadline_time": row.get("deadline_time"),
            "home_score": row.get("home_score"),
            "away_score": row.get("away_score"),
            "started": row.get("started"),
            "finished": row.get("finished"),
            "finished_provisional": row.get("finished_provisional"),
            "minutes": row.get("fixture_minutes"),
            "homeTeam": {"short_name": row.get("home_team_short_name"), "team_name": None},
            "awayTeam": {"short_name": row.get("away_team_short_name"), "team_name": None},
        })
    # If no rows from MV (e.g. MV not populated), fall back to fixtures + teams tables
    if not fixtures and not rows:
        try:
            f_r = db.client.table("fixtures").select("*").eq("gameweek", gameweek).order("kickoff_time").execute()
            fix_list = f_r.data or []
            if fix_list:
                team_ids = set()
                for f in fix_list:
                    if f.get("home_team_id"):
                        team_ids.add(f["home_team_id"])
                    if f.get("away_team_id"):
                        team_ids.add(f["away_team_id"])
                t_r = db.client.table("teams").select("team_id, short_name, team_name").in_("team_id", list(team_ids)).execute()
                team_map = {t["team_id"]: {"short_name": t.get("short_name"), "team_name": t.get("team_name")} for t in (t_r.data or [])}
                for f in fix_list:
                    f["homeTeam"] = team_map.get(f.get("home_team_id")) or {"short_name": None, "team_name": None}
                    f["awayTeam"] = team_map.get(f.get("away_team_id")) or {"short_name": None, "team_name": None}
                fixtures = fix_list
        except Exception:
            pass
    # Group player stats by fixture_id
    by_fixture = {}
    for row in rows:
        fid = row.get("fixture_id")
        if fid is None:
            continue
        if fid not in by_fixture:
            by_fixture[fid] = []
        by_fixture[fid].append({
            "player_id": row.get("player_id"),
            "web_name": row.get("player_web_name"),
            "position": row.get("player_position"),
            "fixture_id": row.get("fixture_id"),
            "team_id": row.get("team_id"),
            "team_short_name": row.get("team_short_name"),
            "minutes": row.get("minutes"),
            "total_points": row.get("effective_total_points"),
            "effective_total_points": row.get("effective_total_points"),
            "goals_scored": row.get("goals_scored"),
            "assists": row.get("assists"),
            "clean_sheets": row.get("clean_sheets"),
            "saves": row.get("saves"),
            "bps": row.get("bps"),
            "defensive_contribution": row.get("defensive_contribution"),
            "yellow_cards": row.get("yellow_cards"),
            "red_cards": row.get("red_cards"),
            "expected_goals": row.get("expected_goals"),
            "expected_assists": row.get("expected_assists"),
            "expected_goal_involvements": row.get("expected_goal_involvements"),
            "expected_goals_conceded": row.get("expected_goals_conceded"),
            "goals_conceded": row.get("goals_conceded"),
        })
    # Sort fixtures by kickoff_time
    fixtures.sort(key=lambda x: (x.get("kickoff_time") or ""))
    return {"fixtures": fixtures, "playerStatsByFixture": by_fixture}


@app.get("/health")
def health():
    return {"status": "ok"}
