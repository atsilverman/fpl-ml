-- BPS snapshots: one row per (fixture, player, recorded_at) each time we refresh stats.
-- Enables chronological BPS line graph per fixture (BPS over time, one line per player, colorized by bonus).

CREATE TABLE IF NOT EXISTS bps_snapshots (
  id BIGSERIAL PRIMARY KEY,
  gameweek INTEGER NOT NULL REFERENCES gameweeks(id),
  fixture_id INTEGER NOT NULL,
  player_id INTEGER NOT NULL REFERENCES players(fpl_player_id),
  bps INTEGER NOT NULL DEFAULT 0,
  bonus INTEGER NOT NULL DEFAULT 0,
  provisional_bonus INTEGER NOT NULL DEFAULT 0,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bps_snapshots_fixture_recorded
  ON bps_snapshots (fixture_id, recorded_at ASC);

CREATE INDEX IF NOT EXISTS idx_bps_snapshots_gameweek_fixture
  ON bps_snapshots (gameweek, fixture_id);

COMMENT ON TABLE bps_snapshots IS
  'Append-only BPS per player per fixture per refresh. Populated on each stats refresh during live/provisional (and backfill). Used for Bonus subpage BPS-over-time line graph.';
