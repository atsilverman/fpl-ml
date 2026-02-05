-- View: team-level attack and defence strength (1-5) from actual performance.
-- Uses goals, xG, xGI (attack) and goals conceded, xGC (defence) from player_gameweek_stats
-- over finished gameweeks. Baseline for schedule difficulty that users can override.
-- Attack: 5 = best attack (hardest to defend). Defence: 5 = best defence (hardest to score against).

CREATE OR REPLACE VIEW v_team_calculated_strength AS
WITH finished_gw AS (
  SELECT id AS gameweek FROM gameweeks WHERE finished = true
),
-- Per team per gameweek: one row per (team_id, gameweek)
team_per_gw AS (
  SELECT
    pgs.team_id,
    pgs.gameweek,
    SUM(pgs.goals_scored)::numeric          AS team_goals,
    SUM(pgs.expected_goals)::numeric       AS team_xg,
    SUM(pgs.expected_goal_involvements)::numeric AS team_xgi,
    MAX(pgs.goals_conceded)::numeric       AS team_goals_conceded,
    MAX(pgs.expected_goals_conceded)::numeric AS team_xgc
  FROM player_gameweek_stats pgs
  JOIN finished_gw f ON f.gameweek = pgs.gameweek
  GROUP BY pgs.team_id, pgs.gameweek
),
-- Season totals per team
team_totals AS (
  SELECT
    team_id,
    SUM(team_goals) AS total_goals,
    SUM(team_xg) AS total_xg,
    SUM(team_xgi) AS total_xgi,
    SUM(team_goals_conceded) AS total_goals_conceded,
    SUM(team_xgc) AS total_xgc,
    COUNT(*) AS games
  FROM team_per_gw
  GROUP BY team_id
),
-- Per-game rates (avoid div by zero)
team_rates AS (
  SELECT
    team_id,
    games,
    CASE WHEN games > 0 THEN total_goals / games ELSE 0 END AS goals_pg,
    CASE WHEN games > 0 THEN total_xg / games ELSE 0 END AS xg_pg,
    CASE WHEN games > 0 THEN total_xgi / games ELSE 0 END AS xgi_pg,
    CASE WHEN games > 0 THEN total_goals_conceded / games ELSE 0 END AS goals_conceded_pg,
    CASE WHEN games > 0 THEN total_xgc / games ELSE 0 END AS xgc_pg
  FROM team_totals
),
-- Attack: weighted combo (goals matter most, then xG, then xGI). Higher = better.
attack_raw AS (
  SELECT
    team_id,
    (0.40 * goals_pg + 0.35 * xg_pg + 0.25 * xgi_pg) AS raw
  FROM team_rates
),
attack_scaled AS (
  SELECT
    team_id,
    raw,
    MIN(raw) OVER () AS min_raw,
    MAX(raw) OVER () AS max_raw
  FROM attack_raw
),
-- Defence: weighted combo of goals_conceded and xGC. Lower = better, so we invert for 1-5.
defence_raw AS (
  SELECT
    team_id,
    (0.60 * goals_conceded_pg + 0.40 * xgc_pg) AS raw
  FROM team_rates
),
defence_scaled AS (
  SELECT
    team_id,
    raw,
    MIN(raw) OVER () AS min_raw,
    MAX(raw) OVER () AS max_raw
  FROM defence_raw
)
SELECT
  a.team_id,
  GREATEST(1, LEAST(5, CASE
    WHEN a.max_raw > a.min_raw THEN ROUND(1 + (4 * (a.raw - a.min_raw) / (a.max_raw - a.min_raw)))::integer
    ELSE 3
  END)) AS calculated_attack,
  GREATEST(1, LEAST(5, CASE
    WHEN d.max_raw > d.min_raw THEN ROUND(5 - (4 * (d.raw - d.min_raw) / (d.max_raw - d.min_raw)))::integer
    ELSE 3
  END)) AS calculated_defence
FROM attack_scaled a
JOIN defence_scaled d ON d.team_id = a.team_id;

COMMENT ON VIEW v_team_calculated_strength IS
'Team attack/defence strength 1-5 from actual performance (goals, xG, xGI, goals conceded, xGC). Used as optional baseline in schedule difficulty customizer.';
