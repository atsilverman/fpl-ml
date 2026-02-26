-- Optional slug for Transfermarkt player URL (required for bilanz fetch).
ALTER TABLE player_transfermarkt
  ADD COLUMN IF NOT EXISTS transfermarkt_slug text NULL;

COMMENT ON COLUMN player_transfermarkt.transfermarkt_slug IS
  'Transfermarkt URL slug (e.g. erling-haaland). When set, bilanz URL is /{slug}/bilanz/spieler/{id}/wettbewerb/GB1.';
