-- Materialized Views for Performance
-- Pre-calculated aggregations for fast UI loading

-- 1. Mini League Standings Materialized View
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_mini_league_standings AS
SELECT 
  ml.league_id,
  m.manager_id,
  m.manager_name,
  mgh.gameweek,
  mgh.gameweek_points,
  mgh.total_points,
  mgh.mini_league_rank,
  mgh.mini_league_rank_change,
  mgh.is_provisional,
  mgh.data_status,
  ROW_NUMBER() OVER (
    PARTITION BY ml.league_id, mgh.gameweek 
    ORDER BY mgh.total_points DESC, m.manager_id ASC
  ) as calculated_rank
FROM mini_leagues ml
JOIN mini_league_managers mlm ON ml.league_id = mlm.league_id
JOIN managers m ON mlm.manager_id = m.manager_id
JOIN manager_gameweek_history mgh ON m.manager_id = mgh.manager_id
WHERE mgh.gameweek = (SELECT id FROM gameweeks WHERE is_current = true);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_standings_unique ON mv_mini_league_standings(league_id, manager_id, gameweek);

-- 2. Manager Gameweek Summary Materialized View
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_manager_gameweek_summary AS
SELECT 
  mgh.manager_id,
  mgh.gameweek,
  mgh.gameweek_points,
  mgh.total_points,
  mgh.transfer_cost,
  mgh.transfers_made,
  mgh.active_chip,
  mgh.is_provisional,
  COALESCE(SUM(mt.net_price_change_tenths), 0) as total_net_transfer_value_tenths,
  COUNT(mt.id) as transfer_count
FROM manager_gameweek_history mgh
LEFT JOIN manager_transfers mt ON mgh.manager_id = mt.manager_id AND mgh.gameweek = mt.gameweek
GROUP BY mgh.manager_id, mgh.gameweek, mgh.gameweek_points, mgh.total_points, 
         mgh.transfer_cost, mgh.transfers_made, mgh.active_chip, mgh.is_provisional;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_mgw_summary_unique ON mv_manager_gameweek_summary(manager_id, gameweek);

-- 3. Player Gameweek Performance Materialized View
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_player_gameweek_performance AS
SELECT 
  pgs.player_id,
  pgs.gameweek,
  pgs.total_points,
  CASE 
    WHEN pgs.bonus_status = 'confirmed' THEN pgs.bonus
    WHEN pgs.bonus_status = 'provisional' THEN NULL  -- Calculate in application layer
    ELSE NULL
  END as effective_bonus,
  pgs.bonus_status,
  pgs.defensive_contribution as defcon,
  pgs.minutes,
  pgs.goals_scored,
  pgs.assists,
  pgs.clean_sheets,
  pgs.saves
FROM player_gameweek_stats pgs;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_pgp_unique ON mv_player_gameweek_performance(player_id, gameweek);

-- 4. League Transfer Aggregation Materialized View
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_league_transfer_aggregation AS
SELECT 
  ml.league_id,
  ml.league_name,
  mt.gameweek,
  
  -- Transfers IN
  mt.player_in_id as player_id,
  p_in.web_name as player_name,
  p_in.position as player_position,
  'in' as transfer_direction,
  COUNT(DISTINCT mt.manager_id) as manager_count,
  COUNT(*) as transfer_count,
  AVG(mt.price_in_tenths) as avg_price_tenths,
  AVG(mt.net_price_change_tenths) as avg_net_price_change_tenths
  
FROM mini_leagues ml
JOIN mini_league_managers mlm ON ml.league_id = mlm.league_id
JOIN manager_transfers mt ON mlm.manager_id = mt.manager_id
JOIN players p_in ON mt.player_in_id = p_in.fpl_player_id
GROUP BY ml.league_id, ml.league_name, mt.gameweek, mt.player_in_id, p_in.web_name, p_in.position

UNION ALL

SELECT 
  ml.league_id,
  ml.league_name,
  mt.gameweek,
  
  -- Transfers OUT
  mt.player_out_id as player_id,
  p_out.web_name as player_name,
  p_out.position as player_position,
  'out' as transfer_direction,
  COUNT(DISTINCT mt.manager_id) as manager_count,
  COUNT(*) as transfer_count,
  AVG(mt.price_out_tenths) as avg_price_tenths,
  AVG(mt.net_price_change_tenths) as avg_net_price_change_tenths
  
FROM mini_leagues ml
JOIN mini_league_managers mlm ON ml.league_id = mlm.league_id
JOIN manager_transfers mt ON mlm.manager_id = mt.manager_id
JOIN players p_out ON mt.player_out_id = p_out.fpl_player_id
GROUP BY ml.league_id, ml.league_name, mt.gameweek, mt.player_out_id, p_out.web_name, p_out.position;

CREATE INDEX IF NOT EXISTS idx_mv_league_transfers_league_gw ON mv_league_transfer_aggregation(league_id, gameweek);
CREATE INDEX IF NOT EXISTS idx_mv_league_transfers_direction ON mv_league_transfer_aggregation(league_id, gameweek, transfer_direction, manager_count DESC);

-- Unique index for concurrent refresh (required for REFRESH MATERIALIZED VIEW CONCURRENTLY)
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_league_transfers_unique 
ON mv_league_transfer_aggregation(league_id, gameweek, player_id, transfer_direction);
