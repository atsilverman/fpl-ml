-- View: per-team accumulated stats over the last 6 finished gameweeks (G, xG, GC, xGC, CS)
-- with league rank 1-20 for each stat. Used in player detail modal to show next opponent's form.
-- Ranks: G, xG, CS = 1 is best (most). GC, xGC = 1 is best (fewest).

CREATE OR REPLACE VIEW v_team_last_6_stats AS
WITH last_6_gw AS (
  SELECT id AS gameweek
  FROM gameweeks
  WHERE finished = true
  ORDER BY id DESC
  LIMIT 6
),
-- Per team per fixture in those gameweeks (one row per team-fixture)
team_per_fixture AS (
  SELECT
    pgs.team_id,
    pgs.gameweek,
    pgs.fixture_id,
    SUM(COALESCE(pgs.goals_scored, 0))::numeric          AS team_goals,
    SUM(COALESCE(pgs.expected_goals, 0))::numeric       AS team_xg,
    MAX(COALESCE(pgs.goals_conceded, 0))::numeric        AS team_goals_conceded,
    MAX(COALESCE(pgs.expected_goals_conceded, 0))::numeric AS team_xgc,
    CASE WHEN MAX(COALESCE(pgs.goals_conceded, 0)) = 0 THEN 1 ELSE 0 END AS clean_sheet
  FROM player_gameweek_stats pgs
  JOIN last_6_gw f ON f.gameweek = pgs.gameweek
  WHERE pgs.fixture_id IS NOT NULL
  GROUP BY pgs.team_id, pgs.gameweek, pgs.fixture_id
),
-- Totals per team over last 6 GWs
team_totals AS (
  SELECT
    team_id,
    SUM(team_goals)::numeric          AS goals,
    SUM(team_xg)::numeric             AS xg,
    SUM(team_goals_conceded)::numeric  AS goals_conceded,
    SUM(team_xgc)::numeric            AS xgc,
    SUM(clean_sheet)::integer         AS clean_sheets
  FROM team_per_fixture
  GROUP BY team_id
),
-- Ranks: higher better for goals, xg, cs; lower better for gc, xgc
ranked AS (
  SELECT
    team_id,
    goals,
    xg,
    goals_conceded,
    xgc,
    clean_sheets,
    RANK() OVER (ORDER BY goals DESC NULLS LAST, team_id)       AS rank_goals,
    RANK() OVER (ORDER BY xg DESC NULLS LAST, team_id)          AS rank_xg,
    RANK() OVER (ORDER BY goals_conceded ASC NULLS LAST, team_id) AS rank_goals_conceded,
    RANK() OVER (ORDER BY xgc ASC NULLS LAST, team_id)          AS rank_xgc,
    RANK() OVER (ORDER BY clean_sheets DESC NULLS LAST, team_id) AS rank_clean_sheets
  FROM team_totals
)
SELECT
  team_id,
  goals,
  xg,
  goals_conceded,
  xgc,
  clean_sheets,
  rank_goals::integer,
  rank_xg::integer,
  rank_goals_conceded::integer,
  rank_xgc::integer,
  rank_clean_sheets::integer
FROM ranked;

COMMENT ON VIEW v_team_last_6_stats IS
'Team accumulated stats over last 6 finished gameweeks (G, xG, GC, xGC, CS) with league rank 1-20. Used in player detail modal for next opponent form.';
