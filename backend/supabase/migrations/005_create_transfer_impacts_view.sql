-- Materialized View: Manager Transfer Impacts
-- Pre-calculates point impacts for transfers to optimize Transfers page queries
-- Refresh during live gameweeks (every 30-60 seconds) as player points update

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_manager_transfer_impacts AS
SELECT 
  mt.id as transfer_id,
  mt.manager_id,
  mt.gameweek,
  mt.player_in_id,
  mt.player_out_id,
  mt.transfer_time,
  -- Player names (for display)
  p_in.web_name as player_in_name,
  p_out.web_name as player_out_name,
  -- Point impacts (pre-calculated)
  COALESCE(pgs_in.total_points, 0) as player_in_points,
  COALESCE(pgs_out.total_points, 0) as player_out_points,
  COALESCE(pgs_in.total_points, 0) - COALESCE(pgs_out.total_points, 0) as point_impact,
  -- Price information (already in manager_transfers, but included for convenience)
  mt.price_in_tenths,
  mt.price_out_tenths,
  mt.net_price_change_tenths
FROM manager_transfers mt
LEFT JOIN players p_in ON mt.player_in_id = p_in.fpl_player_id
LEFT JOIN players p_out ON mt.player_out_id = p_out.fpl_player_id
LEFT JOIN player_gameweek_stats pgs_in ON mt.player_in_id = pgs_in.player_id 
  AND mt.gameweek = pgs_in.gameweek
LEFT JOIN player_gameweek_stats pgs_out ON mt.player_out_id = pgs_out.player_id 
  AND mt.gameweek = pgs_out.gameweek;

-- Indexes for fast lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_transfer_impacts_unique ON mv_manager_transfer_impacts(transfer_id);
CREATE INDEX IF NOT EXISTS idx_mv_transfer_impacts_manager_gw ON mv_manager_transfer_impacts(manager_id, gameweek);
CREATE INDEX IF NOT EXISTS idx_mv_transfer_impacts_gameweek ON mv_manager_transfer_impacts(gameweek);
CREATE INDEX IF NOT EXISTS idx_mv_transfer_impacts_point_impact ON mv_manager_transfer_impacts(gameweek, point_impact DESC);

COMMENT ON MATERIALIZED VIEW mv_manager_transfer_impacts IS 
'Pre-calculates transfer point impacts for fast Transfers page queries.
- Refreshes every 30-60 seconds during live gameweeks as player points update
- Reduces JOIN overhead from manager_transfers + player_gameweek_stats (2x)
- Used by League / Transfers page to show manager transfer impacts (Δ PTS)';

-- Example optimized query using the materialized view:
-- Get manager transfers with point impacts for a league
/*
SELECT 
  mgh.mini_league_rank,
  m.manager_name,
  mgh.mini_league_rank_change,
  mti.player_in_name,
  mti.player_out_name,
  mti.point_impact,
  -- Sum for total delta points per manager
  SUM(mti.point_impact) OVER (PARTITION BY mti.manager_id) as total_delta_points
FROM mv_manager_transfer_impacts mti
JOIN manager_gameweek_history mgh ON mti.manager_id = mgh.manager_id 
  AND mti.gameweek = mgh.gameweek
JOIN managers m ON mti.manager_id = m.manager_id
WHERE mti.gameweek = :gameweek
  AND mti.manager_id IN (
    SELECT manager_id FROM mini_league_managers WHERE league_id = :league_id
  )
ORDER BY mgh.mini_league_rank;
*/
