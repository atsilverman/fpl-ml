-- Team GC and xGC using MAX from defenders and goalkeepers only per (team, gameweek, fixture).
-- Ensures we use the same fixture-level value (no double count) and only players who have GC/xGC in FPL.

DROP FUNCTION IF EXISTS get_team_goals_conceded_bulk(text, text);

CREATE OR REPLACE FUNCTION get_team_goals_conceded_bulk(p_gw_filter TEXT, p_location TEXT)
RETURNS TABLE(team_id INT, goals_conceded INT, expected_goals_conceded NUMERIC)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_current_gw INT;
  v_min_gw INT;
BEGIN
  SELECT COALESCE((SELECT id FROM gameweeks WHERE is_current = true LIMIT 1), 1) INTO v_current_gw;
  v_min_gw := CASE p_gw_filter
    WHEN 'last6'  THEN GREATEST(1, v_current_gw - 5)
    WHEN 'last12' THEN GREATEST(1, v_current_gw - 11)
    ELSE 1
  END;

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
    WHERE pgs.team_id IS NOT NULL
      AND pgs.gameweek >= v_min_gw
      AND pgs.gameweek <= v_current_gw
      AND (p_location = 'all' OR (p_location = 'home' AND pgs.was_home = true) OR (p_location = 'away' AND pgs.was_home = false))
    GROUP BY pgs.team_id, pgs.gameweek, pgs.fixture_id
  )
  SELECT
    d.team_id::INT,
    COALESCE(SUM(d.gc), 0)::INTEGER AS goals_conceded,
    COALESCE(SUM(d.xgc), 0)::NUMERIC AS expected_goals_conceded
  FROM def_gk_fixture d
  GROUP BY d.team_id;
END;
$$;

COMMENT ON FUNCTION get_team_goals_conceded_bulk(TEXT, TEXT) IS 'Deduped team GC and xGC for stats API: MAX per (team, gameweek, fixture) from defenders and goalkeepers only, then SUM. gw_filter: all|last6|last12, location: all|home|away.';
