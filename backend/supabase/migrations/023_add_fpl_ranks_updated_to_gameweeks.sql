-- Add fpl_ranks_updated to gameweeks for stale indicator on Overall/GW rank bentos.
-- Set to true when we detect FPL API has updated overall_rank/gameweek_rank (e.g. after bonus confirmation).
-- Frontend uses this to hide the "!" stale indicator on rank cards.

ALTER TABLE gameweeks
ADD COLUMN IF NOT EXISTS fpl_ranks_updated BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN gameweeks.fpl_ranks_updated IS 'True when FPL API has updated overall_rank/gameweek_rank for this gameweek (detected by polling API). Used by frontend to hide stale indicator on rank bentos.';

-- Past finished gameweeks: assume ranks are final so frontend does not show stale for them
UPDATE gameweeks SET fpl_ranks_updated = TRUE WHERE finished = TRUE;
