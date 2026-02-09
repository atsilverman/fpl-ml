-- Function: get_player_season_ranks(p_player_id, p_gameweek)
-- Returns overall_rank and position_rank (by total points up to that gameweek).
-- Used by player detail modal. Handles DGW by summing total_points per player per gameweek then summing.

CREATE OR REPLACE FUNCTION get_player_season_ranks(p_player_id INTEGER, p_gameweek INTEGER)
RETURNS TABLE(overall_rank BIGINT, position_rank BIGINT)
LANGUAGE sql
STABLE
AS $$
  WITH gw_totals AS (
    SELECT player_id, gameweek, SUM(total_points) AS gw_pts
    FROM player_gameweek_stats
    WHERE gameweek <= p_gameweek
    GROUP BY player_id, gameweek
  ),
  season_totals AS (
    SELECT player_id, SUM(gw_pts) AS pts
    FROM gw_totals
    GROUP BY player_id
  ),
  with_position AS (
    SELECT st.player_id, st.pts, p.position
    FROM season_totals st
    JOIN players p ON p.fpl_player_id = st.player_id
  ),
  player_row AS (
    SELECT pts, position FROM with_position WHERE player_id = p_player_id LIMIT 1
  )
  SELECT
    CASE WHEN (SELECT pts FROM player_row) IS NOT NULL
      THEN (SELECT COUNT(*)::BIGINT + 1 FROM with_position w WHERE w.pts > (SELECT pts FROM player_row))
      ELSE NULL::BIGINT END AS overall_rank,
    CASE WHEN (SELECT pts FROM player_row) IS NOT NULL
      THEN (SELECT COUNT(*)::BIGINT + 1 FROM with_position w
            WHERE w.position = (SELECT position FROM player_row) AND w.pts > (SELECT pts FROM player_row))
      ELSE NULL::BIGINT END AS position_rank;
$$;

COMMENT ON FUNCTION get_player_season_ranks(INTEGER, INTEGER) IS
'Returns overall_rank and position_rank for a player by season points up to p_gameweek. Used by player detail modal.';
