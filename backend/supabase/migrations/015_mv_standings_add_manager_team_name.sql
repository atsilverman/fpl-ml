-- Add manager_team_name to mv_mini_league_standings for display (FPL squad/entry name)
DROP MATERIALIZED VIEW IF EXISTS mv_mini_league_standings;
CREATE MATERIALIZED VIEW mv_mini_league_standings AS
SELECT 
  ml.league_id,
  m.manager_id,
  m.manager_name,
  m.manager_team_name,
  mgh.gameweek,
  mgh.gameweek_points,
  mgh.total_points,
  mgh.mini_league_rank,
  mgh.mini_league_rank_change,
  ROW_NUMBER() OVER (
    PARTITION BY ml.league_id, mgh.gameweek 
    ORDER BY mgh.total_points DESC, m.manager_id ASC
  ) as calculated_rank
FROM mini_leagues ml
JOIN mini_league_managers mlm ON ml.league_id = mlm.league_id
JOIN managers m ON mlm.manager_id = m.manager_id
JOIN manager_gameweek_history mgh ON m.manager_id = mgh.manager_id
WHERE mgh.gameweek = (SELECT id FROM gameweeks WHERE is_current = true);

CREATE UNIQUE INDEX idx_mv_standings_unique ON mv_mini_league_standings(league_id, manager_id, gameweek);
