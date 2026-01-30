-- Migration: Add Baseline Columns for Robust Baseline Preservation
-- 
-- This migration adds explicit baseline columns to preserve critical data
-- at gameweek start (post-deadline) that must not be overwritten during live updates.
--
-- CRITICAL: These baselines are captured once at deadline and preserved throughout
-- the gameweek to enable accurate delta calculations (rank changes, transfer impacts).

-- Add baseline columns to manager_gameweek_history
ALTER TABLE manager_gameweek_history
  -- Baseline total points (captured at deadline, preserved during live)
  ADD COLUMN IF NOT EXISTS baseline_total_points INTEGER,
  
  -- Previous gameweek ranks (captured at deadline, used for rank change calculation)
  ADD COLUMN IF NOT EXISTS previous_mini_league_rank INTEGER,
  ADD COLUMN IF NOT EXISTS previous_overall_rank INTEGER,
  
  -- Overall rank change (calculated from baseline)
  ADD COLUMN IF NOT EXISTS overall_rank_change INTEGER;

-- Add comments explaining baseline preservation
COMMENT ON COLUMN manager_gameweek_history.baseline_total_points IS 
'Baseline total points captured at gameweek deadline (post-deadline, pre-live).
Preserved throughout live matches. Only updated when gameweek finishes (FPL API authoritative value).
Used as foundation for cumulative total_points calculation during live matches.';

COMMENT ON COLUMN manager_gameweek_history.previous_mini_league_rank IS 
'Previous gameweek mini league rank captured at deadline. Used to calculate mini_league_rank_change.
Preserved throughout live matches. Never overwritten during live updates.';

COMMENT ON COLUMN manager_gameweek_history.previous_overall_rank IS 
'Previous gameweek overall rank captured at deadline. Used to calculate overall_rank_change.
Preserved throughout live matches. Never overwritten during live updates.';

COMMENT ON COLUMN manager_gameweek_history.overall_rank_change IS 
'Overall rank change calculated from baseline: previous_overall_rank - current overall_rank.
Positive = moved up (better rank, lower number), Negative = moved down (worse rank, higher number).';

-- Add baseline columns to manager_transfers for transfer point baselines
ALTER TABLE manager_transfers
  -- Baseline player points at deadline (preserved during live matches)
  ADD COLUMN IF NOT EXISTS player_in_points_baseline INTEGER,
  ADD COLUMN IF NOT EXISTS player_out_points_baseline INTEGER,
  ADD COLUMN IF NOT EXISTS point_impact_baseline INTEGER;

-- Add comments for transfer baselines
COMMENT ON COLUMN manager_transfers.player_in_points_baseline IS 
'Baseline points for player_in captured at deadline (or 0 if not yet played).
Preserved throughout live matches. Used to calculate transfer delta points.';

COMMENT ON COLUMN manager_transfers.player_out_points_baseline IS 
'Baseline points for player_out captured at deadline (or 0 if not yet played).
Preserved throughout live matches. Used to calculate transfer delta points.';

COMMENT ON COLUMN manager_transfers.point_impact_baseline IS 
'Baseline transfer point impact: player_in_points_baseline - player_out_points_baseline.
Preserved throughout live matches. Used to show transfer delta points at deadline.';

-- Create index for baseline queries
CREATE INDEX IF NOT EXISTS idx_mgh_baseline_total ON manager_gameweek_history(gameweek, baseline_total_points) 
  WHERE baseline_total_points IS NOT NULL;

-- Update existing rows to populate baselines from previous gameweek data
-- This is a one-time migration for existing data
DO $$
DECLARE
  current_gw INTEGER;
  prev_gw INTEGER;
BEGIN
  -- Get current gameweek
  SELECT id INTO current_gw FROM gameweeks WHERE is_current = true LIMIT 1;
  
  IF current_gw IS NOT NULL THEN
    prev_gw := current_gw - 1;
    
    -- Populate baselines for current gameweek from previous gameweek
    UPDATE manager_gameweek_history mgh_current
    SET 
      baseline_total_points = COALESCE(
        mgh_current.baseline_total_points,  -- Keep if already set
        mgh_prev.total_points  -- Use previous gameweek total
      ),
      previous_mini_league_rank = COALESCE(
        mgh_current.previous_mini_league_rank,  -- Keep if already set
        mgh_prev.mini_league_rank  -- Use previous gameweek rank
      ),
      previous_overall_rank = COALESCE(
        mgh_current.previous_overall_rank,  -- Keep if already set
        mgh_prev.overall_rank  -- Use previous gameweek rank
      )
    FROM manager_gameweek_history mgh_prev
    WHERE mgh_current.manager_id = mgh_prev.manager_id
      AND mgh_current.gameweek = current_gw
      AND mgh_prev.gameweek = prev_gw
      AND (mgh_current.baseline_total_points IS NULL 
           OR mgh_current.previous_mini_league_rank IS NULL 
           OR mgh_current.previous_overall_rank IS NULL);
    
    RAISE NOTICE 'Populated baselines for gameweek % from gameweek %', current_gw, prev_gw;
  END IF;
END $$;
