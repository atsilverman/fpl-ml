-- Add release_time to gameweeks. FPL API provides this in bootstrap-static events;
-- when set, it indicates when the gameweek data is released (e.g. new GW goes live).
-- Used to wait for new gameweek after deadline and avoid showing last week's data.
ALTER TABLE gameweeks
  ADD COLUMN IF NOT EXISTS release_time TIMESTAMPTZ;

COMMENT ON COLUMN gameweeks.release_time IS 'When FPL releases this gameweek (e.g. new GW goes live). From bootstrap-static events.release_time. Used post-deadline to refresh until new GW is current.';
