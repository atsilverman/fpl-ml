-- Player price snapshots: 5:40pm local daily snapshot with prior price for backfill and change detection.
-- Enables: MV/view for price change/rise in last 24h, validation vs price_change_predictions, charts over time.

-- Add prior price column so we can backfill and compute rise/fall from snapshot.
ALTER TABLE player_prices
  ADD COLUMN IF NOT EXISTS prior_price_tenths INTEGER;

COMMENT ON COLUMN player_prices.prior_price_tenths IS
  'Price in tenths of £ before any change on recorded_date. Set when capturing 5:40pm snapshot; use for backfill (e.g. today risers: after=8.7 prior=8.6) and to derive price_change_tenths. NULL when no prior snapshot.';

-- Index for "latest snapshot date" and "recent price changes" queries.
CREATE INDEX IF NOT EXISTS idx_player_prices_recorded_date
  ON player_prices(recorded_date DESC);

CREATE INDEX IF NOT EXISTS idx_player_prices_recorded_date_change
  ON player_prices(recorded_date DESC)
  WHERE prior_price_tenths IS NOT NULL AND price_tenths IS NOT NULL;

-- View: latest snapshot date (so UI/cron can use "last 24h" as most recent snapshot).
CREATE OR REPLACE VIEW latest_price_snapshot_date AS
  SELECT COALESCE(MAX(recorded_date), CURRENT_DATE - 1) AS snapshot_date
  FROM player_prices
  WHERE prior_price_tenths IS NOT NULL;

COMMENT ON VIEW latest_price_snapshot_date IS
  'Single row: the most recent snapshot date where we have prior_price_tenths. Use for "price changes in last 24h" style queries.';

-- View: all players with a price change on the latest snapshot date (for validation vs price_change_predictions).
CREATE OR REPLACE VIEW player_price_changes_latest AS
  SELECT
    pp.player_id,
    pp.gameweek,
    pp.recorded_date,
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
  JOIN latest_price_snapshot_date l ON pp.recorded_date = l.snapshot_date
  JOIN players p ON p.fpl_player_id = pp.player_id
  JOIN teams t ON t.team_id = p.team_id
  WHERE pp.prior_price_tenths IS NOT NULL
    AND pp.price_tenths IS NOT NULL
    AND pp.price_tenths != pp.prior_price_tenths;

COMMENT ON VIEW player_price_changes_latest IS
  'Players who had a price change (rise or fall) on the most recent snapshot date. Use to validate against price_change_predictions or drive bento/charts. is_rise = true for risers.';

-- View: risers only on latest snapshot (subset of player_price_changes_latest).
CREATE OR REPLACE VIEW player_price_risers_latest AS
  SELECT *
  FROM player_price_changes_latest
  WHERE is_rise;

COMMENT ON VIEW player_price_risers_latest IS
  'Players who had a price rise on the most recent snapshot date.';

-- Backfill example for today's risers (after = price_tenths, prior = price_tenths - 1):
-- Watkins £8.7 → price_tenths 87, prior_price_tenths 86
-- Damsgaard £5.6 → 56, 55; Schär £5.2 → 52, 51; Xhaka £5.1 → 51, 50
-- Insert one row per player for current gameweek and recorded_date = CURRENT_DATE, or upsert
-- using (player_id, gameweek, recorded_date). Get player_id from players (e.g. by web_name + team).
