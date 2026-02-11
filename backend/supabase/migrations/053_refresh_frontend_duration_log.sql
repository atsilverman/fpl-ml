-- Migration: Frontend fetch duration log
--
-- Records how long each frontend Supabase fetch took per source, every run.
-- Complements refresh_duration_log (backend). Export via export_refresh_log.py.

CREATE TABLE IF NOT EXISTS refresh_frontend_duration_log (
  id BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL CHECK (source IN (
    'Gameweeks', 'Fixtures', 'GW Players', 'Manager', 'League standings'
  )),
  state TEXT NOT NULL,
  duration_ms INT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_refresh_frontend_duration_log_occurred
  ON refresh_frontend_duration_log (occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_refresh_frontend_duration_log_source
  ON refresh_frontend_duration_log (source, occurred_at DESC);

COMMENT ON TABLE refresh_frontend_duration_log IS
'Frontend: duration of each Supabase fetch per source, logged on every successful run. For plotting over time.';

ALTER TABLE refresh_frontend_duration_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon insert frontend duration" ON refresh_frontend_duration_log
  FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY "Allow anon select frontend duration" ON refresh_frontend_duration_log
  FOR SELECT TO anon
  USING (true);
