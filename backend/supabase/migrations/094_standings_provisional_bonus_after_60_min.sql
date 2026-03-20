-- Gate provisional bonus in v_manager_player_gameweek_points until max(player minutes) in the fixture >= 60.
-- Aligns with home GW points and feed (backend); bonus/fixture UIs still use raw provisional_bonus from pgs.

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
          + CASE
              WHEN pgs.bonus_status = 'confirmed' OR COALESCE(pgs.bonus, 0) > 0 THEN 0
              WHEN (
                CASE
                  WHEN pgs.fixture_id IS NULL THEN COALESCE(pgs.minutes, 0)
                  ELSE (
                    SELECT COALESCE(MAX(p2.minutes), 0)
                    FROM player_gameweek_stats p2
                    WHERE p2.gameweek = pgs.gameweek
                      AND p2.fixture_id = pgs.fixture_id
                  )
                END
              ) >= 60
              THEN COALESCE(pgs.provisional_bonus, 0)
              ELSE 0
            END
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
          + CASE
              WHEN pgs_sub.bonus_status = 'confirmed' OR COALESCE(pgs_sub.bonus, 0) > 0 THEN 0
              WHEN (
                CASE
                  WHEN pgs_sub.fixture_id IS NULL THEN COALESCE(pgs_sub.minutes, 0)
                  ELSE (
                    SELECT COALESCE(MAX(p2.minutes), 0)
                    FROM player_gameweek_stats p2
                    WHERE p2.gameweek = pgs_sub.gameweek
                      AND p2.fixture_id = pgs_sub.fixture_id
                  )
                END
              ) >= 60
              THEN COALESCE(pgs_sub.provisional_bonus, 0)
              ELSE 0
            END
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
          + CASE
              WHEN pgs.bonus_status = 'confirmed' OR COALESCE(pgs.bonus, 0) > 0 THEN 0
              WHEN (
                CASE
                  WHEN pgs.fixture_id IS NULL THEN COALESCE(pgs.minutes, 0)
                  ELSE (
                    SELECT COALESCE(MAX(p2.minutes), 0)
                    FROM player_gameweek_stats p2
                    WHERE p2.gameweek = pgs.gameweek
                      AND p2.fixture_id = pgs.fixture_id
                  )
                END
              ) >= 60
              THEN COALESCE(pgs.provisional_bonus, 0)
              ELSE 0
            END
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
'Starting XI GW points: adds provisional_bonus only when max(player minutes) in that fixture row >= 60 (or bonus confirmed). Captain auto-sub / vice multiplier unchanged.';
