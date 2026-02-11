-- Allow 'live_standings' as a source in refresh_duration_log (Phase 2 live update overhaul)
ALTER TABLE refresh_duration_log
  DROP CONSTRAINT IF EXISTS refresh_duration_log_source_check;

ALTER TABLE refresh_duration_log
  ADD CONSTRAINT refresh_duration_log_source_check CHECK (source IN (
    'gameweeks', 'fixtures', 'gw_players', 'manager_points', 'mvs', 'live_standings'
  ));
