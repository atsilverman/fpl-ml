-- Gameweek feed events: timeline of point-impacting events during live gameweeks.
-- Populated by backend when processing live data diffs; read by frontend for Feed subpage.
CREATE TABLE IF NOT EXISTS gameweek_feed_events (
  id BIGSERIAL PRIMARY KEY,
  gameweek INTEGER NOT NULL REFERENCES gameweeks(id),
  player_id INTEGER NOT NULL REFERENCES players(fpl_player_id),
  fixture_id INTEGER,
  event_type TEXT NOT NULL,
  points_delta INTEGER NOT NULL,
  total_points_after INTEGER NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_gameweek_feed_events_gw_occurred
  ON gameweek_feed_events (gameweek, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_gameweek_feed_events_gw_player
  ON gameweek_feed_events (gameweek, player_id);

COMMENT ON TABLE gameweek_feed_events IS
  'Point-impacting events (goals, assists, bonus changes, etc.) detected during live refresh. One timeline per gameweek; owned-by-viewer is derived client-side from manager_picks.';
