-- Replace compare stat ranks: support rank by total vs per90, use RANK() so ties get same rank
-- (next rank skips), and return _tie flag for each stat so UI can show "T-2".
-- Per-90 ranks only include players with minutes >= 90 in the range.

DROP FUNCTION IF EXISTS get_player_compare_stat_ranks(INTEGER, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION get_player_compare_stat_ranks(
  p_player_id INTEGER,
  p_gw_min INTEGER,
  p_gw_max INTEGER,
  p_rank_by TEXT DEFAULT 'total'
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
  per90_agg AS (
    SELECT
      player_id,
      points * 90.0 / NULLIF(minutes, 0) AS points_p90,
      goals_scored * 90.0 / NULLIF(minutes, 0) AS goals_scored_p90,
      assists * 90.0 / NULLIF(minutes, 0) AS assists_p90,
      clean_sheets * 90.0 / NULLIF(minutes, 0) AS clean_sheets_p90,
      saves * 90.0 / NULLIF(minutes, 0) AS saves_p90,
      bps * 90.0 / NULLIF(minutes, 0) AS bps_p90,
      bonus * 90.0 / NULLIF(minutes, 0) AS bonus_p90,
      defensive_contribution * 90.0 / NULLIF(minutes, 0) AS defensive_contribution_p90,
      yellow_cards * 90.0 / NULLIF(minutes, 0) AS yellow_cards_p90,
      red_cards * 90.0 / NULLIF(minutes, 0) AS red_cards_p90,
      expected_goals * 90.0 / NULLIF(minutes, 0) AS expected_goals_p90,
      expected_assists * 90.0 / NULLIF(minutes, 0) AS expected_assists_p90,
      expected_goal_involvements * 90.0 / NULLIF(minutes, 0) AS expected_goal_involvements_p90,
      expected_goals_conceded * 90.0 / NULLIF(minutes, 0) AS expected_goals_conceded_p90
    FROM agg
    WHERE minutes >= 90
  ),
  rank_source AS (
    SELECT
      a.player_id,
      CASE WHEN p_rank_by = 'per90' THEN p.points_p90 ELSE a.points::numeric END AS points_v,
      a.minutes AS minutes_v,
      CASE WHEN p_rank_by = 'per90' THEN p.goals_scored_p90 ELSE a.goals_scored::numeric END AS goals_scored_v,
      CASE WHEN p_rank_by = 'per90' THEN p.assists_p90 ELSE a.assists::numeric END AS assists_v,
      CASE WHEN p_rank_by = 'per90' THEN p.clean_sheets_p90 ELSE a.clean_sheets::numeric END AS clean_sheets_v,
      CASE WHEN p_rank_by = 'per90' THEN p.saves_p90 ELSE a.saves::numeric END AS saves_v,
      CASE WHEN p_rank_by = 'per90' THEN p.bps_p90 ELSE a.bps::numeric END AS bps_v,
      CASE WHEN p_rank_by = 'per90' THEN p.bonus_p90 ELSE a.bonus::numeric END AS bonus_v,
      CASE WHEN p_rank_by = 'per90' THEN p.defensive_contribution_p90 ELSE a.defensive_contribution::numeric END AS defensive_contribution_v,
      CASE WHEN p_rank_by = 'per90' THEN p.yellow_cards_p90 ELSE a.yellow_cards::numeric END AS yellow_cards_v,
      CASE WHEN p_rank_by = 'per90' THEN p.red_cards_p90 ELSE a.red_cards::numeric END AS red_cards_v,
      CASE WHEN p_rank_by = 'per90' THEN p.expected_goals_p90 ELSE a.expected_goals END AS expected_goals_v,
      CASE WHEN p_rank_by = 'per90' THEN p.expected_assists_p90 ELSE a.expected_assists END AS expected_assists_v,
      CASE WHEN p_rank_by = 'per90' THEN p.expected_goal_involvements_p90 ELSE a.expected_goal_involvements END AS expected_goal_involvements_v,
      CASE WHEN p_rank_by = 'per90' THEN p.expected_goals_conceded_p90 ELSE a.expected_goals_conceded END AS expected_goals_conceded_v
    FROM agg a
    LEFT JOIN per90_agg p ON p.player_id = a.player_id
    WHERE (p_rank_by = 'total') OR (p_rank_by = 'per90' AND p.player_id IS NOT NULL)
  ),
  with_ranks AS (
    SELECT
      player_id,
      RANK() OVER (ORDER BY points_v DESC NULLS LAST, player_id) AS rank_points,
      RANK() OVER (ORDER BY minutes_v DESC NULLS LAST, player_id) AS rank_minutes,
      RANK() OVER (ORDER BY goals_scored_v DESC NULLS LAST, player_id) AS rank_goals_scored,
      RANK() OVER (ORDER BY assists_v DESC NULLS LAST, player_id) AS rank_assists,
      RANK() OVER (ORDER BY clean_sheets_v DESC NULLS LAST, player_id) AS rank_clean_sheets,
      RANK() OVER (ORDER BY saves_v DESC NULLS LAST, player_id) AS rank_saves,
      RANK() OVER (ORDER BY bps_v DESC NULLS LAST, player_id) AS rank_bps,
      RANK() OVER (ORDER BY bonus_v DESC NULLS LAST, player_id) AS rank_bonus,
      RANK() OVER (ORDER BY defensive_contribution_v DESC NULLS LAST, player_id) AS rank_defensive_contribution,
      RANK() OVER (ORDER BY yellow_cards_v ASC NULLS LAST, player_id) AS rank_yellow_cards,
      RANK() OVER (ORDER BY red_cards_v ASC NULLS LAST, player_id) AS rank_red_cards,
      RANK() OVER (ORDER BY expected_goals_v DESC NULLS LAST, player_id) AS rank_expected_goals,
      RANK() OVER (ORDER BY expected_assists_v DESC NULLS LAST, player_id) AS rank_expected_assists,
      RANK() OVER (ORDER BY expected_goal_involvements_v DESC NULLS LAST, player_id) AS rank_expected_goal_involvements,
      RANK() OVER (ORDER BY expected_goals_conceded_v ASC NULLS LAST, player_id) AS rank_expected_goals_conceded
    FROM rank_source
  ),
  with_ties AS (
    SELECT
      player_id,
      rank_points, rank_minutes, rank_goals_scored, rank_assists, rank_clean_sheets, rank_saves,
      rank_bps, rank_bonus, rank_defensive_contribution, rank_yellow_cards, rank_red_cards,
      rank_expected_goals, rank_expected_assists, rank_expected_goal_involvements, rank_expected_goals_conceded,
      (COUNT(*) OVER (PARTITION BY rank_points)) > 1 AS tie_points,
      (COUNT(*) OVER (PARTITION BY rank_minutes)) > 1 AS tie_minutes,
      (COUNT(*) OVER (PARTITION BY rank_goals_scored)) > 1 AS tie_goals_scored,
      (COUNT(*) OVER (PARTITION BY rank_assists)) > 1 AS tie_assists,
      (COUNT(*) OVER (PARTITION BY rank_clean_sheets)) > 1 AS tie_clean_sheets,
      (COUNT(*) OVER (PARTITION BY rank_saves)) > 1 AS tie_saves,
      (COUNT(*) OVER (PARTITION BY rank_bps)) > 1 AS tie_bps,
      (COUNT(*) OVER (PARTITION BY rank_bonus)) > 1 AS tie_bonus,
      (COUNT(*) OVER (PARTITION BY rank_defensive_contribution)) > 1 AS tie_defensive_contribution,
      (COUNT(*) OVER (PARTITION BY rank_yellow_cards)) > 1 AS tie_yellow_cards,
      (COUNT(*) OVER (PARTITION BY rank_red_cards)) > 1 AS tie_red_cards,
      (COUNT(*) OVER (PARTITION BY rank_expected_goals)) > 1 AS tie_expected_goals,
      (COUNT(*) OVER (PARTITION BY rank_expected_assists)) > 1 AS tie_expected_assists,
      (COUNT(*) OVER (PARTITION BY rank_expected_goal_involvements)) > 1 AS tie_expected_goal_involvements,
      (COUNT(*) OVER (PARTITION BY rank_expected_goals_conceded)) > 1 AS tie_expected_goals_conceded
    FROM with_ranks
  )
  SELECT jsonb_build_object(
    'points', rank_points, 'points_tie', tie_points,
    'minutes', rank_minutes, 'minutes_tie', tie_minutes,
    'goals_scored', rank_goals_scored, 'goals_scored_tie', tie_goals_scored,
    'assists', rank_assists, 'assists_tie', tie_assists,
    'clean_sheets', rank_clean_sheets, 'clean_sheets_tie', tie_clean_sheets,
    'saves', rank_saves, 'saves_tie', tie_saves,
    'bps', rank_bps, 'bps_tie', tie_bps,
    'bonus', rank_bonus, 'bonus_tie', tie_bonus,
    'defensive_contribution', rank_defensive_contribution, 'defensive_contribution_tie', tie_defensive_contribution,
    'yellow_cards', rank_yellow_cards, 'yellow_cards_tie', tie_yellow_cards,
    'red_cards', rank_red_cards, 'red_cards_tie', tie_red_cards,
    'expected_goals', rank_expected_goals, 'expected_goals_tie', tie_expected_goals,
    'expected_assists', rank_expected_assists, 'expected_assists_tie', tie_expected_assists,
    'expected_goal_involvements', rank_expected_goal_involvements, 'expected_goal_involvements_tie', tie_expected_goal_involvements,
    'expected_goals_conceded', rank_expected_goals_conceded, 'expected_goals_conceded_tie', tie_expected_goals_conceded
  )
  FROM with_ties
  WHERE player_id = p_player_id
  LIMIT 1;
$$;

COMMENT ON FUNCTION get_player_compare_stat_ranks(INTEGER, INTEGER, INTEGER, TEXT) IS
'Returns stat keys to rank (1=best) and _tie for each, for one player over a gameweek range. p_rank_by: total | per90. Per90 only includes players with 90+ minutes. Uses RANK() so ties share rank and next rank skips.';
