-- Add per-league previous rank and rank change to mv_mini_league_standings.
-- Rank change was wrong when multiple leagues exist: stored mini_league_rank/change
-- are overwritten by the last league processed. This computes previous rank and
-- rank change within the same league using previous gameweek totals.
DROP MATERIALIZED VIEW IF EXISTS mv_mini_league_standings;
CREATE MATERIALIZED VIEW mv_mini_league_standings AS
WITH current_gw AS (
  SELECT id AS gw FROM gameweeks WHERE is_current = true LIMIT 1
),
prev_gw AS (
  SELECT (SELECT gw FROM current_gw) - 1 AS gw
),
-- Previous gameweek rank within each league (same tie-break: total_points DESC, manager_id ASC)
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
base AS (
  SELECT
    ml.league_id,
    m.manager_id,
    m.manager_name,
    m.manager_team_name,
    mgh.gameweek,
    mgh.gameweek_points,
    mgh.total_points,
    mgh.mini_league_rank,
    mgh.mini_league_rank_change,
    ROW_NUMBER() OVER (
      PARTITION BY ml.league_id, mgh.gameweek
      ORDER BY mgh.total_points DESC, m.manager_id ASC
    ) AS calculated_rank,
    pr.prev_rank AS previous_calculated_rank
  FROM mini_leagues ml
  JOIN mini_league_managers mlm ON ml.league_id = mlm.league_id
  JOIN managers m ON mlm.manager_id = m.manager_id
  JOIN manager_gameweek_history mgh ON m.manager_id = mgh.manager_id
  LEFT JOIN prev_ranks pr ON pr.league_id = ml.league_id AND pr.manager_id = m.manager_id
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
