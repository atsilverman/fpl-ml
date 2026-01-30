-- Defcon is achieved on the DEF (defensive_contribution) column, not PTS.
-- When defensive_contribution >= position threshold, set defcon_points_achieved so UI shows green border on DEF value.
-- Thresholds stay in defcon_points_thresholds (e.g. MID 12 → Anderson with DEF 14 achieves).

-- 1. Update trigger to use defensive_contribution
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

-- 2. Trigger on defensive_contribution (and total_points for initial insert)
DROP TRIGGER IF EXISTS trg_set_defcon_points_achieved ON player_gameweek_stats;
CREATE TRIGGER trg_set_defcon_points_achieved
  BEFORE INSERT OR UPDATE OF total_points, defensive_contribution ON player_gameweek_stats
  FOR EACH ROW
  EXECUTE FUNCTION set_defcon_points_achieved();

-- 3. Comment: achievement is for DEF column
COMMENT ON COLUMN player_gameweek_stats.defcon_points_achieved IS 'True when defensive_contribution (DEF) >= position threshold; show green border on DEF column';

-- 4. Backfill from DEF column
UPDATE player_gameweek_stats s
SET defcon_points_achieved = (
  COALESCE(s.defensive_contribution, 0) >= COALESCE(
    (SELECT t.points_threshold FROM defcon_points_thresholds t WHERE t.position = p.position),
    0
  )
)
FROM players p
WHERE p.fpl_player_id = s.player_id;
