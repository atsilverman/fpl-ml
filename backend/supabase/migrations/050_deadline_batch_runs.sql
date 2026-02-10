-- Deadline batch runs: when post-deadline refresh started (is_current detected) and finished.
-- Used by Debug panel to show "Started (GW became current)", "Finished", duration, and phase breakdown.

CREATE TABLE IF NOT EXISTS deadline_batch_runs (
  id BIGSERIAL PRIMARY KEY,
  gameweek INTEGER NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  duration_seconds NUMERIC,
  manager_count INTEGER,
  league_count INTEGER,
  success BOOLEAN,
  phase_breakdown JSONB
);

CREATE INDEX IF NOT EXISTS idx_deadline_batch_runs_gameweek_started
  ON deadline_batch_runs (gameweek, started_at DESC);

COMMENT ON TABLE deadline_batch_runs IS
'Post-deadline batch runs: started_at = when is_current changed (updates started); finished_at, duration_seconds, phase_breakdown for debug panel.';

COMMENT ON COLUMN deadline_batch_runs.started_at IS
'When we detected the new gameweek became is_current and started the batch (trigger time).';

COMMENT ON COLUMN deadline_batch_runs.phase_breakdown IS
'JSON: e.g. {"bootstrap_check_sec": 2, "settle_sec": 180, "picks_and_transfers_sec": 142, "baselines_sec": 38, "whitelist_sec": 12, "transfer_aggregation_sec": 8, "materialized_views_sec": 45}.';
