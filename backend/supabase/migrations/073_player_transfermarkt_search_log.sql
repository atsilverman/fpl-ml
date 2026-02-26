-- Log of Transfermarkt name-search attempts: which players were searched and whether we got a match.
CREATE TABLE IF NOT EXISTS player_transfermarkt_search_log (
  id bigserial PRIMARY KEY,
  fpl_player_id integer NOT NULL REFERENCES players(fpl_player_id) ON DELETE CASCADE,
  searched_at timestamptz NOT NULL DEFAULT now(),
  search_query text NOT NULL,
  status text NOT NULL CHECK (status IN ('matched', 'no_result', 'multiple_candidates', 'error')),
  transfermarkt_player_id integer NULL,
  transfermarkt_slug text NULL
);

CREATE INDEX IF NOT EXISTS idx_player_transfermarkt_search_log_fpl
  ON player_transfermarkt_search_log(fpl_player_id);
CREATE INDEX IF NOT EXISTS idx_player_transfermarkt_search_log_status
  ON player_transfermarkt_search_log(status);

COMMENT ON TABLE player_transfermarkt_search_log IS
  'One row per name-search attempt. status=matched: we upserted player_transfermarkt; others need review or retry.';

-- Allow frontend to read player_transfermarkt so we can show "View on Transfermarkt" link in player modal.
ALTER TABLE player_transfermarkt ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon select player_transfermarkt"
  ON player_transfermarkt
  FOR SELECT TO anon
  USING (true);
