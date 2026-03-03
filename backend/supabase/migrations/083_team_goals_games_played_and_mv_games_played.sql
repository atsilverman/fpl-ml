-- Add games_played to get_team_goals_from_fixtures for per-match denominator.
-- Add games_played to research MVs for player per-match denominator.

-- 1) get_team_goals_from_fixtures: add games_played
DROP FUNCTION IF EXISTS get_team_goals_from_fixtures(text, text);

CREATE OR REPLACE FUNCTION get_team_goals_from_fixtures(p_gw_filter TEXT, p_location TEXT)
RETURNS TABLE(team_id INT, goals INT, goals_conceded INT, games_played INT)
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
      COALESCE(SUM(f.gc), 0)::INT AS sum_gc,
      COUNT(*)::INT AS gp
    FROM filtered f
    GROUP BY f.t_id
  )
  SELECT agg.t_id::INT, agg.sum_g, agg.sum_gc, agg.gp
  FROM agg;
END;
$$;

COMMENT ON FUNCTION get_team_goals_from_fixtures(TEXT, TEXT) IS 'Team G, GC, and games_played from fixtures table. gw_filter: all|last6|last12, location: all|home|away.';

GRANT EXECUTE ON FUNCTION get_team_goals_from_fixtures(TEXT, TEXT) TO anon, authenticated;

-- 2) mv_research_player_stats_*: add games_played (fixture count per player)
DROP MATERIALIZED VIEW IF EXISTS mv_research_player_stats_all;
CREATE MATERIALIZED VIEW mv_research_player_stats_all AS
WITH current_gw AS (
  SELECT COALESCE((SELECT id FROM gameweeks WHERE is_current = true LIMIT 1), 1) AS gw
),
all_loc AS (
  SELECT
    pgs.player_id,
    'all'::TEXT AS location,
    SUM(COALESCE(pgs.minutes, 0))::INTEGER AS minutes,
    SUM(CASE WHEN pgs.bonus_status = 'confirmed' OR COALESCE(pgs.bonus, 0) > 0 THEN pgs.total_points ELSE pgs.total_points + COALESCE(pgs.provisional_bonus, 0) END)::INTEGER AS effective_total_points,
    SUM(COALESCE(pgs.goals_scored, 0))::INTEGER AS goals_scored,
    SUM(COALESCE(pgs.assists, 0))::INTEGER AS assists,
    SUM(COALESCE(pgs.clean_sheets, 0))::INTEGER AS clean_sheets,
    SUM(COALESCE(pgs.saves, 0))::INTEGER AS saves,
    SUM(COALESCE(pgs.bps, 0))::INTEGER AS bps,
    SUM(COALESCE(pgs.defensive_contribution, 0))::INTEGER AS defensive_contribution,
    SUM(COALESCE(pgs.yellow_cards, 0))::INTEGER AS yellow_cards,
    SUM(COALESCE(pgs.red_cards, 0))::INTEGER AS red_cards,
    (SUM(COALESCE(pgs.expected_goals, 0))::NUMERIC(10,2)) AS expected_goals,
    (SUM(COALESCE(pgs.expected_assists, 0))::NUMERIC(10,2)) AS expected_assists,
    (SUM(COALESCE(pgs.expected_goal_involvements, 0))::NUMERIC(10,2)) AS expected_goal_involvements,
    (SUM(COALESCE(pgs.expected_goals_conceded, 0))::NUMERIC(10,2)) AS expected_goals_conceded,
    SUM(COALESCE(pgs.goals_conceded, 0))::INTEGER AS goals_conceded,
    COUNT(*)::INTEGER AS games_played
  FROM player_gameweek_stats pgs
  CROSS JOIN current_gw c
  WHERE pgs.gameweek >= 1 AND pgs.gameweek <= c.gw
  GROUP BY pgs.player_id
  HAVING SUM(COALESCE(pgs.minutes, 0)) >= 1
),
home_loc AS (
  SELECT
    pgs.player_id,
    'home'::TEXT AS location,
    SUM(COALESCE(pgs.minutes, 0))::INTEGER AS minutes,
    SUM(CASE WHEN pgs.bonus_status = 'confirmed' OR COALESCE(pgs.bonus, 0) > 0 THEN pgs.total_points ELSE pgs.total_points + COALESCE(pgs.provisional_bonus, 0) END)::INTEGER AS effective_total_points,
    SUM(COALESCE(pgs.goals_scored, 0))::INTEGER AS goals_scored,
    SUM(COALESCE(pgs.assists, 0))::INTEGER AS assists,
    SUM(COALESCE(pgs.clean_sheets, 0))::INTEGER AS clean_sheets,
    SUM(COALESCE(pgs.saves, 0))::INTEGER AS saves,
    SUM(COALESCE(pgs.bps, 0))::INTEGER AS bps,
    SUM(COALESCE(pgs.defensive_contribution, 0))::INTEGER AS defensive_contribution,
    SUM(COALESCE(pgs.yellow_cards, 0))::INTEGER AS yellow_cards,
    SUM(COALESCE(pgs.red_cards, 0))::INTEGER AS red_cards,
    (SUM(COALESCE(pgs.expected_goals, 0))::NUMERIC(10,2)) AS expected_goals,
    (SUM(COALESCE(pgs.expected_assists, 0))::NUMERIC(10,2)) AS expected_assists,
    (SUM(COALESCE(pgs.expected_goal_involvements, 0))::NUMERIC(10,2)) AS expected_goal_involvements,
    (SUM(COALESCE(pgs.expected_goals_conceded, 0))::NUMERIC(10,2)) AS expected_goals_conceded,
    SUM(COALESCE(pgs.goals_conceded, 0))::INTEGER AS goals_conceded,
    COUNT(*)::INTEGER AS games_played
  FROM player_gameweek_stats pgs
  CROSS JOIN current_gw c
  WHERE pgs.gameweek >= 1 AND pgs.gameweek <= c.gw AND pgs.was_home = true
  GROUP BY pgs.player_id
  HAVING SUM(COALESCE(pgs.minutes, 0)) >= 1
),
away_loc AS (
  SELECT
    pgs.player_id,
    'away'::TEXT AS location,
    SUM(COALESCE(pgs.minutes, 0))::INTEGER AS minutes,
    SUM(CASE WHEN pgs.bonus_status = 'confirmed' OR COALESCE(pgs.bonus, 0) > 0 THEN pgs.total_points ELSE pgs.total_points + COALESCE(pgs.provisional_bonus, 0) END)::INTEGER AS effective_total_points,
    SUM(COALESCE(pgs.goals_scored, 0))::INTEGER AS goals_scored,
    SUM(COALESCE(pgs.assists, 0))::INTEGER AS assists,
    SUM(COALESCE(pgs.clean_sheets, 0))::INTEGER AS clean_sheets,
    SUM(COALESCE(pgs.saves, 0))::INTEGER AS saves,
    SUM(COALESCE(pgs.bps, 0))::INTEGER AS bps,
    SUM(COALESCE(pgs.defensive_contribution, 0))::INTEGER AS defensive_contribution,
    SUM(COALESCE(pgs.yellow_cards, 0))::INTEGER AS yellow_cards,
    SUM(COALESCE(pgs.red_cards, 0))::INTEGER AS red_cards,
    (SUM(COALESCE(pgs.expected_goals, 0))::NUMERIC(10,2)) AS expected_goals,
    (SUM(COALESCE(pgs.expected_assists, 0))::NUMERIC(10,2)) AS expected_assists,
    (SUM(COALESCE(pgs.expected_goal_involvements, 0))::NUMERIC(10,2)) AS expected_goal_involvements,
    (SUM(COALESCE(pgs.expected_goals_conceded, 0))::NUMERIC(10,2)) AS expected_goals_conceded,
    SUM(COALESCE(pgs.goals_conceded, 0))::INTEGER AS goals_conceded,
    COUNT(*)::INTEGER AS games_played
  FROM player_gameweek_stats pgs
  CROSS JOIN current_gw c
  WHERE pgs.gameweek >= 1 AND pgs.gameweek <= c.gw AND pgs.was_home = false
  GROUP BY pgs.player_id
  HAVING SUM(COALESCE(pgs.minutes, 0)) >= 1
)
SELECT * FROM all_loc
UNION ALL SELECT * FROM home_loc
UNION ALL SELECT * FROM away_loc;

CREATE UNIQUE INDEX idx_mv_research_stats_all_key ON mv_research_player_stats_all (player_id, location);

DROP MATERIALIZED VIEW IF EXISTS mv_research_player_stats_last_6;
CREATE MATERIALIZED VIEW mv_research_player_stats_last_6 AS
WITH current_gw AS (
  SELECT COALESCE((SELECT id FROM gameweeks WHERE is_current = true LIMIT 1), 1) AS gw
),
min_gw AS (
  SELECT gw, GREATEST(1, gw - 5) AS min_gw FROM current_gw
),
all_loc AS (
  SELECT
    pgs.player_id,
    'all'::TEXT AS location,
    SUM(COALESCE(pgs.minutes, 0))::INTEGER AS minutes,
    SUM(CASE WHEN pgs.bonus_status = 'confirmed' OR COALESCE(pgs.bonus, 0) > 0 THEN pgs.total_points ELSE pgs.total_points + COALESCE(pgs.provisional_bonus, 0) END)::INTEGER AS effective_total_points,
    SUM(COALESCE(pgs.goals_scored, 0))::INTEGER AS goals_scored,
    SUM(COALESCE(pgs.assists, 0))::INTEGER AS assists,
    SUM(COALESCE(pgs.clean_sheets, 0))::INTEGER AS clean_sheets,
    SUM(COALESCE(pgs.saves, 0))::INTEGER AS saves,
    SUM(COALESCE(pgs.bps, 0))::INTEGER AS bps,
    SUM(COALESCE(pgs.defensive_contribution, 0))::INTEGER AS defensive_contribution,
    SUM(COALESCE(pgs.yellow_cards, 0))::INTEGER AS yellow_cards,
    SUM(COALESCE(pgs.red_cards, 0))::INTEGER AS red_cards,
    (SUM(COALESCE(pgs.expected_goals, 0))::NUMERIC(10,2)) AS expected_goals,
    (SUM(COALESCE(pgs.expected_assists, 0))::NUMERIC(10,2)) AS expected_assists,
    (SUM(COALESCE(pgs.expected_goal_involvements, 0))::NUMERIC(10,2)) AS expected_goal_involvements,
    (SUM(COALESCE(pgs.expected_goals_conceded, 0))::NUMERIC(10,2)) AS expected_goals_conceded,
    SUM(COALESCE(pgs.goals_conceded, 0))::INTEGER AS goals_conceded,
    COUNT(*)::INTEGER AS games_played
  FROM player_gameweek_stats pgs
  CROSS JOIN min_gw m
  WHERE pgs.gameweek >= m.min_gw AND pgs.gameweek <= m.gw
  GROUP BY pgs.player_id
  HAVING SUM(COALESCE(pgs.minutes, 0)) >= 1
),
home_loc AS (
  SELECT
    pgs.player_id,
    'home'::TEXT AS location,
    SUM(COALESCE(pgs.minutes, 0))::INTEGER AS minutes,
    SUM(CASE WHEN pgs.bonus_status = 'confirmed' OR COALESCE(pgs.bonus, 0) > 0 THEN pgs.total_points ELSE pgs.total_points + COALESCE(pgs.provisional_bonus, 0) END)::INTEGER AS effective_total_points,
    SUM(COALESCE(pgs.goals_scored, 0))::INTEGER AS goals_scored,
    SUM(COALESCE(pgs.assists, 0))::INTEGER AS assists,
    SUM(COALESCE(pgs.clean_sheets, 0))::INTEGER AS clean_sheets,
    SUM(COALESCE(pgs.saves, 0))::INTEGER AS saves,
    SUM(COALESCE(pgs.bps, 0))::INTEGER AS bps,
    SUM(COALESCE(pgs.defensive_contribution, 0))::INTEGER AS defensive_contribution,
    SUM(COALESCE(pgs.yellow_cards, 0))::INTEGER AS yellow_cards,
    SUM(COALESCE(pgs.red_cards, 0))::INTEGER AS red_cards,
    (SUM(COALESCE(pgs.expected_goals, 0))::NUMERIC(10,2)) AS expected_goals,
    (SUM(COALESCE(pgs.expected_assists, 0))::NUMERIC(10,2)) AS expected_assists,
    (SUM(COALESCE(pgs.expected_goal_involvements, 0))::NUMERIC(10,2)) AS expected_goal_involvements,
    (SUM(COALESCE(pgs.expected_goals_conceded, 0))::NUMERIC(10,2)) AS expected_goals_conceded,
    SUM(COALESCE(pgs.goals_conceded, 0))::INTEGER AS goals_conceded,
    COUNT(*)::INTEGER AS games_played
  FROM player_gameweek_stats pgs
  CROSS JOIN min_gw m
  WHERE pgs.gameweek >= m.min_gw AND pgs.gameweek <= m.gw AND pgs.was_home = true
  GROUP BY pgs.player_id
  HAVING SUM(COALESCE(pgs.minutes, 0)) >= 1
),
away_loc AS (
  SELECT
    pgs.player_id,
    'away'::TEXT AS location,
    SUM(COALESCE(pgs.minutes, 0))::INTEGER AS minutes,
    SUM(CASE WHEN pgs.bonus_status = 'confirmed' OR COALESCE(pgs.bonus, 0) > 0 THEN pgs.total_points ELSE pgs.total_points + COALESCE(pgs.provisional_bonus, 0) END)::INTEGER AS effective_total_points,
    SUM(COALESCE(pgs.goals_scored, 0))::INTEGER AS goals_scored,
    SUM(COALESCE(pgs.assists, 0))::INTEGER AS assists,
    SUM(COALESCE(pgs.clean_sheets, 0))::INTEGER AS clean_sheets,
    SUM(COALESCE(pgs.saves, 0))::INTEGER AS saves,
    SUM(COALESCE(pgs.bps, 0))::INTEGER AS bps,
    SUM(COALESCE(pgs.defensive_contribution, 0))::INTEGER AS defensive_contribution,
    SUM(COALESCE(pgs.yellow_cards, 0))::INTEGER AS yellow_cards,
    SUM(COALESCE(pgs.red_cards, 0))::INTEGER AS red_cards,
    (SUM(COALESCE(pgs.expected_goals, 0))::NUMERIC(10,2)) AS expected_goals,
    (SUM(COALESCE(pgs.expected_assists, 0))::NUMERIC(10,2)) AS expected_assists,
    (SUM(COALESCE(pgs.expected_goal_involvements, 0))::NUMERIC(10,2)) AS expected_goal_involvements,
    (SUM(COALESCE(pgs.expected_goals_conceded, 0))::NUMERIC(10,2)) AS expected_goals_conceded,
    SUM(COALESCE(pgs.goals_conceded, 0))::INTEGER AS goals_conceded,
    COUNT(*)::INTEGER AS games_played
  FROM player_gameweek_stats pgs
  CROSS JOIN min_gw m
  WHERE pgs.gameweek >= m.min_gw AND pgs.gameweek <= m.gw AND pgs.was_home = false
  GROUP BY pgs.player_id
  HAVING SUM(COALESCE(pgs.minutes, 0)) >= 1
)
SELECT * FROM all_loc
UNION ALL SELECT * FROM home_loc
UNION ALL SELECT * FROM away_loc;

CREATE UNIQUE INDEX idx_mv_research_stats_last_6_key ON mv_research_player_stats_last_6 (player_id, location);

DROP MATERIALIZED VIEW IF EXISTS mv_research_player_stats_last_12;
CREATE MATERIALIZED VIEW mv_research_player_stats_last_12 AS
WITH current_gw AS (
  SELECT COALESCE((SELECT id FROM gameweeks WHERE is_current = true LIMIT 1), 1) AS gw
),
min_gw AS (
  SELECT gw, GREATEST(1, gw - 11) AS min_gw FROM current_gw
),
all_loc AS (
  SELECT
    pgs.player_id,
    'all'::TEXT AS location,
    SUM(COALESCE(pgs.minutes, 0))::INTEGER AS minutes,
    SUM(CASE WHEN pgs.bonus_status = 'confirmed' OR COALESCE(pgs.bonus, 0) > 0 THEN pgs.total_points ELSE pgs.total_points + COALESCE(pgs.provisional_bonus, 0) END)::INTEGER AS effective_total_points,
    SUM(COALESCE(pgs.goals_scored, 0))::INTEGER AS goals_scored,
    SUM(COALESCE(pgs.assists, 0))::INTEGER AS assists,
    SUM(COALESCE(pgs.clean_sheets, 0))::INTEGER AS clean_sheets,
    SUM(COALESCE(pgs.saves, 0))::INTEGER AS saves,
    SUM(COALESCE(pgs.bps, 0))::INTEGER AS bps,
    SUM(COALESCE(pgs.defensive_contribution, 0))::INTEGER AS defensive_contribution,
    SUM(COALESCE(pgs.yellow_cards, 0))::INTEGER AS yellow_cards,
    SUM(COALESCE(pgs.red_cards, 0))::INTEGER AS red_cards,
    (SUM(COALESCE(pgs.expected_goals, 0))::NUMERIC(10,2)) AS expected_goals,
    (SUM(COALESCE(pgs.expected_assists, 0))::NUMERIC(10,2)) AS expected_assists,
    (SUM(COALESCE(pgs.expected_goal_involvements, 0))::NUMERIC(10,2)) AS expected_goal_involvements,
    (SUM(COALESCE(pgs.expected_goals_conceded, 0))::NUMERIC(10,2)) AS expected_goals_conceded,
    SUM(COALESCE(pgs.goals_conceded, 0))::INTEGER AS goals_conceded,
    COUNT(*)::INTEGER AS games_played
  FROM player_gameweek_stats pgs
  CROSS JOIN min_gw m
  WHERE pgs.gameweek >= m.min_gw AND pgs.gameweek <= m.gw
  GROUP BY pgs.player_id
  HAVING SUM(COALESCE(pgs.minutes, 0)) >= 1
),
home_loc AS (
  SELECT
    pgs.player_id,
    'home'::TEXT AS location,
    SUM(COALESCE(pgs.minutes, 0))::INTEGER AS minutes,
    SUM(CASE WHEN pgs.bonus_status = 'confirmed' OR COALESCE(pgs.bonus, 0) > 0 THEN pgs.total_points ELSE pgs.total_points + COALESCE(pgs.provisional_bonus, 0) END)::INTEGER AS effective_total_points,
    SUM(COALESCE(pgs.goals_scored, 0))::INTEGER AS goals_scored,
    SUM(COALESCE(pgs.assists, 0))::INTEGER AS assists,
    SUM(COALESCE(pgs.clean_sheets, 0))::INTEGER AS clean_sheets,
    SUM(COALESCE(pgs.saves, 0))::INTEGER AS saves,
    SUM(COALESCE(pgs.bps, 0))::INTEGER AS bps,
    SUM(COALESCE(pgs.defensive_contribution, 0))::INTEGER AS defensive_contribution,
    SUM(COALESCE(pgs.yellow_cards, 0))::INTEGER AS yellow_cards,
    SUM(COALESCE(pgs.red_cards, 0))::INTEGER AS red_cards,
    (SUM(COALESCE(pgs.expected_goals, 0))::NUMERIC(10,2)) AS expected_goals,
    (SUM(COALESCE(pgs.expected_assists, 0))::NUMERIC(10,2)) AS expected_assists,
    (SUM(COALESCE(pgs.expected_goal_involvements, 0))::NUMERIC(10,2)) AS expected_goal_involvements,
    (SUM(COALESCE(pgs.expected_goals_conceded, 0))::NUMERIC(10,2)) AS expected_goals_conceded,
    SUM(COALESCE(pgs.goals_conceded, 0))::INTEGER AS goals_conceded,
    COUNT(*)::INTEGER AS games_played
  FROM player_gameweek_stats pgs
  CROSS JOIN min_gw m
  WHERE pgs.gameweek >= m.min_gw AND pgs.gameweek <= m.gw AND pgs.was_home = true
  GROUP BY pgs.player_id
  HAVING SUM(COALESCE(pgs.minutes, 0)) >= 1
),
away_loc AS (
  SELECT
    pgs.player_id,
    'away'::TEXT AS location,
    SUM(COALESCE(pgs.minutes, 0))::INTEGER AS minutes,
    SUM(CASE WHEN pgs.bonus_status = 'confirmed' OR COALESCE(pgs.bonus, 0) > 0 THEN pgs.total_points ELSE pgs.total_points + COALESCE(pgs.provisional_bonus, 0) END)::INTEGER AS effective_total_points,
    SUM(COALESCE(pgs.goals_scored, 0))::INTEGER AS goals_scored,
    SUM(COALESCE(pgs.assists, 0))::INTEGER AS assists,
    SUM(COALESCE(pgs.clean_sheets, 0))::INTEGER AS clean_sheets,
    SUM(COALESCE(pgs.saves, 0))::INTEGER AS saves,
    SUM(COALESCE(pgs.bps, 0))::INTEGER AS bps,
    SUM(COALESCE(pgs.defensive_contribution, 0))::INTEGER AS defensive_contribution,
    SUM(COALESCE(pgs.yellow_cards, 0))::INTEGER AS yellow_cards,
    SUM(COALESCE(pgs.red_cards, 0))::INTEGER AS red_cards,
    (SUM(COALESCE(pgs.expected_goals, 0))::NUMERIC(10,2)) AS expected_goals,
    (SUM(COALESCE(pgs.expected_assists, 0))::NUMERIC(10,2)) AS expected_assists,
    (SUM(COALESCE(pgs.expected_goal_involvements, 0))::NUMERIC(10,2)) AS expected_goal_involvements,
    (SUM(COALESCE(pgs.expected_goals_conceded, 0))::NUMERIC(10,2)) AS expected_goals_conceded,
    SUM(COALESCE(pgs.goals_conceded, 0))::INTEGER AS goals_conceded,
    COUNT(*)::INTEGER AS games_played
  FROM player_gameweek_stats pgs
  CROSS JOIN min_gw m
  WHERE pgs.gameweek >= m.min_gw AND pgs.gameweek <= m.gw AND pgs.was_home = false
  GROUP BY pgs.player_id
  HAVING SUM(COALESCE(pgs.minutes, 0)) >= 1
)
SELECT * FROM all_loc
UNION ALL SELECT * FROM home_loc
UNION ALL SELECT * FROM away_loc;

CREATE UNIQUE INDEX idx_mv_research_stats_last_12_key ON mv_research_player_stats_last_12 (player_id, location);
