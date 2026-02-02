-- Fix v_manager_player_gameweek_points: when a starter is auto-subbed OUT,
-- attribute that slot's points to the substitute. Detect subbed-out by
-- was_auto_subbed_out OR existence of a "subbed in" row (works for historical data).

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
        (SELECT total_points FROM player_gameweek_stats
         WHERE player_id = mp.auto_sub_replaced_player_id
         AND gameweek = mp.gameweek)
      WHEN mp.was_auto_subbed_out
        OR EXISTS (
          SELECT 1 FROM manager_picks sub
          WHERE sub.manager_id = mp.manager_id
            AND sub.gameweek = mp.gameweek
            AND sub.was_auto_subbed_in = true
            AND sub.auto_sub_replaced_player_id = mp.player_id
        ) THEN
        (SELECT pgs_sub.total_points
         FROM manager_picks sub
         JOIN player_gameweek_stats pgs_sub
           ON pgs_sub.player_id = sub.player_id AND pgs_sub.gameweek = sub.gameweek
         WHERE sub.manager_id = mp.manager_id
           AND sub.gameweek = mp.gameweek
           AND sub.was_auto_subbed_in = true
           AND sub.auto_sub_replaced_player_id = mp.player_id
         LIMIT 1)
      ELSE pgs.total_points
    END,
    0
  ) * COALESCE(mp.multiplier, 1))::INTEGER AS points
FROM manager_picks mp
LEFT JOIN player_gameweek_stats pgs
  ON mp.player_id = pgs.player_id
  AND mp.gameweek = pgs.gameweek
WHERE mp.position <= 11;

COMMENT ON VIEW v_manager_player_gameweek_points IS
'Per-gameweek points from starting XI only. When a starter is auto-subbed OUT, that slot counts the substitute''s points.';
