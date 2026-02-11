-- Fix duplicate key on mv_player_gameweek_performance: player_gameweek_stats has multiple rows
-- per (player_id, gameweek) for DGW (migration 045). Aggregate to one row per (player_id, gameweek).

DROP MATERIALIZED VIEW IF EXISTS mv_player_gameweek_performance;

CREATE MATERIALIZED VIEW mv_player_gameweek_performance AS
SELECT
  pgs.player_id,
  pgs.gameweek,
  SUM(pgs.total_points)::INTEGER AS total_points,
  CASE
    WHEN BOOL_OR(pgs.bonus_status = 'confirmed') THEN SUM(pgs.bonus)::INTEGER
    ELSE NULL
  END AS effective_bonus,
  CASE
    WHEN BOOL_OR(pgs.bonus_status = 'confirmed') THEN 'confirmed'::TEXT
    ELSE 'provisional'::TEXT
  END AS bonus_status,
  SUM(COALESCE(pgs.defensive_contribution, 0))::INTEGER AS defcon,
  SUM(COALESCE(pgs.minutes, 0))::INTEGER AS minutes,
  SUM(COALESCE(pgs.goals_scored, 0))::INTEGER AS goals_scored,
  SUM(COALESCE(pgs.assists, 0))::INTEGER AS assists,
  SUM(COALESCE(pgs.clean_sheets, 0))::INTEGER AS clean_sheets,
  SUM(COALESCE(pgs.saves, 0))::INTEGER AS saves
FROM player_gameweek_stats pgs
GROUP BY pgs.player_id, pgs.gameweek;

CREATE UNIQUE INDEX idx_mv_pgp_unique ON mv_player_gameweek_performance(player_id, gameweek);

COMMENT ON MATERIALIZED VIEW mv_player_gameweek_performance IS
'Per-player per-gameweek performance (aggregated). DGW: sums stats across fixture rows. Refresh via refresh_player_gameweek_performance().';
