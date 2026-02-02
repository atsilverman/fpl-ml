-- Last H2H fixture + player stats per (current GW scheduled fixture).
-- For scheduled fixtures in second half (GW >= 20), precompute the reverse fixture and its player_gameweek_stats.
-- Refresh at start of gameweek (or with refresh_all_materialized_views) so Matches page (H2H toggle on) can read in one go.

DROP MATERIALIZED VIEW IF EXISTS mv_last_h2h_player_stats;

CREATE MATERIALIZED VIEW mv_last_h2h_player_stats AS
WITH current_gw AS (
  SELECT id AS gw FROM gameweeks WHERE is_current = true LIMIT 1
),
current_scheduled AS (
  SELECT f.fpl_fixture_id, f.gameweek, f.home_team_id, f.away_team_id
  FROM fixtures f
  JOIN current_gw c ON f.gameweek = c.gw
  WHERE f.started = false
    AND f.gameweek >= 20
),
ranked_reverse AS (
  SELECT
    f.fpl_fixture_id AS reverse_fixture_id,
    f.gameweek      AS reverse_gameweek,
    f.home_team_id  AS reverse_home_team_id,
    f.away_team_id  AS reverse_away_team_id,
    f.home_score    AS reverse_home_score,
    f.away_score    AS reverse_away_score,
    LEAST(f.home_team_id, f.away_team_id)   AS pair_a,
    GREATEST(f.home_team_id, f.away_team_id) AS pair_b,
    ROW_NUMBER() OVER (
      PARTITION BY LEAST(f.home_team_id, f.away_team_id), GREATEST(f.home_team_id, f.away_team_id)
      ORDER BY f.gameweek DESC
    ) AS rn
  FROM fixtures f
  JOIN current_scheduled s ON (
    (f.home_team_id = s.home_team_id AND f.away_team_id = s.away_team_id)
    OR (f.home_team_id = s.away_team_id AND f.away_team_id = s.home_team_id)
  )
  WHERE f.finished = true
    AND f.gameweek < (SELECT gw FROM current_gw)
),
last_h2h AS (
  SELECT reverse_fixture_id, reverse_gameweek, reverse_home_team_id, reverse_away_team_id,
         reverse_home_score, reverse_away_score, pair_a, pair_b
  FROM ranked_reverse
  WHERE rn = 1
),
scheduled_with_reverse AS (
  SELECT s.fpl_fixture_id, s.gameweek, s.home_team_id, s.away_team_id,
         h.reverse_fixture_id, h.reverse_gameweek, h.reverse_home_team_id, h.reverse_away_team_id,
         h.reverse_home_score, h.reverse_away_score
  FROM current_scheduled s
  JOIN last_h2h h ON LEAST(s.home_team_id, s.away_team_id) = h.pair_a
                 AND GREATEST(s.home_team_id, s.away_team_id) = h.pair_b
)
SELECT
  s.fpl_fixture_id,
  s.gameweek,
  s.home_team_id,
  s.away_team_id,
  s.reverse_fixture_id,
  s.reverse_gameweek,
  s.reverse_home_team_id,
  s.reverse_away_team_id,
  s.reverse_home_score,
  s.reverse_away_score,
  pgs.player_id,
  pgs.team_id,
  pgs.minutes,
  pgs.total_points,
  pgs.goals_scored,
  pgs.assists,
  pgs.clean_sheets,
  pgs.saves,
  pgs.bps,
  pgs.bonus,
  pgs.defensive_contribution,
  pgs.yellow_cards,
  pgs.red_cards,
  pgs.expected_goals,
  pgs.expected_assists,
  pgs.expected_goal_involvements,
  pgs.expected_goals_conceded
FROM scheduled_with_reverse s
JOIN player_gameweek_stats pgs
  ON pgs.fixture_id = s.reverse_fixture_id AND pgs.gameweek = s.reverse_gameweek;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_last_h2h_player_stats_key
  ON mv_last_h2h_player_stats (fpl_fixture_id, gameweek, player_id);

COMMENT ON MATERIALIZED VIEW mv_last_h2h_player_stats IS
'Last H2H fixture + player stats per (current GW scheduled fixture). Refresh at start of gameweek. Used when H2H toggle is on.';

CREATE OR REPLACE FUNCTION refresh_last_h2h_player_stats()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_last_h2h_player_stats;
END;
$$;

-- Add to global refresh so it runs with other MVs (e.g. at start of gameweek / idle)
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
END;
$$;
