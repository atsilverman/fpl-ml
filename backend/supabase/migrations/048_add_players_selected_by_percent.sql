-- Add FPL global ownership % (from bootstrap-static elements[].selected_by_percent).
-- Used for "Overall ownership" in player detail modal.
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS selected_by_percent DECIMAL(5,2) DEFAULT NULL;

COMMENT ON COLUMN players.selected_by_percent IS 'FPL global ownership % from bootstrap-static elements[].selected_by_percent (e.g. 34.70).';
