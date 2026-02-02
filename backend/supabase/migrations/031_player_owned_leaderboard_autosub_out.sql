-- Fix v_player_owned_leaderboard: when a starter is auto-subbed OUT, attribute that
-- slot's points to the substitute (the player who came in), not the player who left.
-- Detect "subbed out" by EITHER was_auto_subbed_out OR existence of a "subbed in" row
-- (auto_sub_replaced_player_id = this player), so it works even when was_auto_subbed_out
-- was never set for historical data.

CREATE OR REPLACE VIEW v_player_owned_leaderboard AS
WITH player_ownership AS (
  SELECT 
    mp.manager_id,
    -- Effective player: subbed-in (bench row, excluded); subbed-out -> sub; else original.
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
    END as effective_player_id,
    mp.gameweek,
    mp.position,
    mp.multiplier,
    mp.is_captain,
    mp.was_auto_subbed_in,
    mp.auto_sub_replaced_player_id,
    -- Points: subbed-out (or detected subbed-out) -> use sub's points; else original.
    COALESCE(
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
    ) as base_points
  FROM manager_picks mp
  LEFT JOIN player_gameweek_stats pgs 
    ON mp.player_id = pgs.player_id 
    AND mp.gameweek = pgs.gameweek
  WHERE mp.position <= 11
)
SELECT 
  po.manager_id,
  m.manager_name,
  po.effective_player_id as player_id,
  p.web_name as player_name,
  p.position as player_position,
  SUM(po.base_points * po.multiplier) as total_points,
  COUNT(DISTINCT po.gameweek) as gameweeks_owned,
  ARRAY_AGG(DISTINCT po.gameweek ORDER BY po.gameweek) as gameweeks_array,
  calculate_ownership_periods(ARRAY_AGG(DISTINCT po.gameweek ORDER BY po.gameweek)) as ownership_periods,
  ROUND(
    SUM(po.base_points * po.multiplier)::NUMERIC / 
    NULLIF(COUNT(DISTINCT po.gameweek), 0), 
    2
  ) as average_points_per_gw,
  COUNT(CASE WHEN po.is_captain THEN 1 END) as captain_weeks,
  MIN(po.gameweek) as first_owned_gw,
  MAX(po.gameweek) as last_owned_gw
FROM player_ownership po
JOIN managers m ON po.manager_id = m.manager_id
JOIN players p ON po.effective_player_id = p.fpl_player_id
WHERE po.effective_player_id IS NOT NULL
GROUP BY po.manager_id, m.manager_name, po.effective_player_id, p.web_name, p.position;

COMMENT ON VIEW v_player_owned_leaderboard IS 
'Player-Owned Leaderboard: Cumulative points from starting positions only.
- XI only (position <= 11). When a starter is auto-subbed OUT, that slot counts the substitute''s points.
- Captain multipliers and auto-subs (sub in/out) applied.';
