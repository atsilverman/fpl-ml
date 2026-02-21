-- Master MV: one row per (player_id, gameweek, fixture_id) with denormalized team and fixture
-- so backend can serve stats + fixtures in one place; UI filters client-side.
-- Refresh with refresh_all_materialized_views(). fixture_id = 0 rows have null fixture metadata.

DROP MATERIALIZED VIEW IF EXISTS mv_master_player_fixture_stats;
CREATE MATERIALIZED VIEW mv_master_player_fixture_stats AS
SELECT
  pgs.player_id,
  p.web_name AS player_web_name,
  p.position AS player_position,
  pgs.gameweek,
  pgs.fixture_id,
  pgs.team_id,
  t.short_name AS team_short_name,
  pgs.opponent_team_id,
  ot.short_name AS opponent_team_short_name,
  pgs.was_home,
  f.kickoff_time,
  f.deadline_time,
  f.home_team_id,
  f.away_team_id,
  ht.short_name AS home_team_short_name,
  at.short_name AS away_team_short_name,
  f.home_score,
  f.away_score,
  f.started,
  f.finished,
  f.finished_provisional,
  f.minutes AS fixture_minutes,
  pgs.minutes,
  (CASE WHEN pgs.bonus_status = 'confirmed' OR COALESCE(pgs.bonus, 0) > 0 THEN pgs.total_points ELSE pgs.total_points + COALESCE(pgs.provisional_bonus, 0) END)::INTEGER AS effective_total_points,
  COALESCE(pgs.goals_scored, 0)::INTEGER AS goals_scored,
  COALESCE(pgs.assists, 0)::INTEGER AS assists,
  COALESCE(pgs.clean_sheets, 0)::INTEGER AS clean_sheets,
  COALESCE(pgs.saves, 0)::INTEGER AS saves,
  COALESCE(pgs.bps, 0)::INTEGER AS bps,
  COALESCE(pgs.defensive_contribution, 0)::INTEGER AS defensive_contribution,
  COALESCE(pgs.yellow_cards, 0)::INTEGER AS yellow_cards,
  COALESCE(pgs.red_cards, 0)::INTEGER AS red_cards,
  (COALESCE(pgs.expected_goals, 0))::NUMERIC(10,2) AS expected_goals,
  (COALESCE(pgs.expected_assists, 0))::NUMERIC(10,2) AS expected_assists,
  (COALESCE(pgs.expected_goal_involvements, 0))::NUMERIC(10,2) AS expected_goal_involvements,
  (COALESCE(pgs.expected_goals_conceded, 0))::NUMERIC(10,2) AS expected_goals_conceded,
  COALESCE(pgs.goals_conceded, 0)::INTEGER AS goals_conceded
FROM player_gameweek_stats pgs
JOIN players p ON p.fpl_player_id = pgs.player_id
JOIN teams t ON t.team_id = pgs.team_id
LEFT JOIN teams ot ON ot.team_id = pgs.opponent_team_id
LEFT JOIN fixtures f ON f.fpl_fixture_id = pgs.fixture_id AND pgs.fixture_id != 0
LEFT JOIN teams ht ON ht.team_id = f.home_team_id
LEFT JOIN teams at ON at.team_id = f.away_team_id;

CREATE UNIQUE INDEX idx_mv_master_player_fixture_stats_key ON mv_master_player_fixture_stats (player_id, gameweek, fixture_id);
COMMENT ON MATERIALIZED VIEW mv_master_player_fixture_stats IS 'One row per (player, gameweek, fixture) with team and fixture denormalized. Backend serves stats/fixtures from here; UI filters. Refresh via refresh_master_player_fixture_stats().';

CREATE OR REPLACE FUNCTION refresh_master_player_fixture_stats()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_master_player_fixture_stats;
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
  PERFORM refresh_master_player_fixture_stats();
END;
$$;
