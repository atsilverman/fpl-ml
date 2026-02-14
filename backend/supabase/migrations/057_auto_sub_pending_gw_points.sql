-- Add auto_sub_pending_gw_points for "(+X)" UI: extra GW points from auto-subs
-- once FPL finalizes. Main total stays API; we show (+X) when our calc is higher.
ALTER TABLE manager_gameweek_history
  ADD COLUMN IF NOT EXISTS auto_sub_pending_gw_points INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN manager_gameweek_history.auto_sub_pending_gw_points IS
  'When > 0: our calculated GW points (with auto-subs) exceed API; show (+X) in UI. Set to 0 to revert to previous behaviour.';

-- Include in standings MV so frontend can show (+X) without extra requests
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
    COALESCE(NULLIF(mgh.gameweek_points, 0), pgp.points, 0) AS gameweek_points,
    mgh.total_points,
    COALESCE(mgh.auto_sub_pending_gw_points, 0) AS auto_sub_pending_gw_points,
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
  auto_sub_pending_gw_points,
  mini_league_rank,
  mini_league_rank_change,
  calculated_rank,
  previous_calculated_rank,
  (previous_calculated_rank - calculated_rank) AS calculated_rank_change
FROM base;

CREATE UNIQUE INDEX idx_mv_standings_unique ON mv_mini_league_standings(league_id, manager_id, gameweek);

COMMENT ON MATERIALIZED VIEW mv_mini_league_standings IS
'League standings by total points. gameweek_points uses manager_gameweek_history when > 0, else falls back to sum from v_manager_player_gameweek_points. auto_sub_pending_gw_points: show (+X) in UI when > 0 (revert by setting VITE_SHOW_AUTOSUB_PENDING=false).';
