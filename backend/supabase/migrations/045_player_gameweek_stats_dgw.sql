-- Allow multiple rows per (player_id, gameweek) when a player has multiple fixtures (DGW).
-- One row per (player_id, gameweek, fixture_id). Use fixture_id = 0 for legacy/single-fixture rows.

-- Backfill: treat null fixture_id as single-fixture (sentinel 0)
UPDATE player_gameweek_stats
SET fixture_id = 0
WHERE fixture_id IS NULL;

-- Drop old unique so we can have multiple rows per (player, gw)
ALTER TABLE player_gameweek_stats
DROP CONSTRAINT IF EXISTS player_gameweek_stats_player_id_gameweek_key;

-- New unique: one row per (player, gameweek, fixture). DGW = two rows with two fixture_ids.
ALTER TABLE player_gameweek_stats
ADD CONSTRAINT player_gameweek_stats_player_id_gameweek_fixture_id_key
UNIQUE (player_id, gameweek, fixture_id);

COMMENT ON CONSTRAINT player_gameweek_stats_player_id_gameweek_fixture_id_key ON player_gameweek_stats IS
'One row per player per gameweek per fixture. Single GW: one row (fixture_id = that fixture or 0). DGW: two rows with the two fixture_ids.';
