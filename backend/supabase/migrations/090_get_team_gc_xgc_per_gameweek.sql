-- Per-gameweek GC and xGC for a single team, using MAX from def/GK per fixture (no double count).
-- Used by team detail modal "stats by gameweek" chart.

CREATE OR REPLACE FUNCTION get_team_gc_xgc_per_gameweek(p_team_id INT, p_max_gw INT, p_location TEXT DEFAULT 'all')
RETURNS TABLE(gameweek INT, goals_conceded INT, expected_goals_conceded NUMERIC)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  WITH def_gk_fixture AS (
    SELECT
      pgs.team_id,
      pgs.gameweek,
      pgs.fixture_id,
      MAX(COALESCE(pgs.goals_conceded, 0))::INTEGER AS gc,
      MAX(COALESCE(pgs.expected_goals_conceded, 0))::NUMERIC AS xgc
    FROM player_gameweek_stats pgs
    JOIN players pl ON pl.fpl_player_id = pgs.player_id AND pl.position IN (1, 2)
    WHERE pgs.team_id = p_team_id
      AND pgs.gameweek >= 1
      AND pgs.gameweek <= p_max_gw
      AND (p_location = 'all' OR (p_location = 'home' AND pgs.was_home = true) OR (p_location = 'away' AND pgs.was_home = false))
    GROUP BY pgs.team_id, pgs.gameweek, pgs.fixture_id
  )
  SELECT
    d.gameweek::INT,
    COALESCE(SUM(d.gc), 0)::INTEGER AS goals_conceded,
    COALESCE(SUM(d.xgc), 0)::NUMERIC AS expected_goals_conceded
  FROM def_gk_fixture d
  GROUP BY d.gameweek
  ORDER BY d.gameweek;
END;
$$;

COMMENT ON FUNCTION get_team_gc_xgc_per_gameweek(INT, INT, TEXT) IS 'Per-gameweek GC and xGC for team detail chart. MAX per (team, gameweek, fixture) from def/GK only, then SUM across fixtures (DGW). p_max_gw: include gameweeks 1..p_max_gw.';

GRANT EXECUTE ON FUNCTION get_team_gc_xgc_per_gameweek(INT, INT, TEXT) TO anon, authenticated;
