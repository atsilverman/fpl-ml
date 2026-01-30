-- Example queries for Player-Owned Leaderboard
-- Uses existing tables: manager_picks, player_gameweek_stats, players, managers
-- No redundant storage - computed on-demand from existing data

-- ============================================================================
-- Query 1: Get full leaderboard for a manager (sorted by total points)
-- ============================================================================
SELECT 
  player_name,
  total_points,
  ownership_periods,
  gameweeks_owned,
  average_points_per_gw,
  captain_weeks,
  player_position
FROM v_player_owned_leaderboard
WHERE manager_id = 344182
ORDER BY total_points DESC;

-- ============================================================================
-- Query 2: Get top 10 players for a manager
-- ============================================================================
SELECT 
  ROW_NUMBER() OVER (ORDER BY total_points DESC) as rank,
  player_name,
  total_points,
  ownership_periods,
  average_points_per_gw
FROM v_player_owned_leaderboard
WHERE manager_id = 344182
ORDER BY total_points DESC
LIMIT 10;

-- ============================================================================
-- Query 3: Get players by position for a manager
-- ============================================================================
SELECT 
  player_name,
  total_points,
  ownership_periods,
  gameweeks_owned
FROM v_player_owned_leaderboard
WHERE manager_id = 344182
  AND player_position = 3  -- 1=GK, 2=DEF, 3=MID, 4=FWD
ORDER BY total_points DESC;

-- ============================================================================
-- Query 4: Get players with multiple ownership periods
-- ============================================================================
SELECT 
  player_name,
  total_points,
  ownership_periods,
  gameweeks_owned
FROM v_player_owned_leaderboard
WHERE manager_id = 344182
  AND ownership_periods LIKE '%,%'  -- Contains comma = multiple periods
ORDER BY total_points DESC;

-- ============================================================================
-- Query 5: Get players who were captain at least once
-- ============================================================================
SELECT 
  player_name,
  total_points,
  captain_weeks,
  ownership_periods
FROM v_player_owned_leaderboard
WHERE manager_id = 344182
  AND captain_weeks > 0
ORDER BY captain_weeks DESC, total_points DESC;

-- ============================================================================
-- Query 6: Get summary statistics for a manager
-- ============================================================================
SELECT 
  COUNT(*) as total_unique_players,
  SUM(total_points) as total_points_from_all_players,
  ROUND(AVG(total_points), 2) as avg_points_per_player,
  ROUND(AVG(average_points_per_gw), 2) as avg_points_per_gw_across_all_players,
  MAX(total_points) as highest_scoring_player_points,
  (SELECT player_name FROM v_player_owned_leaderboard 
   WHERE manager_id = 344182 
   ORDER BY total_points DESC LIMIT 1) as highest_scoring_player
FROM v_player_owned_leaderboard
WHERE manager_id = 344182;

-- ============================================================================
-- Query 7: Get players owned in specific gameweek range
-- ============================================================================
SELECT 
  player_name,
  total_points,
  ownership_periods,
  gameweeks_owned
FROM v_player_owned_leaderboard
WHERE manager_id = 344182
  AND first_owned_gw <= 10
  AND last_owned_gw >= 1
ORDER BY total_points DESC;

-- ============================================================================
-- Query 8: Compare two managers' top players
-- ============================================================================
WITH manager1 AS (
  SELECT player_name, total_points, ownership_periods
  FROM v_player_owned_leaderboard
  WHERE manager_id = 344182
  ORDER BY total_points DESC
  LIMIT 10
),
manager2 AS (
  SELECT player_name, total_points, ownership_periods
  FROM v_player_owned_leaderboard
  WHERE manager_id = 123456  -- Replace with actual manager ID
  ORDER BY total_points DESC
  LIMIT 10
)
SELECT 
  COALESCE(m1.player_name, m2.player_name) as player_name,
  m1.total_points as manager1_points,
  m2.total_points as manager2_points,
  COALESCE(m1.total_points, 0) - COALESCE(m2.total_points, 0) as point_difference
FROM manager1 m1
FULL OUTER JOIN manager2 m2 ON m1.player_name = m2.player_name
ORDER BY COALESCE(m1.total_points, 0) + COALESCE(m2.total_points, 0) DESC;

-- ============================================================================
-- Query 9: Get detailed gameweek breakdown for a specific player
-- (Requires joining back to manager_picks for details)
-- ============================================================================
SELECT 
  mp.gameweek,
  mp.position,
  mp.multiplier,
  mp.is_captain,
  pgs.total_points as base_points,
  pgs.total_points * mp.multiplier as points_with_multiplier,
  mp.was_auto_subbed_in,
  mp.auto_sub_replaced_player_id
FROM manager_picks mp
JOIN player_gameweek_stats pgs 
  ON mp.player_id = pgs.player_id 
  AND mp.gameweek = pgs.gameweek
WHERE mp.manager_id = 344182
  AND mp.player_id = (SELECT fpl_player_id FROM players WHERE web_name = 'Haaland' LIMIT 1)
  AND mp.position <= 11  -- Starting XI only
ORDER BY mp.gameweek;

-- ============================================================================
-- Query 10: Use materialized view for faster queries (if refreshed)
-- ============================================================================
SELECT 
  player_name,
  total_points,
  ownership_periods,
  gameweeks_owned
FROM mv_player_owned_leaderboard
WHERE manager_id = 344182
ORDER BY total_points DESC;

-- ============================================================================
-- Refresh materialized view (run periodically or after data updates)
-- ============================================================================
-- SELECT refresh_player_owned_leaderboard();
