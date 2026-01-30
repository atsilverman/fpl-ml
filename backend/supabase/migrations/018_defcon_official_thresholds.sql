-- Official FPL DEFCON (defensive contribution) achieved thresholds per position.
-- Source: Premier League, "What's new in 2025/26 Fantasy: Defensive contributions"
-- https://www.premierleague.com/en/news/4361991/whats-new-in-202526-fantasy-defensive-contributions
--
-- Rules:
--   Goalkeepers: Cannot earn defensive contribution points → threshold 999 (never achieve badge).
--   Defenders:   10 defensive contributions (CBIT) to earn 2 FPL points.
--   Midfielders: 12 defensive contributions (CBIRT, includes recoveries) to earn 2 FPL points.
--   Forwards:    12 defensive contributions (CBIRT) to earn 2 FPL points.

UPDATE defcon_points_thresholds SET points_threshold = 999, updated_at = NOW() WHERE position = 1;  -- GK: never achieve
UPDATE defcon_points_thresholds SET points_threshold = 10,  updated_at = NOW() WHERE position = 2;  -- DEF: 10
UPDATE defcon_points_thresholds SET points_threshold = 12,  updated_at = NOW() WHERE position = 3;  -- MID: 12
UPDATE defcon_points_thresholds SET points_threshold = 12,  updated_at = NOW() WHERE position = 4;  -- FWD: 12

-- Re-backfill defcon_points_achieved using correct thresholds
UPDATE player_gameweek_stats s
SET defcon_points_achieved = (
  COALESCE(s.defensive_contribution, 0) >= COALESCE(
    (SELECT t.points_threshold FROM defcon_points_thresholds t WHERE t.position = p.position),
    999
  )
)
FROM players p
WHERE p.fpl_player_id = s.player_id;
