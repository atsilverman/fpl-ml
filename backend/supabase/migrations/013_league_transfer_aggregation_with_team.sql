-- View over mv_league_transfer_aggregation that adds team_short_name for badge display.
-- Hook useLeagueTopTransfers queries this view to show team logos next to player names.

CREATE OR REPLACE VIEW v_league_transfer_aggregation AS
SELECT
  m.league_id,
  m.league_name,
  m.gameweek,
  m.player_id,
  m.player_name,
  m.player_position,
  m.transfer_direction,
  m.manager_count,
  m.transfer_count,
  m.avg_price_tenths,
  m.avg_net_price_change_tenths,
  t.short_name AS team_short_name
FROM mv_league_transfer_aggregation m
JOIN players p ON p.fpl_player_id = m.player_id
JOIN teams t ON t.team_id = p.team_id;

COMMENT ON VIEW v_league_transfer_aggregation IS
  'League transfer aggregation with team_short_name for badge display. Use for TOP TRANSFERS expanded view.';
