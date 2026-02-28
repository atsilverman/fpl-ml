-- When captain is auto-subbed out, FPL gives the vice-captain the captain multiplier (2x or 3x).
-- Use effective multiplier: ex-captain slot = 1, vice-captain slot = captain multiplier; else mp.multiplier.

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
          + CASE WHEN pgs.bonus_status = 'confirmed' OR COALESCE(pgs.bonus, 0) > 0 THEN 0 ELSE COALESCE(pgs.provisional_bonus, 0) END
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
          + CASE WHEN pgs_sub.bonus_status = 'confirmed' OR COALESCE(pgs_sub.bonus, 0) > 0 THEN 0 ELSE COALESCE(pgs_sub.provisional_bonus, 0) END
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
          + CASE WHEN pgs.bonus_status = 'confirmed' OR COALESCE(pgs.bonus, 0) > 0 THEN 0 ELSE COALESCE(pgs.provisional_bonus, 0) END
        ), 0) FROM player_gameweek_stats pgs
         WHERE pgs.player_id = mp.player_id AND pgs.gameweek = mp.gameweek)
    END,
    0
  )::INTEGER * (
    CASE
      WHEN mp.is_captain AND (
        mp.was_auto_subbed_out
        OR EXISTS (
          SELECT 1 FROM manager_picks s
          WHERE s.manager_id = mp.manager_id AND s.gameweek = mp.gameweek
            AND s.was_auto_subbed_in = true AND s.auto_sub_replaced_player_id = mp.player_id
        )
      ) THEN 1
      WHEN mp.is_vice_captain
        AND NOT (mp.was_auto_subbed_out OR EXISTS (
          SELECT 1 FROM manager_picks s0
          WHERE s0.manager_id = mp.manager_id AND s0.gameweek = mp.gameweek
            AND s0.was_auto_subbed_in = true AND s0.auto_sub_replaced_player_id = mp.player_id
        ))
        AND EXISTS (
        SELECT 1 FROM manager_picks cap
        WHERE cap.manager_id = mp.manager_id AND cap.gameweek = mp.gameweek
          AND cap.position <= 11 AND cap.is_captain = true
          AND (
            cap.was_auto_subbed_out
            OR EXISTS (
              SELECT 1 FROM manager_picks s2
              WHERE s2.manager_id = cap.manager_id AND s2.gameweek = cap.gameweek
                AND s2.was_auto_subbed_in = true AND s2.auto_sub_replaced_player_id = cap.player_id
            )
          )
      ) THEN (
        SELECT COALESCE(cap.multiplier, 2)
        FROM manager_picks cap
        WHERE cap.manager_id = mp.manager_id AND cap.gameweek = mp.gameweek
          AND cap.position <= 11 AND cap.is_captain = true
        LIMIT 1
      )
      ELSE COALESCE(mp.multiplier, 1)
    END
  )::INTEGER)::INTEGER AS points
FROM manager_picks mp
WHERE mp.position <= 11;

COMMENT ON VIEW v_manager_player_gameweek_points IS
'Single source of truth: per-GW points from starting XI including provisional or official bonus. When captain is auto-subbed out, vice-captain gets captain multiplier (2x or 3x); ex-captain slot uses 1x.';
