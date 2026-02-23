-- Allow frontend (anon) to read refresh_duration_log for Debug modal "Updates" section
-- (per-phase "Since backend" and Duration to identify slow orchestrator phases).
ALTER TABLE refresh_duration_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon select refresh_duration_log"
  ON refresh_duration_log
  FOR SELECT TO anon
  USING (true);

COMMENT ON POLICY "Allow anon select refresh_duration_log" ON refresh_duration_log IS
'Debug modal reads latest occurred_at per source for phase-level timestamps.';
