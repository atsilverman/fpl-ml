-- Remove Transfermarkt "record vs opponent" feature: table, RLS policy, and teams.transfermarkt_club_id.
-- player_transfermarkt is kept for the "View on Transfermarkt" profile link.

DROP POLICY IF EXISTS "Allow anon select player_record_vs_opponent_pl" ON player_record_vs_opponent_pl;
DROP TABLE IF EXISTS player_record_vs_opponent_pl;

ALTER TABLE teams DROP COLUMN IF EXISTS transfermarkt_club_id;

COMMENT ON TABLE player_transfermarkt IS
  'Maps FPL player_id to Transfermarkt player ID and slug for "View on Transfermarkt" profile link.';

COMMENT ON COLUMN player_transfermarkt.transfermarkt_slug IS
  'Transfermarkt URL slug (e.g. erling-haaland) for profile URL.';
