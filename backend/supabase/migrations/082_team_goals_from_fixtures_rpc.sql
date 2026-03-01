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
  home_rows AS (
    SELECT
      gameweek,
      home_team_id AS team_id,
      home_score AS goals,
      away_score AS goals_conceded,
      true AS was_home
    FROM finished_fixtures
  ),
  away_rows AS (
    SELECT
      gameweek,
      away_team_id AS team_id,
      away_score AS goals,
      home_score AS goals_conceded,
      false AS was_home
    FROM finished_fixtures
  ),
  filtered AS (
    SELECT team_id, goals, goals_conceded
    FROM home_rows
    WHERE (p_location = 'all') OR (p_location = 'home' AND was_home)
    UNION ALL
    SELECT team_id, goals, goals_conceded
    FROM away_rows
    WHERE (p_location = 'all') OR (p_location = 'away' AND NOT was_home)
  )
  SELECT
    filtered.team_id::INT,
    COALESCE(SUM(filtered.goals), 0)::INT AS goals,
    COALESCE(SUM(filtered.goals_conceded), 0)::INT AS goals_conceded
  FROM filtered
  GROUP BY filtered.team_id;
END;
$$;

COMMENT ON FUNCTION get_team_goals_from_fixtures(TEXT, TEXT) IS 'Team G and GC from fixtures table only (source of truth). gw_filter: all|last6|last12, location: all|home|away.';
