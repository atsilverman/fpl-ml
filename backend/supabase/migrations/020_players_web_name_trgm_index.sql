-- Speed up player name search (autocomplete) using ilike '%...%' on players.web_name.
-- pg_trgm provides trigram indexing so substring matches can use an index instead of a full scan.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_players_web_name_trgm
  ON players USING gin (web_name gin_trgm_ops);

COMMENT ON INDEX idx_players_web_name_trgm IS 'Supports fast ilike substring search on web_name for league ownership autocomplete';
