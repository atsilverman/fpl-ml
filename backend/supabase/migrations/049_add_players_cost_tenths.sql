-- Add current price (in tenths of £) to players for fallback when player_prices has no row.
-- Kept in sync from bootstrap-static on every refresh so player detail modal always has a price.
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS cost_tenths INTEGER DEFAULT NULL;

COMMENT ON COLUMN players.cost_tenths IS 'Current price in tenths of £ from bootstrap-static elements[].now_cost. Fallback for UI when player_prices has no row for this player/gameweek.';
