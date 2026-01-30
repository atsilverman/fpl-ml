-- =============================================================================
-- Verify Backfill Status
-- Run these in Supabase SQL Editor to check if the overnight backfill completed.
-- =============================================================================

-- 1. Total gameweeks in the system (expected max)
SELECT COUNT(*) AS total_gameweeks FROM gameweeks ORDER BY id;

-- 2. Picks coverage: per manager, how many gameweeks have manager_picks
--    "Complete" = same as total gameweeks
WITH gw_count AS (SELECT COUNT(*) AS total FROM gameweeks),
     picks_per_manager AS (
       SELECT manager_id, COUNT(DISTINCT gameweek) AS picks_gameweeks
       FROM manager_picks
       GROUP BY manager_id
     )
SELECT 
  p.manager_id,
  m.manager_name,
  p.picks_gameweeks,
  g.total AS total_gameweeks,
  CASE WHEN p.picks_gameweeks >= g.total THEN 'Complete' ELSE 'Incomplete' END AS picks_status
FROM picks_per_manager p
CROSS JOIN gw_count g
LEFT JOIN managers m ON m.manager_id = p.manager_id
ORDER BY p.picks_gameweeks ASC, p.manager_id;

-- 3. History coverage: per manager, how many gameweeks have manager_gameweek_history
WITH gw_count AS (SELECT COUNT(*) AS total FROM gameweeks),
     history_per_manager AS (
       SELECT manager_id, COUNT(DISTINCT gameweek) AS history_gameweeks
       FROM manager_gameweek_history
       GROUP BY manager_id
     )
SELECT 
  h.manager_id,
  m.manager_name,
  h.history_gameweeks,
  g.total AS total_gameweeks,
  CASE WHEN h.history_gameweeks >= g.total THEN 'Complete' ELSE 'Incomplete' END AS history_status
FROM history_per_manager h
CROSS JOIN gw_count g
LEFT JOIN managers m ON m.manager_id = h.manager_id
ORDER BY h.history_gameweeks ASC, h.manager_id;

-- 4. Summary: count of managers fully backfilled vs incomplete
WITH gw_total AS (SELECT COUNT(*) AS n FROM gameweeks),
     picks_ok AS (
       SELECT manager_id
       FROM manager_picks
       GROUP BY manager_id
       HAVING COUNT(DISTINCT gameweek) = (SELECT n FROM gw_total)
     ),
     history_ok AS (
       SELECT manager_id
       FROM manager_gameweek_history
       GROUP BY manager_id
       HAVING COUNT(DISTINCT gameweek) = (SELECT n FROM gw_total)
     ),
     tracked AS (SELECT COUNT(DISTINCT manager_id) AS n FROM mini_league_managers)
SELECT 
  (SELECT n FROM tracked) AS tracked_managers,
  (SELECT COUNT(*) FROM picks_ok) AS managers_with_full_picks,
  (SELECT COUNT(*) FROM history_ok) AS managers_with_full_history,
  (SELECT n FROM gw_total) AS total_gameweeks;

-- 5. Managers with incomplete picks (picks_gameweeks < total_gameweeks)
WITH gw_total AS (SELECT COUNT(*) AS n FROM gameweeks),
     picks_per_manager AS (
       SELECT manager_id, COUNT(DISTINCT gameweek) AS picks_gameweeks
       FROM manager_picks
       GROUP BY manager_id
     )
SELECT p.manager_id, m.manager_name, p.picks_gameweeks, g.n AS total_gameweeks
FROM picks_per_manager p
CROSS JOIN gw_total g
LEFT JOIN managers m ON m.manager_id = p.manager_id
WHERE p.picks_gameweeks < g.n
ORDER BY p.picks_gameweeks ASC;

-- 6. mv_player_owned_leaderboard row count per manager (for total points bar graph)
SELECT 
  manager_id,
  COUNT(*) AS players_in_leaderboard
FROM mv_player_owned_leaderboard
GROUP BY manager_id
ORDER BY manager_id;
