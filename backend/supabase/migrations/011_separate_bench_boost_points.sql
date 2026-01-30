-- Remove Bench Points - Focus Only on Starting Position Points
-- Simplifies v_player_owned_leaderboard_with_bench to only show points contributing to total points
-- Removes bench points tracking and display entirely

-- Drop existing view first (required when changing column structure)
DROP VIEW IF EXISTS v_player_owned_leaderboard_with_bench CASCADE;

-- Recreate view to only show starting position points (no bench points)
CREATE VIEW v_player_owned_leaderboard_with_bench AS
WITH manager_totals AS (
  -- Get manager total points for percentage calculation
  SELECT 
    manager_id,
    total_points as manager_total_points
  FROM manager_gameweek_history
  WHERE (manager_id, gameweek) IN (
    SELECT manager_id, MAX(gameweek)
    FROM manager_gameweek_history
    GROUP BY manager_id
  )
)
-- Use base view with team information - only starting position points
SELECT 
  pol.manager_id,
  pol.manager_name,
  pol.player_id,
  pol.player_name,
  pol.player_position,
  pol.total_points,
  pol.gameweeks_owned,
  pol.gameweeks_array,
  pol.ownership_periods,
  pol.average_points_per_gw,
  pol.captain_weeks,
  pol.first_owned_gw,
  pol.last_owned_gw,
  -- Team information for badge display
  p.team_id,
  t.short_name as team_short_name,
  -- Calculate percentage of manager total points
  ROUND(
    (pol.total_points::NUMERIC / 
     NULLIF(COALESCE(mt.manager_total_points, 0), 0)) * 100,
    2
  ) as percentage_of_total_points
FROM v_player_owned_leaderboard pol
LEFT JOIN players p ON pol.player_id = p.fpl_player_id
LEFT JOIN teams t ON p.team_id = t.team_id
LEFT JOIN manager_totals mt
  ON pol.manager_id = mt.manager_id;

COMMENT ON VIEW v_player_owned_leaderboard_with_bench IS 
'Player-Owned Leaderboard: Shows only points from starting positions that contribute to total points.
- total_points: Cumulative points from starting positions only (with multipliers, auto-subs)
- No bench points included (bench points do not contribute to manager total)
- percentage_of_total_points: Percentage contribution of this player to manager total points';

-- Validation function to check data integrity
CREATE OR REPLACE FUNCTION validate_player_points_integrity(manager_id_param BIGINT)
RETURNS TABLE(
  manager_id BIGINT,
  manager_total_points INTEGER,
  sum_player_starting_points INTEGER,
  sum_player_bench_points INTEGER,
  sum_player_bench_boost_points INTEGER,
  transfer_costs INTEGER,
  calculated_total INTEGER,
  difference INTEGER,
  is_valid BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  WITH manager_total AS (
    SELECT total_points, transfer_cost
    FROM manager_gameweek_history
    WHERE manager_id = manager_id_param
    ORDER BY gameweek DESC
    LIMIT 1
  ),
  player_points_sum AS (
    SELECT 
      SUM(total_points) as starting_points
    FROM v_player_owned_leaderboard_with_bench
    WHERE manager_id = manager_id_param
  )
  SELECT 
    manager_id_param,
    mt.total_points,
    COALESCE(pp.starting_points, 0),
    0 as sum_player_bench_points,
    0 as sum_player_bench_boost_points,
    COALESCE(mt.transfer_cost, 0),
    COALESCE(pp.starting_points, 0) + COALESCE(mt.transfer_cost, 0) as calculated_total,
    mt.total_points - (COALESCE(pp.starting_points, 0) + COALESCE(mt.transfer_cost, 0)) as difference,
    (mt.total_points - (COALESCE(pp.starting_points, 0) + COALESCE(mt.transfer_cost, 0))) = 0 as is_valid
  FROM manager_total mt
  CROSS JOIN player_points_sum pp;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION validate_player_points_integrity IS 
'Validates that manager total points equals sum of player starting points plus transfer costs.
Only starting position points are included (bench points do not contribute to manager total).
Returns validation result with difference and is_valid flag.';

-- View to check all managers' point integrity
CREATE OR REPLACE VIEW v_manager_points_validation AS
SELECT 
  m.manager_id,
  m.manager_name,
  mgh.total_points as manager_total_points,
  COALESCE(SUM(pol.total_points), 0) as sum_player_starting_points,
  0 as sum_player_bench_points,
  0 as sum_player_bench_boost_points,
  COALESCE(mgh.transfer_cost, 0) as transfer_costs,
  (COALESCE(SUM(pol.total_points), 0) + COALESCE(mgh.transfer_cost, 0)) as calculated_total,
  (mgh.total_points - (COALESCE(SUM(pol.total_points), 0) + COALESCE(mgh.transfer_cost, 0))) as difference,
  (mgh.total_points - (COALESCE(SUM(pol.total_points), 0) + COALESCE(mgh.transfer_cost, 0))) = 0 as is_valid
FROM managers m
LEFT JOIN (
  SELECT manager_id, total_points, transfer_cost
  FROM manager_gameweek_history
  WHERE (manager_id, gameweek) IN (
    SELECT manager_id, MAX(gameweek)
    FROM manager_gameweek_history
    GROUP BY manager_id
  )
) mgh ON m.manager_id = mgh.manager_id
LEFT JOIN v_player_owned_leaderboard_with_bench pol ON m.manager_id = pol.manager_id
GROUP BY m.manager_id, m.manager_name, mgh.total_points, mgh.transfer_cost;

COMMENT ON VIEW v_manager_points_validation IS 
'Validation view for all managers showing point integrity checks.
- is_valid: true if manager_total_points = sum_player_starting_points + transfer_costs
- Only starting position points are included (bench points do not contribute to manager total)';
