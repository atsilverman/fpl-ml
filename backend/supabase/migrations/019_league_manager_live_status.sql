-- View: per (manager_id, gameweek) counts of "left to play" and "in play" for starting XI.
-- Left to play: owned players (position 1-11) with 0 minutes and match not started.
-- In play: owned players whose match is in progress (started and not finished).
-- Frontend filters by league managers and current gameweek.

CREATE OR REPLACE VIEW manager_live_status AS
WITH pick_fixture AS (
  SELECT
    mp.manager_id,
    mp.gameweek,
    mp.player_id,
    p.team_id,
    f.fpl_fixture_id,
    f.started   AS fixture_started,
    f.finished  AS fixture_finished,
    COALESCE(pgs.minutes, 0) AS minutes
  FROM manager_picks mp
  JOIN players p ON mp.player_id = p.fpl_player_id
  JOIN fixtures f ON f.gameweek = mp.gameweek
    AND (f.home_team_id = p.team_id OR f.away_team_id = p.team_id)
  LEFT JOIN player_gameweek_stats pgs ON pgs.player_id = mp.player_id
    AND pgs.gameweek = mp.gameweek
  WHERE mp.position <= 11
)
SELECT
  manager_id,
  gameweek,
  COUNT(*) FILTER (WHERE NOT fixture_started AND minutes = 0) AS left_to_play,
  COUNT(*) FILTER (WHERE fixture_started AND NOT fixture_finished) AS in_play
FROM pick_fixture
GROUP BY manager_id, gameweek;

COMMENT ON VIEW manager_live_status IS 'Per manager per gameweek: count of starting XI players left to play (match not started, 0 min) and in play (match started, not finished). Used by League page.';
