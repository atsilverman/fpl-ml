-- Migration: Refresh duration and snapshot logging for monitoring/plotting
--
-- refresh_duration_log: Backend records duration of each refresh phase.
-- refresh_snapshot_log: Frontend records periodic "since backend" and "since frontend" per source.
--
-- See docs/UPDATE_LAG_MONITORING.md. Export via backend/scripts/export_refresh_log.py.
-- View via refresh_log_viewer.html.

-- Backend phase completion (duration of each refresh step)
CREATE TABLE IF NOT EXISTS refresh_duration_log (
  id BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL CHECK (source IN (
    'gameweeks', 'fixtures', 'gw_players', 'manager_points', 'mvs'
  )),
  path TEXT NOT NULL CHECK (path IN ('fast', 'slow')),
  state TEXT NOT NULL,
  duration_ms INT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_refresh_duration_log_occurred
  ON refresh_duration_log (occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_refresh_duration_log_source
  ON refresh_duration_log (source, occurred_at DESC);

COMMENT ON TABLE refresh_duration_log IS
'Backend: duration of each refresh phase. Used for plotting refresh performance over time.';

-- Periodic snapshots of "since backend" and "since frontend" per source (from frontend)
CREATE TABLE IF NOT EXISTS refresh_snapshot_log (
  id BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL CHECK (source IN (
    'Gameweeks', 'Fixtures', 'GW Players', 'Manager', 'League standings'
  )),
  state TEXT NOT NULL,
  since_backend_sec NUMERIC(10, 1) NOT NULL,
  since_frontend_sec NUMERIC(10, 1) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_refresh_snapshot_log_occurred
  ON refresh_snapshot_log (occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_refresh_snapshot_log_source
  ON refresh_snapshot_log (source, occurred_at DESC);

COMMENT ON TABLE refresh_snapshot_log IS
'Frontend: periodic snapshot of time-since-backend and time-since-frontend per source. For line charts.';

-- Allow frontend (anon) to insert snapshots for monitoring
ALTER TABLE refresh_snapshot_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon insert snapshot" ON refresh_snapshot_log
  FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY "Allow anon select snapshot" ON refresh_snapshot_log
  FOR SELECT TO anon
  USING (true);
