-- Migration: Add Gameweek Rank Column
-- 
-- This migration adds the gameweek_rank column to store the manager's
-- rank for the current gameweek. This data comes from the picks endpoint
-- (entry_history.rank) and is only refreshed after games finish.

ALTER TABLE manager_gameweek_history
  ADD COLUMN IF NOT EXISTS gameweek_rank INTEGER;

COMMENT ON COLUMN manager_gameweek_history.gameweek_rank IS 
'Manager rank for this specific gameweek (from picks endpoint entry_history.rank). Only refreshed after games finish.';
