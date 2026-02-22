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


# Allowed sort columns for stats (must match merged response keys)
STATS_SORT_COLUMNS = {
    "points", "minutes", "goals_scored", "assists", "clean_sheets", "saves",
    "bps", "defensive_contribution", "yellow_cards", "red_cards",
    "expected_goals", "expected_assists", "expected_goal_involvements",
    "expected_goals_conceded", "goals_conceded", "selected_by_percent",
    "web_name", "team_short_name", "position", "cost_tenths",
}


@app.get("/api/v1/stats")
def get_stats(
    gw_filter: str = Query("all", description="all | last6 | last12"),
    location: str = Query("all", description="all | home | away"),
    page: int = Query(1, ge=1, description="Page number (1-based)"),
    page_size: int = Query(100, ge=1, le=5000, description="Players per page"),
    sort_by: str = Query("points", description="Sort column (e.g. points, goals_scored)"),
    sort_dir: str = Query("desc", description="asc | desc"),
    position: int | None = Query(None, description="Filter by position 1=GK,2=DEF,3=MID,4=FWD"),
    search: str | None = Query(None, description="Filter by player or team name"),
):
    """Player stats from research MV + player dimension. Paginated; optional position/search filter."""
    if gw_filter not in MV_TABLE_BY_GW or location not in ("all", "home", "away"):
        return {"players": [], "total_count": 0, "page": 1, "page_size": page_size, "error": "Invalid gw_filter or location"}
    if sort_by not in STATS_SORT_COLUMNS or sort_dir not in ("asc", "desc"):
        return {"players": [], "total_count": 0, "page": 1, "page_size": page_size, "error": "Invalid sort_by or sort_dir"}
    db = get_db()
    table = MV_TABLE_BY_GW[gw_filter]
    try:
        r = db.client.table(table).select(MV_SELECT).eq("location", location).execute()
    except Exception as e:
        return {"players": [], "total_count": 0, "page": 1, "page_size": page_size, "error": str(e)}
    mv_rows = r.data or []
    if not mv_rows:
        return {"players": [], "total_count": 0, "page": page, "page_size": page_size, "team_goals_conceded": {}}
    player_ids = list({row["player_id"] for row in mv_rows if row.get("player_id") is not None})
    if not player_ids:
        return {"players": [], "total_count": 0, "page": page, "page_size": page_size, "team_goals_conceded": {}}
    try:
        players_r = (
            db.client.table("players")
            .select("fpl_player_id, web_name, team_id, position, cost_tenths, selected_by_percent, teams(short_name, team_name)")
            .in_("fpl_player_id", player_ids)
            .execute()
        )
    except Exception as e:
        return {"players": [], "total_count": 0, "page": 1, "page_size": page_size, "error": str(e)}
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
    # Filter by position
    if position is not None and 1 <= position <= 4:
        players = [p for p in players if p.get("position") == position]
    # Filter by search (player or team name)
    if search and search.strip():
        q = search.strip().lower()
        players = [
            p for p in players
            if (p.get("web_name") and q in (p["web_name"] or "").lower())
            or (p.get("team_short_name") and q in (p["team_short_name"] or "").lower())
            or (p.get("team_name") and q in (p["team_name"] or "").lower())
        ]
    # Sort
    reverse = sort_dir == "desc"
    numeric_keys = {
        "points", "minutes", "goals_scored", "assists", "clean_sheets", "saves",
        "bps", "defensive_contribution", "yellow_cards", "red_cards",
        "expected_goals", "expected_assists", "expected_goal_involvements",
        "expected_goals_conceded", "goals_conceded", "selected_by_percent",
        "position", "cost_tenths",
    }
    def sort_key(p):
        val = p.get(sort_by)
        if sort_by in numeric_keys:
            return (0, float(val) if val is not None else 0.0)
        return (1, (val or "").lower() if isinstance(val, str) else str(val or ""))
    players.sort(key=sort_key, reverse=reverse)
    total_count = len(players)
    # Top 10 player_ids per stat (from full filtered list) so frontend can show green fill on any page
    STAT_FIELDS_TOP10 = [
        "points", "minutes", "goals_scored", "assists", "expected_goals", "expected_assists",
        "expected_goal_involvements", "clean_sheets", "saves", "bps", "defensive_contribution",
        "expected_goals_conceded", "goals_conceded", "yellow_cards", "red_cards", "selected_by_percent",
    ]
    LOWER_IS_BETTER = {"expected_goals_conceded", "goals_conceded", "yellow_cards", "red_cards"}
    top_10_player_ids_by_field = {}
    for field in STAT_FIELDS_TOP10:
        def _key(p, f=field):
            val = p.get(f)
            if val is None:
                return (0, 0.0)
            return (0, float(val))
        sorted_by_field = sorted(players, key=_key, reverse=(field not in LOWER_IS_BETTER))
        top_10_player_ids_by_field[field] = [p["player_id"] for p in sorted_by_field[:10] if p.get("player_id") is not None]
    # Paginate
    start = (page - 1) * page_size
    players = players[start : start + page_size]
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
    return {
        "players": players,
        "total_count": total_count,
        "page": page,
        "page_size": page_size,
        "team_goals_conceded": team_goals_conceded,
        "top_10_player_ids_by_field": top_10_player_ids_by_field,
    }


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
    """Fixtures list always from fixtures table (full gameweek). Stats per fixture from MV, then player_gameweek_stats for any fixture with no MV data (per-match flex during live)."""
    db = get_db()
    by_fixture = {}
    try:
        # 1. Always build fixture list from fixtures table so we have all matches (live + finished + provisional).
        f_r = db.client.table("fixtures").select("*").eq("gameweek", gameweek).order("kickoff_time").execute()
        fix_list = f_r.data or []
        team_ids = set()
        for f in fix_list:
            if f.get("home_team_id"):
                team_ids.add(f["home_team_id"])
            if f.get("away_team_id"):
                team_ids.add(f["away_team_id"])
        team_map = {}
        if team_ids:
            t_r = db.client.table("teams").select("team_id, short_name, team_name").in_("team_id", list(team_ids)).execute()
            team_map = {t["team_id"]: {"short_name": t.get("short_name"), "team_name": t.get("team_name")} for t in (t_r.data or [])}
        fixtures = []
        for f in fix_list:
            fixtures.append({
                "fpl_fixture_id": f.get("fpl_fixture_id"),
                "gameweek": f.get("gameweek"),
                "home_team_id": f.get("home_team_id"),
                "away_team_id": f.get("away_team_id"),
                "home_team_short_name": team_map.get(f.get("home_team_id"), {}).get("short_name"),
                "away_team_short_name": team_map.get(f.get("away_team_id"), {}).get("short_name"),
                "kickoff_time": f.get("kickoff_time"),
                "deadline_time": f.get("deadline_time"),
                "home_score": f.get("home_score"),
                "away_score": f.get("away_score"),
                "started": f.get("started"),
                "finished": f.get("finished"),
                "finished_provisional": f.get("finished_provisional"),
                "minutes": f.get("minutes"),
                "homeTeam": team_map.get(f.get("home_team_id")) or {"short_name": None, "team_name": None},
                "awayTeam": team_map.get(f.get("away_team_id")) or {"short_name": None, "team_name": None},
            })
        fixture_ids = {fi["fpl_fixture_id"] for fi in fixtures if fi.get("fpl_fixture_id") is not None}

        # 2. Fill stats from MV where available.
        try:
            mv_r = db.client.table("mv_master_player_fixture_stats").select("*").eq("gameweek", gameweek).execute()
            rows = mv_r.data or []
            for row in rows:
                fid = row.get("fixture_id")
                if fid is None:
                    continue
                if fid not in by_fixture:
                    by_fixture[fid] = []
                eff_bonus = row.get("effective_bonus")
                if eff_bonus is None:
                    eff_bonus = row.get("bonus") if (row.get("bonus_status") == "confirmed" or (row.get("bonus") or 0) > 0) else row.get("provisional_bonus")
                if eff_bonus is None:
                    eff_bonus = 0
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
                    "bonus": int(eff_bonus) if eff_bonus is not None else 0,
                    "bonus_status": row.get("bonus_status") or "provisional",
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
        except Exception:
            rows = []

        # 3. For fixtures with no MV stats (e.g. during live when MV is stale), fill from player_gameweek_stats.
        missing_fids = [fid for fid in fixture_ids if not by_fixture.get(fid)]
        if missing_fids:
            try:
                pgs_r = db.client.table("player_gameweek_stats").select(
                    "player_id, fixture_id, team_id, minutes, total_points, goals_scored, assists, clean_sheets, saves, bps, defensive_contribution, yellow_cards, red_cards, expected_goals, expected_assists, expected_goal_involvements, expected_goals_conceded, goals_conceded, bonus_status, bonus, provisional_bonus"
                ).eq("gameweek", gameweek).in_("fixture_id", missing_fids).execute()
                pgs_rows = pgs_r.data or []
                if pgs_rows:
                    player_ids = list({r["player_id"] for r in pgs_rows})
                    pl_r = db.client.table("players").select("fpl_player_id, web_name, position").in_("fpl_player_id", player_ids).execute()
                    pl_map = {p["fpl_player_id"]: p for p in (pl_r.data or [])}
                    team_ids_p = set(r["team_id"] for r in pgs_rows if r.get("team_id") is not None)
                    t_r2 = db.client.table("teams").select("team_id, short_name").in_("team_id", list(team_ids_p)).execute()
                    team_short = {t["team_id"]: t.get("short_name") for t in (t_r2.data or [])}
                    for r in pgs_rows:
                        fid = r.get("fixture_id")
                        if fid is None or fid == 0:
                            continue
                        info = pl_map.get(r["player_id"]) or {}
                        bonus_status = r.get("bonus_status") or "provisional"
                        prov_b = int(r.get("provisional_bonus") or 0)
                        off_b = int(r.get("bonus") or 0)
                        total_pts = int(r.get("total_points") or 0)
                        eff_pts = total_pts if (bonus_status == "confirmed" or off_b > 0) else total_pts + prov_b
                        if fid not in by_fixture:
                            by_fixture[fid] = []
                        display_bonus = off_b if (bonus_status == "confirmed" or off_b > 0) else prov_b
                        by_fixture[fid].append({
                            "player_id": r.get("player_id"),
                            "web_name": info.get("web_name", "Unknown"),
                            "position": info.get("position"),
                            "fixture_id": fid,
                            "team_id": r.get("team_id"),
                            "team_short_name": team_short.get(r["team_id"]),
                            "minutes": r.get("minutes"),
                            "total_points": eff_pts,
                            "effective_total_points": eff_pts,
                            "bonus": display_bonus,
                            "bonus_status": bonus_status,
                            "goals_scored": r.get("goals_scored"),
                            "assists": r.get("assists"),
                            "clean_sheets": r.get("clean_sheets"),
                            "saves": r.get("saves"),
                            "bps": r.get("bps"),
                            "defensive_contribution": r.get("defensive_contribution"),
                            "yellow_cards": r.get("yellow_cards"),
                            "red_cards": r.get("red_cards"),
                            "expected_goals": r.get("expected_goals"),
                            "expected_assists": r.get("expected_assists"),
                            "expected_goal_involvements": r.get("expected_goal_involvements"),
                            "expected_goals_conceded": r.get("expected_goals_conceded"),
                            "goals_conceded": r.get("goals_conceded"),
                        })
            except Exception:
                pass

        fixtures.sort(key=lambda x: (x.get("kickoff_time") or ""))
        return {"fixtures": fixtures, "playerStatsByFixture": by_fixture}
    except Exception as e:
        return {"fixtures": [], "playerStatsByFixture": {}, "error": str(e)}


@app.get("/health")
def health():
    return {"status": "ok"}
