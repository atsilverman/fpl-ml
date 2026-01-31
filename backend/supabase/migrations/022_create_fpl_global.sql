-- Migration: Create FPL Global Table
--
-- Stores global FPL game stats (e.g. total managers) from bootstrap-static.
-- Used for GW rank percentile display (top 0.1%, 1%, 5%, 10%).

CREATE TABLE IF NOT EXISTS fpl_global (
  id TEXT PRIMARY KEY DEFAULT 'current_season',
  total_managers INTEGER NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE fpl_global IS
'Global FPL stats from bootstrap-static. total_managers = bootstrap total_players (FPL manager count). Updated when gameweeks are refreshed.';

COMMENT ON COLUMN fpl_global.total_managers IS
'Total number of FPL managers in the game (from bootstrap-static total_players).';
