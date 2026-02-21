-- Add goals_conceded to research MVs (player-level SUM) and RPC for deduped team goals conceded.
-- Team goals conceded must use MAX per (team, gameweek, fixture) then SUM to avoid inflating
-- when aggregating from player-level (defenders + GK share the same GC per fixture).

-- 1) mv_research_player_stats_all: add goals_conceded
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
    SUM(COALESCE(pgs.goals_conceded, 0))::INTEGER AS goals_conceded
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
    SUM(COALESCE(pgs.goals_conceded, 0))::INTEGER AS goals_conceded
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
    SUM(COALESCE(pgs.goals_conceded, 0))::INTEGER AS goals_conceded
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

-- 2) mv_research_player_stats_last_6: add goals_conceded
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
    SUM(COALESCE(pgs.goals_conceded, 0))::INTEGER AS goals_conceded
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
    SUM(COALESCE(pgs.goals_conceded, 0))::INTEGER AS goals_conceded
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
    SUM(COALESCE(pgs.goals_conceded, 0))::INTEGER AS goals_conceded
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

-- 3) mv_research_player_stats_last_12: add goals_conceded
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
    SUM(COALESCE(pgs.goals_conceded, 0))::INTEGER AS goals_conceded
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
    SUM(COALESCE(pgs.goals_conceded, 0))::INTEGER AS goals_conceded
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
    SUM(COALESCE(pgs.goals_conceded, 0))::INTEGER AS goals_conceded
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

-- RPC: deduped team goals conceded for (gw_filter, location). Same gameweek/location logic as research MVs.
-- Uses MAX(goals_conceded) per (team_id, gameweek, fixture_id) then SUM so we do not inflate.
CREATE OR REPLACE FUNCTION get_team_goals_conceded_bulk(p_gw_filter TEXT, p_location TEXT)
RETURNS TABLE(team_id INT, goals_conceded INT)
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
  WITH team_fixture_gc AS (
    SELECT
      pgs.team_id,
      pgs.gameweek,
      pgs.fixture_id,
      MAX(COALESCE(pgs.goals_conceded, 0))::INTEGER AS gc
    FROM player_gameweek_stats pgs
    WHERE pgs.team_id IS NOT NULL
      AND pgs.gameweek >= v_min_gw
      AND pgs.gameweek <= v_current_gw
      AND (p_location = 'all' OR (p_location = 'home' AND pgs.was_home = true) OR (p_location = 'away' AND pgs.was_home = false))
    GROUP BY pgs.team_id, pgs.gameweek, pgs.fixture_id
  )
  SELECT
    tf.team_id::INT,
    COALESCE(SUM(tf.gc), 0)::INTEGER AS goals_conceded
  FROM team_fixture_gc tf
  GROUP BY tf.team_id;
END;
$$;

COMMENT ON FUNCTION get_team_goals_conceded_bulk(TEXT, TEXT) IS 'Deduped team goals conceded for stats API: MAX per (team, gameweek, fixture) then SUM. gw_filter: all|last6|last12, location: all|home|away.';
