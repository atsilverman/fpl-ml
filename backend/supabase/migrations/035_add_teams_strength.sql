-- Add FPL team strength (1-5) for opponent difficulty coloring (e.g. schedule table).
-- Source: bootstrap-static → teams[].strength

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS strength INTEGER;

COMMENT ON COLUMN teams.strength IS 'FPL API team strength rating 1-5 (1=easiest, 5=hardest). Used for opponent difficulty coloring.';
