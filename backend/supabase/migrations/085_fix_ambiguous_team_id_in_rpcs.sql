-- Fix "column reference team_id is ambiguous" in RPCs by avoiding RETURNS TABLE shadowing.
-- Uses non-conflicting column names (t_id/tid, g/gc, etc.) in inner queries.

-- 1) get_team_goals_from_fixtures
DROP FUNCTION IF EXISTS get_team_goals_from_fixtures(text, text);

CREATE OR REPLACE FUNCTION get_team_goals_from_fixtures(p_gw_filter TEXT, p_location TEXT)
RETURNS TABLE(team_id INT, goals INT, goals_conceded INT, games_played INT)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_current_gw INT;
  v_min_gw INT;
BEGIN
  SELECT COALESCE((SELECT id FROM gameweeks WHERE is_current = true LIMIT 1), 1) INTO v_current_gw;
  v_min_gw := CASE p_gw_filter
    WHEN 'last6'  THEN GREATEST(1, v_current_gw - 5)
    WHEN 'last12' THEN GREATEST(1, v_current_gw - 11)
    ELSE 1
  END;

  RETURN QUERY
  WITH finished_fixtures AS (
    SELECT f.gameweek, f.home_team_id, f.away_team_id, f.home_score, f.away_score
    FROM fixtures f
    WHERE (f.finished = true OR f.finished_provisional = true)
      AND f.home_score IS NOT NULL
      AND f.away_score IS NOT NULL
      AND f.gameweek >= v_min_gw
      AND f.gameweek <= v_current_gw
  ),
  filtered AS (
    SELECT hr.t_id, hr.g, hr.gc
    FROM (SELECT home_team_id AS t_id, home_score AS g, away_score AS gc, true AS was_home FROM finished_fixtures) hr
    WHERE (p_location = 'all') OR (p_location = 'home' AND hr.was_home)
    UNION ALL
    SELECT ar.t_id, ar.g, ar.gc
    FROM (SELECT away_team_id AS t_id, away_score AS g, home_score AS gc, false AS was_home FROM finished_fixtures) ar
    WHERE (p_location = 'all') OR (p_location = 'away' AND NOT ar.was_home)
  ),
  agg AS (
    SELECT f.t_id, COALESCE(SUM(f.g), 0)::INT AS sum_g, COALESCE(SUM(f.gc), 0)::INT AS sum_gc, COUNT(*)::INT AS gp
    FROM filtered f
    GROUP BY f.t_id
  )
  SELECT agg.t_id::INT, agg.sum_g, agg.sum_gc, agg.gp
  FROM agg;
END;
$$;

GRANT EXECUTE ON FUNCTION get_team_goals_from_fixtures(TEXT, TEXT) TO anon, authenticated;

-- 2) get_team_league_rankings
DROP FUNCTION IF EXISTS get_team_league_rankings(text, text);

CREATE OR REPLACE FUNCTION get_team_league_rankings(p_gw_filter TEXT, p_location TEXT)
RETURNS TABLE(
  team_id INT,
  table_position INT,
  points INT,
  goals_for INT,
  goals_against INT,
  goal_difference INT,
  rank_goals INT,
  rank_xg INT,
  rank_goals_conceded INT,
  rank_xgc INT
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_current_gw INT;
  v_min_gw INT;
BEGIN
  SELECT COALESCE((SELECT id FROM gameweeks WHERE is_current = true LIMIT 1), 1) INTO v_current_gw;
  v_min_gw := CASE p_gw_filter
    WHEN 'last6'  THEN GREATEST(1, v_current_gw - 5)
    WHEN 'last12' THEN GREATEST(1, v_current_gw - 11)
    ELSE 1
  END;

  RETURN QUERY
  WITH finished_fixtures AS (
    SELECT f.gameweek, f.home_team_id, f.away_team_id, f.home_score, f.away_score
    FROM fixtures f
    WHERE (f.finished = true OR f.finished_provisional = true)
      AND f.home_score IS NOT NULL
      AND f.away_score IS NOT NULL
      AND f.gameweek >= v_min_gw
      AND f.gameweek <= v_current_gw
  ),
  filtered_fixtures AS (
    SELECT hr.tid, hr.gf, hr.ga
    FROM (SELECT home_team_id AS tid, home_score AS gf, away_score AS ga, true AS was_home FROM finished_fixtures) hr
    WHERE (p_location = 'all') OR (p_location = 'home' AND hr.was_home)
    UNION ALL
    SELECT ar.tid, ar.gf, ar.ga
    FROM (SELECT away_team_id AS tid, away_score AS gf, home_score AS ga, false AS was_home FROM finished_fixtures) ar
    WHERE (p_location = 'all') OR (p_location = 'away' AND NOT ar.was_home)
  ),
  table_stats AS (
    SELECT ff.tid, SUM(CASE WHEN ff.gf > ff.ga THEN 3 WHEN ff.gf = ff.ga THEN 1 ELSE 0 END)::INT AS pts,
      SUM(ff.gf)::INT AS gf, SUM(ff.ga)::INT AS ga, (SUM(ff.gf) - SUM(ff.ga))::INT AS gd
    FROM filtered_fixtures ff
    GROUP BY ff.tid
  ),
  table_ranked AS (
    SELECT ts.tid, ts.pts, ts.gf, ts.ga, ts.gd,
      ROW_NUMBER() OVER (ORDER BY ts.pts DESC, ts.gd DESC, ts.gf DESC, ts.tid ASC)::INT AS pos
    FROM table_stats ts
  ),
  team_xg_per_fixture AS (
    SELECT pgs.team_id AS tid, pgs.gameweek, pgs.fixture_id,
      SUM(COALESCE(pgs.expected_goals, 0))::NUMERIC AS xg
    FROM player_gameweek_stats pgs
    WHERE pgs.team_id IS NOT NULL AND pgs.fixture_id IS NOT NULL
      AND pgs.gameweek >= v_min_gw AND pgs.gameweek <= v_current_gw
      AND ((p_location = 'all') OR (p_location = 'home' AND pgs.was_home = true) OR (p_location = 'away' AND pgs.was_home = false))
    GROUP BY pgs.team_id, pgs.gameweek, pgs.fixture_id
  ),
  team_xg_totals AS (
    SELECT tid, SUM(xg)::NUMERIC AS xg FROM team_xg_per_fixture GROUP BY tid
  ),
  gc_from_fixtures AS (
    SELECT u.tid, SUM(u.ga)::INT AS gc
    FROM (
      SELECT home_team_id AS tid, away_score AS ga, true AS was_home FROM finished_fixtures
      UNION ALL
      SELECT away_team_id AS tid, home_score AS ga, false AS was_home FROM finished_fixtures
    ) u
    WHERE (p_location = 'all') OR (p_location = 'home' AND u.was_home) OR (p_location = 'away' AND NOT u.was_home)
    GROUP BY u.tid
  ),
  xgc_from_def_gk AS (
    SELECT d.tid, COALESCE(SUM(d.xgc), 0)::NUMERIC AS xgc
    FROM (
      SELECT pgs.team_id AS tid, pgs.gameweek, pgs.fixture_id,
        MAX(COALESCE(pgs.expected_goals_conceded, 0))::NUMERIC AS xgc
      FROM player_gameweek_stats pgs
      JOIN players pl ON pl.fpl_player_id = pgs.player_id AND pl.position IN (1, 2)
      WHERE pgs.team_id IS NOT NULL
        AND pgs.gameweek >= v_min_gw AND pgs.gameweek <= v_current_gw
        AND ((p_location = 'all') OR (p_location = 'home' AND pgs.was_home = true) OR (p_location = 'away' AND pgs.was_home = false))
      GROUP BY pgs.team_id, pgs.gameweek, pgs.fixture_id
    ) d
    GROUP BY d.tid
  ),
  all_metrics AS (
    SELECT tr.tid, tr.pos, tr.pts, tr.gf, tr.ga, tr.gd,
      COALESCE(xg.xg, 0)::NUMERIC AS xg,
      COALESCE(gc.gc, 0)::INT AS gc,
      COALESCE(xgc.xgc, 0)::NUMERIC AS xgc
    FROM table_ranked tr
    LEFT JOIN team_xg_totals xg ON xg.tid = tr.tid
    LEFT JOIN gc_from_fixtures gc ON gc.tid = tr.tid
    LEFT JOIN xgc_from_def_gk xgc ON xgc.tid = tr.tid
  ),
  ranked AS (
    SELECT am.tid, am.pos, am.pts, am.gf, am.ga, am.gd,
      ROW_NUMBER() OVER (ORDER BY am.gf DESC NULLS LAST, am.tid)::INT AS r_goals,
      ROW_NUMBER() OVER (ORDER BY am.xg DESC NULLS LAST, am.tid)::INT AS r_xg,
      ROW_NUMBER() OVER (ORDER BY am.gc ASC NULLS LAST, am.tid)::INT AS r_gc,
      ROW_NUMBER() OVER (ORDER BY am.xgc ASC NULLS LAST, am.tid)::INT AS r_xgc
    FROM all_metrics am
  )
  SELECT r.tid::INT, r.pos, r.pts, r.gf, r.ga, r.gd, r.r_goals, r.r_xg, r.r_gc, r.r_xgc
  FROM ranked r;
END;
$$;

GRANT EXECUTE ON FUNCTION get_team_league_rankings(TEXT, TEXT) TO anon, authenticated;
