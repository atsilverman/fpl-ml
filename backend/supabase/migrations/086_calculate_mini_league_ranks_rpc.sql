-- Batched mini league rank calculation (replaces Python N+1 loop).
-- Reduces ~186 round trips to 1 RPC per league.
-- Tie-break: total_points DESC, manager_id ASC. Tied managers get same rank (RANK semantics).

CREATE OR REPLACE FUNCTION calculate_mini_league_ranks(p_league_id BIGINT, p_gameweek INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_prev_gw INTEGER;
  v_updated INTEGER;
BEGIN
  v_prev_gw := p_gameweek - 1;

  WITH ranked AS (
    -- Current GW: managers in league with total_points; previous_rank from baseline or prev GW
    SELECT
      mgh.manager_id,
      mgh.total_points,
      COALESCE(
        mgh.previous_mini_league_rank,
        mgh_prev.mini_league_rank
      ) AS prev_rank
    FROM mini_league_managers mlm
    JOIN manager_gameweek_history mgh ON mgh.manager_id = mlm.manager_id AND mgh.gameweek = p_gameweek
    LEFT JOIN manager_gameweek_history mgh_prev
      ON mgh_prev.manager_id = mgh.manager_id AND mgh_prev.gameweek = v_prev_gw AND v_prev_gw >= 1
    WHERE mlm.league_id = p_league_id
  ),
  with_current_rank AS (
    -- RANK() gives 1,1,3 for ties (same rank, skip next)
    SELECT
      manager_id,
      total_points,
      prev_rank,
      RANK() OVER (ORDER BY total_points DESC, manager_id ASC)::INTEGER AS current_rank
    FROM ranked
  )
  UPDATE manager_gameweek_history mgh
  SET
    mini_league_rank = wcr.current_rank,
    mini_league_rank_change = CASE
      WHEN wcr.prev_rank IS NOT NULL THEN wcr.prev_rank - wcr.current_rank
      ELSE NULL
    END,
    updated_at = NOW()
  FROM with_current_rank wcr
  WHERE mgh.manager_id = wcr.manager_id
    AND mgh.gameweek = p_gameweek;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

COMMENT ON FUNCTION calculate_mini_league_ranks(BIGINT, INTEGER) IS
'Calculate and update mini_league_rank and mini_league_rank_change for all managers in a league. Single batched update. Called from Python during live refresh.';
