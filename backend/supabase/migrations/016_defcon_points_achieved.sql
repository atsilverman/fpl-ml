-- Defcon achieved: when a player's DEF (defensive_contribution) meets or exceeds position-specific threshold.
-- Badge is shown on the DEF column only (e.g. midfield threshold 12 → Anderson with DEF 14 gets green border on 14).
-- Position thresholds: 1=GK, 2=DEF, 3=MID, 4=FWD. Migration 017 fixes trigger to use DEF if 016 was run with PTS.

-- 1. Config table: DEF threshold per position (FPL element_type 1–4)
CREATE TABLE IF NOT EXISTS defcon_points_thresholds (
  position INTEGER PRIMARY KEY CHECK (position BETWEEN 1 AND 4),
  points_threshold INTEGER NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE defcon_points_thresholds IS 'DEF (defensive_contribution) threshold per position to achieve "defcon" in a gameweek (1=GK, 2=DEF, 3=MID, 4=FWD)';

-- Official FPL 2025/26: DEF 10, MID/FWD 12; GK cannot earn DEFCON (see DEFCON_THRESHOLDS.md)
INSERT INTO defcon_points_thresholds (position, points_threshold) VALUES
  (1, 999), -- GK: cannot earn defensive contribution points (never achieve badge)
  (2, 10),  -- DEF: 10 CBIT to earn 2 pts
  (3, 12),  -- MID: 12 CBIRT to earn 2 pts
  (4, 12)   -- FWD: 12 CBIRT to earn 2 pts
ON CONFLICT (position) DO UPDATE SET
  points_threshold = EXCLUDED.points_threshold,
  updated_at = NOW();

-- 2. Store achievement on player_gameweek_stats (show green border on DEF column when true)
ALTER TABLE player_gameweek_stats
  ADD COLUMN IF NOT EXISTS defcon_points_achieved BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN player_gameweek_stats.defcon_points_achieved IS 'True when defensive_contribution (DEF) >= position threshold; show green border on DEF column';

-- 3. Trigger: set defcon_points_achieved from DEF column
CREATE OR REPLACE FUNCTION set_defcon_points_achieved()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  player_pos INTEGER;
  threshold_val INTEGER;
BEGIN
  SELECT position INTO player_pos
  FROM players
  WHERE fpl_player_id = NEW.player_id;

  IF player_pos IS NULL THEN
    NEW.defcon_points_achieved := FALSE;
    RETURN NEW;
  END IF;

  SELECT points_threshold INTO threshold_val
  FROM defcon_points_thresholds
  WHERE position = player_pos;

  IF threshold_val IS NULL THEN
    NEW.defcon_points_achieved := FALSE;
    RETURN NEW;
  END IF;

  NEW.defcon_points_achieved := (COALESCE(NEW.defensive_contribution, 0) >= threshold_val);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_defcon_points_achieved ON player_gameweek_stats;
CREATE TRIGGER trg_set_defcon_points_achieved
  BEFORE INSERT OR UPDATE OF total_points, defensive_contribution ON player_gameweek_stats
  FOR EACH ROW
  EXECUTE FUNCTION set_defcon_points_achieved();

-- 4. Backfill existing rows (from DEF column)
UPDATE player_gameweek_stats s
SET defcon_points_achieved = (
  COALESCE(s.defensive_contribution, 0) >= COALESCE(
    (SELECT t.points_threshold FROM defcon_points_thresholds t WHERE t.position = p.position),
    0
  )
)
FROM players p
WHERE p.fpl_player_id = s.player_id;
