-- Research stats MVs: pre-aggregated player stats per (player_id, location) for All / Last 6 / Last 12
-- so the Stats subpage can fetch one small payload per filter instead of paginating raw fixture rows.
-- Refresh with refresh_all_materialized_views(). Only players with at least 1 minute in range are included.

-- 1) All gameweeks (GW 1 to current)
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
    (SUM(COALESCE(pgs.expected_goals_conceded, 0))::NUMERIC(10,2)) AS expected_goals_conceded
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
    (SUM(COALESCE(pgs.expected_goals_conceded, 0))::NUMERIC(10,2)) AS expected_goals_conceded
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
    (SUM(COALESCE(pgs.expected_goals_conceded, 0))::NUMERIC(10,2)) AS expected_goals_conceded
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
COMMENT ON MATERIALIZED VIEW mv_research_player_stats_all IS 'Research stats: one row per (player, location) for GW 1 to current. Minutes >= 1. Refresh via refresh_research_player_stats_all().';

-- 2) Last 6 gameweeks
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
    (SUM(COALESCE(pgs.expected_goals_conceded, 0))::NUMERIC(10,2)) AS expected_goals_conceded
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
    (SUM(COALESCE(pgs.expected_goals_conceded, 0))::NUMERIC(10,2)) AS expected_goals_conceded
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
    (SUM(COALESCE(pgs.expected_goals_conceded, 0))::NUMERIC(10,2)) AS expected_goals_conceded
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
COMMENT ON MATERIALIZED VIEW mv_research_player_stats_last_6 IS 'Research stats: last 6 gameweeks. One row per (player, location). Refresh via refresh_research_player_stats_last_6().';

-- 3) Last 12 gameweeks
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
    (SUM(COALESCE(pgs.expected_goals_conceded, 0))::NUMERIC(10,2)) AS expected_goals_conceded
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
    (SUM(COALESCE(pgs.expected_goals_conceded, 0))::NUMERIC(10,2)) AS expected_goals_conceded
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
    (SUM(COALESCE(pgs.expected_goals_conceded, 0))::NUMERIC(10,2)) AS expected_goals_conceded
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
COMMENT ON MATERIALIZED VIEW mv_research_player_stats_last_12 IS 'Research stats: last 12 gameweeks. One row per (player, location). Refresh via refresh_research_player_stats_last_12().';

-- Refresh functions (for CONCURRENTLY)
CREATE OR REPLACE FUNCTION refresh_research_player_stats_all()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_research_player_stats_all;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_research_player_stats_last_6()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_research_player_stats_last_6;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_research_player_stats_last_12()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_research_player_stats_last_12;
END;
$$;

-- Add to global refresh
CREATE OR REPLACE FUNCTION refresh_all_materialized_views()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM refresh_mini_league_standings();
  PERFORM refresh_manager_gameweek_summary();
  PERFORM refresh_player_gameweek_performance();
  PERFORM refresh_league_transfer_aggregation();
  PERFORM refresh_player_owned_leaderboard();
  PERFORM refresh_manager_player_gameweek_points();
  PERFORM refresh_last_h2h_player_stats();
  PERFORM refresh_research_player_stats_all();
  PERFORM refresh_research_player_stats_last_6();
  PERFORM refresh_research_player_stats_last_12();
END;
$$;
