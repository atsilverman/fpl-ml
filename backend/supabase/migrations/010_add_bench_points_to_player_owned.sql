-- Add Bench Points to Player Owned Leaderboard
-- Extends v_player_owned_leaderboard to include bench points calculation
-- Bench points are calculated separately (no multipliers, no captain bonuses)

-- Create view that includes bench points
CREATE OR REPLACE VIEW v_player_owned_leaderboard_with_bench AS
WITH bench_points AS (
  SELECT 
    mp.manager_id,
    mp.player_id,
    SUM(COALESCE(pgs.total_points, 0)) as bench_points_total,
    COUNT(DISTINCT mp.gameweek) as bench_gameweeks
  FROM manager_picks mp
  LEFT JOIN player_gameweek_stats pgs 
    ON mp.player_id = pgs.player_id 
    AND mp.gameweek = pgs.gameweek
  WHERE mp.position > 11  -- Bench only (positions 12-15)
  GROUP BY mp.manager_id, mp.player_id
)
-- Join with existing starting points view
SELECT 
  pol.manager_id,
  pol.manager_name,
  pol.player_id,
  pol.player_name,
  pol.player_position,
  pol.total_points,
  COALESCE(bp.bench_points_total, 0) as bench_points,
  pol.gameweeks_owned,
  COALESCE(bp.bench_gameweeks, 0) as bench_gameweeks,
  pol.gameweeks_array,
  pol.ownership_periods,
  pol.average_points_per_gw,
  pol.captain_weeks,
  pol.first_owned_gw,
  pol.last_owned_gw
FROM v_player_owned_leaderboard pol
LEFT JOIN bench_points bp 
  ON pol.manager_id = bp.manager_id 
  AND pol.player_id = bp.player_id;

COMMENT ON VIEW v_player_owned_leaderboard_with_bench IS 
'Player-Owned Leaderboard with Bench Points: Extends v_player_owned_leaderboard to include bench points.
- total_points: Cumulative points from starting positions only (with multipliers)
- bench_points: Cumulative points from bench positions only (no multipliers)
- Bench points are calculated separately and do not include captain bonuses or multipliers';
