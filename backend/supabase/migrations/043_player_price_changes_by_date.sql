-- View: all price changes by recorded_date (for daily bento UI).
-- Same shape as player_price_changes_latest but includes every snapshot date that has changes.

CREATE OR REPLACE VIEW player_price_changes_by_date AS
  SELECT
    pp.recorded_date,
    pp.player_id,
    pp.gameweek,
    pp.recorded_at,
    pp.prior_price_tenths,
    pp.price_tenths,
    (pp.price_tenths - pp.prior_price_tenths) AS change_tenths,
    (pp.price_tenths > pp.prior_price_tenths) AS is_rise,
    p.web_name,
    p.first_name,
    p.second_name,
    t.short_name AS team_short_name
  FROM player_prices pp
  JOIN players p ON p.fpl_player_id = pp.player_id
  JOIN teams t ON t.team_id = p.team_id
  WHERE pp.prior_price_tenths IS NOT NULL
    AND pp.price_tenths IS NOT NULL
    AND pp.price_tenths != pp.prior_price_tenths;

COMMENT ON VIEW player_price_changes_by_date IS
  'All player price changes per snapshot date. Use for daily bentos: group by recorded_date, split by is_rise.';
