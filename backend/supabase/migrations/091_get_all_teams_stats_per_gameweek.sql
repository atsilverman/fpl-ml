-- Per-gameweek stats (G, xG, GC, xGC) for all teams. Used by team detail modal moving-average chart.
-- Goals/GC from fixtures (source of truth); xG from player_gameweek_stats; xGC from def/GK MAX per fixture.

CREATE OR REPLACE FUNCTION get_all_teams_stats_per_gameweek(p_max_gw INT, p_location TEXT DEFAULT 'all')
RETURNS TABLE(team_id INT, gameweek INT, goals INT, xg NUMERIC, goals_conceded INT, xgc NUMERIC)
LANGUAGE plpgsql
STABLE
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH finished_fixtures AS (
    SELECT f.gameweek, f.home_team_id, f.away_team_id, f.home_score, f.away_score
    FROM fixtures f
    WHERE (f.finished = true OR f.finished_provisional = true)
      AND f.home_score IS NOT NULL
      AND f.away_score IS NOT NULL
      AND f.gameweek >= 1
      AND f.gameweek <= p_max_gw
  ),
  -- Goals and GC per team per gameweek from fixtures (DGW: multiple rows per team per gw)
  goals_gc_per_fixture AS (
    SELECT home_team_id AS tid, gameweek, home_score AS g, away_score AS gc, true AS was_home
    FROM finished_fixtures
    WHERE (p_location = 'all') OR (p_location = 'home')
    UNION ALL
    SELECT away_team_id AS tid, gameweek, away_score AS g, home_score AS gc, false AS was_home
    FROM finished_fixtures
    WHERE (p_location = 'all') OR (p_location = 'away')
  ),
  goals_gc_agg AS (
    SELECT tid, gameweek, SUM(g)::INT AS goals, SUM(gc)::INT AS goals_conceded
    FROM goals_gc_per_fixture
    GROUP BY tid, gameweek
  ),
  -- xG per team per gameweek from player_gameweek_stats (per fixture to handle DGW)
  xg_per_fixture AS (
    SELECT pgs.team_id AS tid, pgs.gameweek,
      SUM(COALESCE(pgs.expected_goals, 0))::NUMERIC AS xg
    FROM player_gameweek_stats pgs
    WHERE pgs.team_id IS NOT NULL
      AND pgs.fixture_id IS NOT NULL
      AND pgs.gameweek >= 1
      AND pgs.gameweek <= p_max_gw
      AND ((p_location = 'all') OR (p_location = 'home' AND pgs.was_home = true) OR (p_location = 'away' AND pgs.was_home = false))
    GROUP BY pgs.team_id, pgs.gameweek, pgs.fixture_id
  ),
  xg_agg AS (
    SELECT tid, gameweek, SUM(xg)::NUMERIC AS xg
    FROM xg_per_fixture
    GROUP BY tid, gameweek
  ),
  -- xGC per team per gameweek: MAX per fixture from def/GK, then SUM (same logic as get_team_gc_xgc_per_gameweek)
  def_gk_fixture AS (
    SELECT
      pgs.team_id AS tid,
      pgs.gameweek,
      pgs.fixture_id,
      MAX(COALESCE(pgs.goals_conceded, 0))::INTEGER AS gc,
      MAX(COALESCE(pgs.expected_goals_conceded, 0))::NUMERIC AS xgc
    FROM player_gameweek_stats pgs
    JOIN players pl ON pl.fpl_player_id = pgs.player_id AND pl.position IN (1, 2)
    WHERE pgs.team_id IS NOT NULL
      AND pgs.gameweek >= 1
      AND pgs.gameweek <= p_max_gw
      AND ((p_location = 'all') OR (p_location = 'home' AND pgs.was_home = true) OR (p_location = 'away' AND pgs.was_home = false))
    GROUP BY pgs.team_id, pgs.gameweek, pgs.fixture_id
  ),
  xgc_agg AS (
    SELECT tid, gameweek,
      COALESCE(SUM(gc), 0)::INTEGER AS goals_conceded,
      COALESCE(SUM(xgc), 0)::NUMERIC AS xgc
    FROM def_gk_fixture
    GROUP BY tid, gameweek
  ),
  -- All (team, gameweek) from fixtures so every team with any fixture gets rows
  all_keys AS (
    SELECT t.team_id AS tid, gs.gw AS gameweek
    FROM teams t
    CROSS JOIN (SELECT generate_series(1, p_max_gw)::INT AS gw) gs
    WHERE EXISTS (SELECT 1 FROM goals_gc_agg g WHERE g.tid = t.team_id)
  )
  SELECT
    k.tid::INT AS team_id,
    k.gameweek::INT AS gameweek,
    COALESCE(g.goals, 0)::INT AS goals,
    COALESCE(x.xg, 0)::NUMERIC AS xg,
    COALESCE(g.goals_conceded, 0)::INT AS goals_conceded,
    COALESCE(xc.xgc, 0)::NUMERIC AS xgc
  FROM all_keys k
  LEFT JOIN goals_gc_agg g ON g.tid = k.tid AND g.gameweek = k.gameweek
  LEFT JOIN xg_agg x ON x.tid = k.tid AND x.gameweek = k.gameweek
  LEFT JOIN xgc_agg xc ON xc.tid = k.tid AND xc.gameweek = k.gameweek
  ORDER BY k.tid, k.gameweek;
END;
$$;

COMMENT ON FUNCTION get_all_teams_stats_per_gameweek(INT, TEXT) IS 'Per-gameweek G, xG, GC, xGC for all teams. Used by team detail modal moving-average chart. Goals/GC from fixtures; xG from pgs; xGC from def/GK.';

GRANT EXECUTE ON FUNCTION get_all_teams_stats_per_gameweek(INT, TEXT) TO anon, authenticated;
