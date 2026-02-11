-- Mark orphan deadline_batch_runs (started but never finished) as failed.
-- Orphans occur when the process restarts/crashes before update_deadline_batch_finish.
-- Stale = started_at more than 30 minutes ago and finished_at is null.

UPDATE deadline_batch_runs
SET
  finished_at = started_at,
  duration_seconds = 0,
  success = false
WHERE finished_at IS NULL
  AND started_at < NOW() - INTERVAL '30 minutes';
