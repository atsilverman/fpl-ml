-- Remove is_provisional and data_status fields from manager_gameweek_history
-- These fields are redundant - provisional status can be derived on-the-fly
-- by checking if any player in a manager's team has bonus_status = 'provisional'

-- 1. Drop materialized views first (they depend on the columns we're removing)
DROP MATERIALIZED VIEW IF EXISTS mv_mini_league_standings;
DROP MATERIALIZED VIEW IF EXISTS mv_manager_gameweek_summary;

-- 2. Drop the index on is_provisional
DROP INDEX IF EXISTS idx_mgh_provisional;

-- 3. Drop columns from manager_gameweek_history table
ALTER TABLE manager_gameweek_history 
  DROP COLUMN IF EXISTS is_provisional,
  DROP COLUMN IF EXISTS data_status;

-- 4. Recreate materialized views without these fields
DROP MATERIALIZED VIEW IF EXISTS mv_mini_league_standings;
CREATE MATERIALIZED VIEW mv_mini_league_standings AS
SELECT 
  ml.league_id,
  m.manager_id,
  m.manager_name,
  mgh.gameweek,
  mgh.gameweek_points,
  mgh.total_points,
  mgh.mini_league_rank,
  mgh.mini_league_rank_change,
  ROW_NUMBER() OVER (
    PARTITION BY ml.league_id, mgh.gameweek 
    ORDER BY mgh.total_points DESC, m.manager_id ASC
  ) as calculated_rank
FROM mini_leagues ml
JOIN mini_league_managers mlm ON ml.league_id = mlm.league_id
JOIN managers m ON mlm.manager_id = m.manager_id
JOIN manager_gameweek_history mgh ON m.manager_id = mgh.manager_id
WHERE mgh.gameweek = (SELECT id FROM gameweeks WHERE is_current = true);

CREATE UNIQUE INDEX idx_mv_standings_unique ON mv_mini_league_standings(league_id, manager_id, gameweek);

-- 5. Recreate manager gameweek summary view without is_provisional
CREATE MATERIALIZED VIEW mv_manager_gameweek_summary AS
SELECT 
  mgh.manager_id,
  mgh.gameweek,
  mgh.gameweek_points,
  mgh.total_points,
  mgh.transfer_cost,
  mgh.transfers_made,
  mgh.active_chip,
  COALESCE(SUM(mt.net_price_change_tenths), 0) as total_net_transfer_value_tenths,
  COUNT(mt.id) as transfer_count
FROM manager_gameweek_history mgh
LEFT JOIN manager_transfers mt ON mgh.manager_id = mt.manager_id AND mgh.gameweek = mt.gameweek
GROUP BY mgh.manager_id, mgh.gameweek, mgh.gameweek_points, mgh.total_points, 
         mgh.transfer_cost, mgh.transfers_made, mgh.active_chip;

CREATE UNIQUE INDEX idx_mv_mgw_summary_unique ON mv_manager_gameweek_summary(manager_id, gameweek);
