-- Add provisional_bonus to player_gameweek_stats for live scoring.
-- When match is in second half (any player in fixture has minutes > 45) and bonus
-- is not yet confirmed, we compute 1-3 from BPS rank within fixture and store here.
-- UI shows provisional_bonus when bonus_status = 'provisional'; when confirmed, shows bonus.
ALTER TABLE player_gameweek_stats
  ADD COLUMN IF NOT EXISTS provisional_bonus INTEGER DEFAULT 0;

COMMENT ON COLUMN player_gameweek_stats.provisional_bonus IS 'Calculated 1-3 from BPS rank in fixture when match past 45 min and bonus not yet confirmed; 0 when official bonus used or before threshold.';
