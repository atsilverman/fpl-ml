-- Player-Owned Leaderboard View
-- Computes cumulative points from starting positions only (no redundant storage)
-- Uses existing manager_picks and player_gameweek_stats tables

-- Helper function to calculate ownership periods from array of gameweeks
CREATE OR REPLACE FUNCTION calculate_ownership_periods(gameweeks INTEGER[])
RETURNS TEXT AS $$
DECLARE
  sorted_gws INTEGER[];
  periods TEXT[];
  start_gw INTEGER;
  end_gw INTEGER;
  i INTEGER;
BEGIN
  -- Sort gameweeks
  sorted_gws := ARRAY(SELECT unnest(gameweeks) ORDER BY 1);
  
  IF array_length(sorted_gws, 1) IS NULL THEN
    RETURN '';
  END IF;
  
  start_gw := sorted_gws[1];
  end_gw := sorted_gws[1];
  
  FOR i IN 2..array_length(sorted_gws, 1) LOOP
    IF sorted_gws[i] = sorted_gws[i-1] + 1 THEN
      -- Continuous
      end_gw := sorted_gws[i];
    ELSE
      -- Gap detected - end current period, start new one
      IF start_gw = end_gw THEN
        periods := array_append(periods, start_gw::TEXT);
      ELSE
        periods := array_append(periods, start_gw::TEXT || '-' || end_gw::TEXT);
      END IF;
      start_gw := sorted_gws[i];
      end_gw := sorted_gws[i];
    END IF;
  END LOOP;
  
  -- Add final period
  IF start_gw = end_gw THEN
    periods := array_append(periods, start_gw::TEXT);
  ELSE
    periods := array_append(periods, start_gw::TEXT || '-' || end_gw::TEXT);
  END IF;
  
  RETURN array_to_string(periods, ', ');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Main view: Player-Owned Leaderboard
-- Computes from existing manager_picks and player_gameweek_stats
CREATE OR REPLACE VIEW v_player_owned_leaderboard AS
WITH player_ownership AS (
  SELECT 
    mp.manager_id,
    -- Handle auto-subs: if player was auto-subbed in, track the substitute player
    -- Otherwise track the original player
    CASE 
      WHEN mp.was_auto_subbed_in AND mp.auto_sub_replaced_player_id IS NOT NULL 
        THEN mp.auto_sub_replaced_player_id
      ELSE mp.player_id
    END as effective_player_id,
    mp.gameweek,
    mp.position,
    mp.multiplier,
    mp.is_captain,
    mp.was_auto_subbed_in,
    mp.auto_sub_replaced_player_id,
    -- Get points: use substitute's points if auto-subbed, otherwise original player's points
    COALESCE(
      CASE 
        WHEN mp.was_auto_subbed_in AND mp.auto_sub_replaced_player_id IS NOT NULL THEN
          (SELECT total_points FROM player_gameweek_stats 
           WHERE player_id = mp.auto_sub_replaced_player_id 
           AND gameweek = mp.gameweek)
        ELSE pgs.total_points
      END,
      0
    ) as base_points
  FROM manager_picks mp
  -- Join for original player's points
  LEFT JOIN player_gameweek_stats pgs 
    ON mp.player_id = pgs.player_id 
    AND mp.gameweek = pgs.gameweek
  WHERE mp.position <= 11  -- Starting XI only (exclude bench)
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
GROUP BY po.manager_id, m.manager_name, po.effective_player_id, p.web_name, p.position;

-- Materialized view for better performance (optional, refresh as needed)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_player_owned_leaderboard AS
SELECT * FROM v_player_owned_leaderboard;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_pol_unique 
ON mv_player_owned_leaderboard(manager_id, player_id);

CREATE INDEX IF NOT EXISTS idx_mv_pol_manager_points 
ON mv_player_owned_leaderboard(manager_id, total_points DESC);

CREATE INDEX IF NOT EXISTS idx_mv_pol_manager_position 
ON mv_player_owned_leaderboard(manager_id, player_position, total_points DESC);

COMMENT ON VIEW v_player_owned_leaderboard IS 
'Player-Owned Leaderboard: Shows cumulative points from starting positions only. 
Computed from existing manager_picks and player_gameweek_stats tables - no redundant storage.
- Only includes players in starting XI (position <= 11)
- Excludes bench points (position > 11)
- Applies captain multipliers (x2 or x3)
- Handles auto-subs (substitute points count)
- Accumulates points across multiple ownership periods';

COMMENT ON MATERIALIZED VIEW mv_player_owned_leaderboard IS 
'Materialized view of player-owned leaderboard for better query performance. 
Refresh using refresh_player_owned_leaderboard() function.';

COMMENT ON FUNCTION calculate_ownership_periods(INTEGER[]) IS 
'Converts array of gameweeks to formatted ownership periods (e.g., [1,2,3,5,6,7] -> "1-3, 5-7")';
