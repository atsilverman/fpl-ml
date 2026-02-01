-- League transfer aggregation is not refreshed during live: transfers are set at deadline only.
-- Skip refresh_league_transfer_aggregation() in refresh_materialized_views_for_live() to reduce hot-path work.
CREATE OR REPLACE FUNCTION refresh_materialized_views_for_live()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM refresh_mini_league_standings();
  PERFORM refresh_player_gameweek_performance();
  -- Skip refresh_league_transfer_aggregation(); not updated during live (set at deadline)
  PERFORM refresh_player_owned_leaderboard();
  PERFORM refresh_manager_player_gameweek_points();
  -- Skip refresh_manager_gameweek_summary(); not used by UI
END;
$$;

COMMENT ON FUNCTION refresh_materialized_views_for_live() IS
'Refresh MVs used by UI during live matches. Skips mv_manager_gameweek_summary and mv_league_transfer_aggregation (deadline-only).';
