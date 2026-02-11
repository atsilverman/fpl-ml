-- When manager_gameweek_history.gameweek_points is 0 (e.g. backend hasn't refreshed that manager yet),
-- derive GW points from player-level data (v_manager_player_gameweek_points) so the league standings
-- display correct values. Player stats are the source of truth; this fallback ensures rollup works
-- even when refresh_manager_gameweek_history hasn't run for all managers.
DROP MATERIALIZED VIEW IF EXISTS mv_mini_league_standings;
CREATE MATERIALIZED VIEW mv_mini_league_standings AS
WITH current_gw AS (
  SELECT id AS gw FROM gameweeks WHERE is_current = true LIMIT 1
),
prev_gw AS (
  SELECT (SELECT gw FROM current_gw) - 1 AS gw
),
prev_ranks AS (
  SELECT
    mlm.league_id,
    mgh.manager_id,
    ROW_NUMBER() OVER (
      PARTITION BY mlm.league_id
      ORDER BY mgh.total_points DESC, mgh.manager_id ASC
    ) AS prev_rank
  FROM mini_league_managers mlm
  JOIN manager_gameweek_history mgh ON mgh.manager_id = mlm.manager_id
  WHERE mgh.gameweek = (SELECT gw FROM prev_gw)
    AND (SELECT gw FROM prev_gw) >= 1
),
-- Player-derived GW points: sum from v_manager_player_gameweek_points minus transfer_cost
player_gw_points AS (
  SELECT
    vpgp.manager_id,
    (COALESCE(SUM(vpgp.points), 0)::INTEGER - COALESCE(mgh.transfer_cost, 0))::INTEGER AS points
  FROM v_manager_player_gameweek_points vpgp
  JOIN manager_gameweek_history mgh ON mgh.manager_id = vpgp.manager_id
    AND mgh.gameweek = vpgp.gameweek
  WHERE vpgp.gameweek = (SELECT gw FROM current_gw)
  GROUP BY vpgp.manager_id, mgh.transfer_cost
),
base AS (
  SELECT
    ml.league_id,
    m.manager_id,
    m.manager_name,
    m.manager_team_name,
    mgh.gameweek,
    -- Use mgh.gameweek_points when > 0, else fallback to player-derived sum
    COALESCE(NULLIF(mgh.gameweek_points, 0), pgp.points, 0) AS gameweek_points,
    mgh.total_points,
    mgh.mini_league_rank,
    mgh.mini_league_rank_change,
    ROW_NUMBER() OVER (
      PARTITION BY ml.league_id, mgh.gameweek
      ORDER BY mgh.total_points DESC, m.manager_id ASC
    ) AS calculated_rank,
    pr.prev_rank AS previous_calculated_rank
  FROM mini_leagues ml
  JOIN mini_league_managers mlm ON mlm.league_id = ml.league_id
  JOIN managers m ON mlm.manager_id = m.manager_id
  JOIN manager_gameweek_history mgh ON m.manager_id = mgh.manager_id
  LEFT JOIN prev_ranks pr ON pr.league_id = ml.league_id AND pr.manager_id = m.manager_id
  LEFT JOIN player_gw_points pgp ON pgp.manager_id = m.manager_id
  WHERE mgh.gameweek = (SELECT gw FROM current_gw)
)
SELECT
  league_id,
  manager_id,
  manager_name,
  manager_team_name,
  gameweek,
  gameweek_points,
  total_points,
  mini_league_rank,
  mini_league_rank_change,
  calculated_rank,
  previous_calculated_rank,
  (previous_calculated_rank - calculated_rank) AS calculated_rank_change
FROM base;

CREATE UNIQUE INDEX idx_mv_standings_unique ON mv_mini_league_standings(league_id, manager_id, gameweek);

COMMENT ON MATERIALIZED VIEW mv_mini_league_standings IS
'League standings by total points. gameweek_points uses manager_gameweek_history when > 0, else falls back to sum from v_manager_player_gameweek_points (player-derived) so standings show correct GW points during live.';
