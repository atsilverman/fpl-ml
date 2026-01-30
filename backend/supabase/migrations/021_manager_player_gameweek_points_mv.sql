-- Manager Player Gameweek Points: per-GW points from starting XI (for Gantt gradient, etc.)
-- Same logic as v_player_owned_leaderboard but one row per (manager_id, player_id, gameweek).
-- Use materialized view so "All" filter can read pointsByGameweek in one query.

CREATE OR REPLACE VIEW v_manager_player_gameweek_points AS
SELECT
  mp.manager_id,
  CASE
    WHEN mp.was_auto_subbed_in AND mp.auto_sub_replaced_player_id IS NOT NULL
      THEN mp.auto_sub_replaced_player_id
    ELSE mp.player_id
  END AS player_id,
  mp.gameweek,
  (COALESCE(
    CASE
      WHEN mp.was_auto_subbed_in AND mp.auto_sub_replaced_player_id IS NOT NULL THEN
        (SELECT total_points FROM player_gameweek_stats
         WHERE player_id = mp.auto_sub_replaced_player_id
         AND gameweek = mp.gameweek)
      ELSE pgs.total_points
    END,
    0
  ) * COALESCE(mp.multiplier, 1))::INTEGER AS points
FROM manager_picks mp
LEFT JOIN player_gameweek_stats pgs
  ON mp.player_id = pgs.player_id
  AND mp.gameweek = pgs.gameweek
WHERE mp.position <= 11;

COMMENT ON VIEW v_manager_player_gameweek_points IS
'Per-gameweek points from starting XI only (auto-subs and captain multiplier applied).
Used by frontend to build pointsByGameweek for Gantt gradient without extra joins.';

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_manager_player_gameweek_points AS
SELECT * FROM v_manager_player_gameweek_points;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_mpgp_unique
ON mv_manager_player_gameweek_points(manager_id, player_id, gameweek);

CREATE INDEX IF NOT EXISTS idx_mv_mpgp_manager
ON mv_manager_player_gameweek_points(manager_id);

COMMENT ON MATERIALIZED VIEW mv_manager_player_gameweek_points IS
'Materialized view of manager player gameweek points. Refresh via refresh_manager_player_gameweek_points().';

-- Refresh function (required for REFRESH MATERIALIZED VIEW CONCURRENTLY)
CREATE OR REPLACE FUNCTION refresh_manager_player_gameweek_points()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_manager_player_gameweek_points;
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
END;
$$;
