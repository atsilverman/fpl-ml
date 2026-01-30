-- Functions for refreshing materialized views

-- Function to refresh mini league standings
CREATE OR REPLACE FUNCTION refresh_mini_league_standings()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_mini_league_standings;
END;
$$;

-- Function to refresh manager gameweek summary
CREATE OR REPLACE FUNCTION refresh_manager_gameweek_summary()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_manager_gameweek_summary;
END;
$$;

-- Function to refresh player gameweek performance
CREATE OR REPLACE FUNCTION refresh_player_gameweek_performance()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_player_gameweek_performance;
END;
$$;

-- Function to refresh league transfer aggregation
CREATE OR REPLACE FUNCTION refresh_league_transfer_aggregation()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_league_transfer_aggregation;
END;
$$;

-- Function to refresh player owned leaderboard
CREATE OR REPLACE FUNCTION refresh_player_owned_leaderboard()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_player_owned_leaderboard;
END;
$$;

-- Function to refresh all materialized views
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
END;
$$;
