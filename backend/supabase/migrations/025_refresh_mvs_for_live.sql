-- During live matches we refresh MVs less often (every full_refresh_interval_live).
-- Skip mv_manager_gameweek_summary (not used by frontend) to reduce hot-path work.
CREATE OR REPLACE FUNCTION refresh_materialized_views_for_live()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM refresh_mini_league_standings();
  PERFORM refresh_player_gameweek_performance();
  PERFORM refresh_league_transfer_aggregation();
  PERFORM refresh_player_owned_leaderboard();
  PERFORM refresh_manager_player_gameweek_points();
  -- Skip refresh_manager_gameweek_summary(); not used by UI
END;
$$;

COMMENT ON FUNCTION refresh_materialized_views_for_live() IS
'Refresh MVs used by UI during live matches. Skips mv_manager_gameweek_summary.';
