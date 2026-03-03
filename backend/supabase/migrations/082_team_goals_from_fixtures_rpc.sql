-- Team goals (G) and goals conceded (GC) from fixtures table only.
-- Source of truth for match results; no player aggregation.
-- Same gw_filter and location semantics as get_team_goals_conceded_bulk.

DROP FUNCTION IF EXISTS get_team_goals_from_fixtures(text, text);

CREATE OR REPLACE FUNCTION get_team_goals_from_fixtures(p_gw_filter TEXT, p_location TEXT)
RETURNS TABLE(team_id INT, goals INT, goals_conceded INT)
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
  WITH finished_fixtures AS (
    SELECT
      f.gameweek,
      f.home_team_id,
      f.away_team_id,
      f.home_score,
      f.away_score
    FROM fixtures f
    WHERE (f.finished = true OR f.finished_provisional = true)
      AND f.home_score IS NOT NULL
      AND f.away_score IS NOT NULL
      AND f.gameweek >= v_min_gw
      AND f.gameweek <= v_current_gw
  ),
  filtered AS (
    SELECT hr.t_id, hr.g, hr.gc
    FROM (SELECT home_team_id AS t_id, home_score AS g, away_score AS gc, true AS was_home FROM finished_fixtures) hr
    WHERE (p_location = 'all') OR (p_location = 'home' AND hr.was_home)
    UNION ALL
    SELECT ar.t_id, ar.g, ar.gc
    FROM (SELECT away_team_id AS t_id, away_score AS g, home_score AS gc, false AS was_home FROM finished_fixtures) ar
    WHERE (p_location = 'all') OR (p_location = 'away' AND NOT ar.was_home)
  ),
  agg AS (
    SELECT
      f.t_id,
      COALESCE(SUM(f.g), 0)::INT AS sum_g,
      COALESCE(SUM(f.gc), 0)::INT AS sum_gc
    FROM filtered f
    GROUP BY f.t_id
  )
  SELECT agg.t_id::INT, agg.sum_g, agg.sum_gc
  FROM agg;
END;
$$;

COMMENT ON FUNCTION get_team_goals_from_fixtures(TEXT, TEXT) IS 'Team G and GC from fixtures table only (source of truth). gw_filter: all|last6|last12, location: all|home|away.';

GRANT EXECUTE ON FUNCTION get_team_goals_from_fixtures(TEXT, TEXT) TO anon, authenticated;
