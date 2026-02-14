-- Function: get_player_compare_stat_ranks(p_player_id, p_gw_min, p_gw_max)
-- Returns JSONB of stat_key -> rank (1 = best) for the player over the gameweek range.
-- Used by Research Compare and Player Compare modal "Rank" toggle.
-- Ranks are by aggregate over the range: higherBetter stats rank DESC, lowerBetter (cards, xGC) rank ASC.

CREATE OR REPLACE FUNCTION get_player_compare_stat_ranks(
  p_player_id INTEGER,
  p_gw_min INTEGER,
  p_gw_max INTEGER
)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  WITH agg AS (
    SELECT
      player_id,
      SUM(total_points) AS points,
      SUM(minutes) AS minutes,
      SUM(goals_scored) AS goals_scored,
      SUM(assists) AS assists,
      SUM(clean_sheets) AS clean_sheets,
      SUM(saves) AS saves,
      SUM(bps) AS bps,
      SUM(bonus) AS bonus,
      SUM(defensive_contribution) AS defensive_contribution,
      SUM(yellow_cards) AS yellow_cards,
      SUM(red_cards) AS red_cards,
      SUM(COALESCE(expected_goals, 0)) AS expected_goals,
      SUM(COALESCE(expected_assists, 0)) AS expected_assists,
      SUM(COALESCE(expected_goal_involvements, 0)) AS expected_goal_involvements,
      SUM(COALESCE(expected_goals_conceded, 0)) AS expected_goals_conceded
    FROM player_gameweek_stats
    WHERE gameweek BETWEEN p_gw_min AND p_gw_max
    GROUP BY player_id
  ),
  with_ranks AS (
    SELECT
      player_id,
      ROW_NUMBER() OVER (ORDER BY points DESC NULLS LAST) AS rank_points,
      ROW_NUMBER() OVER (ORDER BY minutes DESC NULLS LAST) AS rank_minutes,
      ROW_NUMBER() OVER (ORDER BY goals_scored DESC NULLS LAST) AS rank_goals_scored,
      ROW_NUMBER() OVER (ORDER BY assists DESC NULLS LAST) AS rank_assists,
      ROW_NUMBER() OVER (ORDER BY clean_sheets DESC NULLS LAST) AS rank_clean_sheets,
      ROW_NUMBER() OVER (ORDER BY saves DESC NULLS LAST) AS rank_saves,
      ROW_NUMBER() OVER (ORDER BY bps DESC NULLS LAST) AS rank_bps,
      ROW_NUMBER() OVER (ORDER BY bonus DESC NULLS LAST) AS rank_bonus,
      ROW_NUMBER() OVER (ORDER BY defensive_contribution DESC NULLS LAST) AS rank_defensive_contribution,
      ROW_NUMBER() OVER (ORDER BY yellow_cards ASC NULLS LAST, player_id) AS rank_yellow_cards,
      ROW_NUMBER() OVER (ORDER BY red_cards ASC NULLS LAST, player_id) AS rank_red_cards,
      ROW_NUMBER() OVER (ORDER BY expected_goals DESC NULLS LAST) AS rank_expected_goals,
      ROW_NUMBER() OVER (ORDER BY expected_assists DESC NULLS LAST) AS rank_expected_assists,
      ROW_NUMBER() OVER (ORDER BY expected_goal_involvements DESC NULLS LAST) AS rank_expected_goal_involvements,
      ROW_NUMBER() OVER (ORDER BY expected_goals_conceded ASC NULLS LAST, player_id) AS rank_expected_goals_conceded
    FROM agg
  )
  SELECT jsonb_build_object(
    'points', rank_points,
    'minutes', rank_minutes,
    'goals_scored', rank_goals_scored,
    'assists', rank_assists,
    'clean_sheets', rank_clean_sheets,
    'saves', rank_saves,
    'bps', rank_bps,
    'bonus', rank_bonus,
    'defensive_contribution', rank_defensive_contribution,
    'yellow_cards', rank_yellow_cards,
    'red_cards', rank_red_cards,
    'expected_goals', rank_expected_goals,
    'expected_assists', rank_expected_assists,
    'expected_goal_involvements', rank_expected_goal_involvements,
    'expected_goals_conceded', rank_expected_goals_conceded
  )
  FROM with_ranks
  WHERE player_id = p_player_id
  LIMIT 1;
$$;

COMMENT ON FUNCTION get_player_compare_stat_ranks(INTEGER, INTEGER, INTEGER) IS
'Returns stat keys to rank (1=best) for one player over a gameweek range. Used by Compare subpage Rank toggle.';
