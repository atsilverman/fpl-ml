-- One-time cleanup: set bonus = 0 for rows where bonus_status is provisional but bonus is non-zero.
-- Prevents stale API/live bonus from being shown until FPL confirms; backend now writes 0 when provisional.

UPDATE player_gameweek_stats
SET bonus = 0,
    updated_at = NOW()
WHERE (bonus_status = 'provisional' OR bonus_status IS NULL)
  AND COALESCE(bonus, 0) != 0;
