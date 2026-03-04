-- Returns team_ids that have been PL table rank 1 in at least one gameweek in 1..p_max_gw.
-- Used by team moving average chart to show leader lines.

CREATE OR REPLACE FUNCTION get_teams_ever_table_rank1(p_max_gw INT)
RETURNS TABLE(team_id INT)
LANGUAGE plpgsql
STABLE
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH gw_series AS (
    SELECT gs::INT AS gw FROM generate_series(1, LEAST(p_max_gw, 38)) AS gs
  ),
  rank1_per_gw AS (
    SELECT ff_agg.tid
    FROM gw_series g
    CROSS JOIN LATERAL (
      WITH finished_up_to AS (
        SELECT f.gameweek, f.home_team_id, f.away_team_id, f.home_score, f.away_score
        FROM fixtures f
        WHERE (f.finished = true OR f.finished_provisional = true)
          AND f.home_score IS NOT NULL
          AND f.away_score IS NOT NULL
          AND f.gameweek >= 1
          AND f.gameweek <= g.gw
      ),
      filtered AS (
        SELECT home_team_id AS t_id, home_score AS gf, away_score AS ga FROM finished_up_to
        UNION ALL
        SELECT away_team_id AS t_id, away_score AS gf, home_score AS ga FROM finished_up_to
      ),
      table_stats AS (
        SELECT t_id, SUM(CASE WHEN gf > ga THEN 3 WHEN gf = ga THEN 1 ELSE 0 END)::INT AS pts,
          SUM(gf)::INT AS gf, SUM(ga)::INT AS ga, (SUM(gf) - SUM(ga))::INT AS gd
        FROM filtered
        GROUP BY t_id
      ),
      ranked AS (
        SELECT t_id AS tid, ROW_NUMBER() OVER (ORDER BY pts DESC, gd DESC, gf DESC, t_id ASC)::INT AS pos
        FROM table_stats
      )
      SELECT ranked.tid FROM ranked WHERE pos = 1 LIMIT 1
    ) ff_agg(tid)
  )
  SELECT DISTINCT r.tid::INT AS team_id FROM rank1_per_gw r WHERE r.tid IS NOT NULL;
END;
$$;

COMMENT ON FUNCTION get_teams_ever_table_rank1(INT) IS 'Team IDs that were PL table rank 1 at least once in gameweeks 1..p_max_gw.';

GRANT EXECUTE ON FUNCTION get_teams_ever_table_rank1(INT) TO anon, authenticated;
