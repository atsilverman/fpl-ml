-- Backfill: set provisional_bonus = 0 for any player not in the top 3 by BPS in their fixture.
-- Fixes stale/wrong provisional_bonus (e.g. Dango, Virgil showing 1 in GW points when they are not top 3 BPS).
-- Only touches rows where bonus_status = 'provisional' and bonus = 0; only fixtures with fixture_id > 0.

UPDATE player_gameweek_stats p
SET provisional_bonus = 0,
    updated_at = NOW()
FROM (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY gameweek, fixture_id
      ORDER BY COALESCE(bps, 0) DESC, player_id ASC
    ) AS rn
  FROM player_gameweek_stats
  WHERE fixture_id IS NOT NULL AND fixture_id > 0
) ranked
WHERE p.id = ranked.id
  AND ranked.rn > 3
  AND (p.bonus_status = 'provisional' OR p.bonus_status IS NULL)
  AND COALESCE(p.bonus, 0) = 0
  AND COALESCE(p.provisional_bonus, 0) != 0;
