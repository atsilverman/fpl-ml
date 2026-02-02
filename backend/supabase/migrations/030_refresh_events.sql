-- Migration: Refresh events table for monitoring backend lag
--
-- Backend writes one row per completed cycle (fast or slow). Frontend reads
-- latest occurred_at per path to show "Backend last" and "Time since backend"
-- in the Updates (debug) panel. See docs/UPDATE_LAG_MONITORING.md.

CREATE TABLE IF NOT EXISTS refresh_events (
  id BIGSERIAL PRIMARY KEY,
  path TEXT NOT NULL CHECK (path IN ('fast', 'slow')),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_events_path_occurred
  ON refresh_events (path, occurred_at DESC);

COMMENT ON TABLE refresh_events IS
'When the refresh orchestrator completed a fast or slow cycle. Fast = gameweeks, fixtures, players (when live). Slow = manager points + MVs. Used by frontend Updates (debug) to show backend vs frontend lag.';

COMMENT ON COLUMN refresh_events.path IS
'fast = _fast_cycle() completed; slow = _run_slow_loop() completed (manager points + MVs).';
