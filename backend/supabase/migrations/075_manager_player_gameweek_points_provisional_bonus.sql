-- Include provisional bonus in manager player gameweek points when bonus not yet confirmed.
-- When bonus is confirmed, total_points already includes it; do not double-count.

CREATE OR REPLACE VIEW v_manager_player_gameweek_points AS
SELECT
  mp.manager_id,
  CASE
    WHEN mp.was_auto_subbed_in AND mp.auto_sub_replaced_player_id IS NOT NULL
      THEN mp.auto_sub_replaced_player_id
    WHEN mp.was_auto_subbed_out
      OR EXISTS (
        SELECT 1 FROM manager_picks sub
        WHERE sub.manager_id = mp.manager_id
          AND sub.gameweek = mp.gameweek
          AND sub.was_auto_subbed_in = true
          AND sub.auto_sub_replaced_player_id = mp.player_id
      ) THEN
      (SELECT sub.player_id
       FROM manager_picks sub
       WHERE sub.manager_id = mp.manager_id
         AND sub.gameweek = mp.gameweek
         AND sub.was_auto_subbed_in = true
         AND sub.auto_sub_replaced_player_id = mp.player_id
       LIMIT 1)
    ELSE mp.player_id
  END AS player_id,
  mp.gameweek,
  (COALESCE(
    CASE
      WHEN mp.was_auto_subbed_in AND mp.auto_sub_replaced_player_id IS NOT NULL THEN
        (SELECT COALESCE(SUM(
          pgs.total_points
          + CASE WHEN pgs.bonus_status = 'provisional' AND COALESCE(pgs.bonus, 0) = 0 THEN COALESCE(pgs.provisional_bonus, 0) ELSE 0 END
        ), 0) FROM player_gameweek_stats pgs
         WHERE pgs.player_id = mp.auto_sub_replaced_player_id
         AND pgs.gameweek = mp.gameweek)
      WHEN mp.was_auto_subbed_out
        OR EXISTS (
          SELECT 1 FROM manager_picks sub
          WHERE sub.manager_id = mp.manager_id
            AND sub.gameweek = mp.gameweek
            AND sub.was_auto_subbed_in = true
            AND sub.auto_sub_replaced_player_id = mp.player_id
        ) THEN
        (SELECT COALESCE(SUM(
          pgs_sub.total_points
          + CASE WHEN pgs_sub.bonus_status = 'provisional' AND COALESCE(pgs_sub.bonus, 0) = 0 THEN COALESCE(pgs_sub.provisional_bonus, 0) ELSE 0 END
        ), 0)
         FROM manager_picks sub
         JOIN player_gameweek_stats pgs_sub
           ON pgs_sub.player_id = sub.player_id AND pgs_sub.gameweek = sub.gameweek
         WHERE sub.manager_id = mp.manager_id
           AND sub.gameweek = mp.gameweek
           AND sub.was_auto_subbed_in = true
           AND sub.auto_sub_replaced_player_id = mp.player_id)
      ELSE
        (SELECT COALESCE(SUM(
          pgs.total_points
          + CASE WHEN pgs.bonus_status = 'provisional' AND COALESCE(pgs.bonus, 0) = 0 THEN COALESCE(pgs.provisional_bonus, 0) ELSE 0 END
        ), 0) FROM player_gameweek_stats pgs
         WHERE pgs.player_id = mp.player_id AND pgs.gameweek = mp.gameweek)
    END,
    0
  )::INTEGER * COALESCE(mp.multiplier, 1))::INTEGER AS points
FROM manager_picks mp
WHERE mp.position <= 11;

COMMENT ON VIEW v_manager_player_gameweek_points IS
'Per-gameweek points from starting XI only. When a starter is auto-subbed OUT, that slot counts the substitute''s points. DGW: sums total_points across fixture rows. Includes provisional bonus when bonus not yet confirmed (no double-count when confirmed).';
