-- Per-matchday rank baselines for stale warning (rank not yet updated for this matchday).
-- Matchday = distinct UTC date with at least one fixture; baselines captured before first kickoff of each matchday.

CREATE TABLE IF NOT EXISTS manager_gameweek_matchday_baselines (
  id BIGSERIAL PRIMARY KEY,
  manager_id INTEGER NOT NULL,
  gameweek INTEGER NOT NULL REFERENCES gameweeks(id),
  matchday_sequence SMALLINT NOT NULL,
  matchday_date DATE NOT NULL,
  first_kickoff_at TIMESTAMPTZ NOT NULL,
  overall_rank_baseline INTEGER,
  gameweek_rank_baseline INTEGER,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (manager_id, gameweek, matchday_sequence)
);

CREATE INDEX IF NOT EXISTS idx_matchday_baselines_gw_sequence
  ON manager_gameweek_matchday_baselines (gameweek, matchday_sequence);
CREATE INDEX IF NOT EXISTS idx_matchday_baselines_manager_gw
  ON manager_gameweek_matchday_baselines (manager_id, gameweek);

COMMENT ON TABLE manager_gameweek_matchday_baselines IS
'Rank baselines captured before the first kickoff of each matchday within a gameweek. Used to show stale warning when current rank equals baseline (FPL publishes ranks later in the day).';
COMMENT ON COLUMN manager_gameweek_matchday_baselines.matchday_sequence IS
'1 = first matchday in GW, 2 = second, etc. Derived from fixture kickoff dates.';
COMMENT ON COLUMN manager_gameweek_matchday_baselines.matchday_date IS
'UTC date of the first kickoff for this matchday.';
COMMENT ON COLUMN manager_gameweek_matchday_baselines.first_kickoff_at IS
'First kickoff time for this matchday (canonical slot).';
