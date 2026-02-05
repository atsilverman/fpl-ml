-- Add remaining FPL team strength fields from bootstrap-static for future use
-- (fixture difficulty, attack/defence views). strength (1-5) remains the main one for schedule coloring.

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS strength_overall_home INTEGER,
  ADD COLUMN IF NOT EXISTS strength_overall_away INTEGER,
  ADD COLUMN IF NOT EXISTS strength_attack_home INTEGER,
  ADD COLUMN IF NOT EXISTS strength_attack_away INTEGER,
  ADD COLUMN IF NOT EXISTS strength_defence_home INTEGER,
  ADD COLUMN IF NOT EXISTS strength_defence_away INTEGER;

COMMENT ON COLUMN teams.strength_overall_home IS 'FPL API overall strength at home (e.g. 1300).';
COMMENT ON COLUMN teams.strength_overall_away IS 'FPL API overall strength away (e.g. 1375).';
COMMENT ON COLUMN teams.strength_attack_home IS 'FPL API attack strength at home.';
COMMENT ON COLUMN teams.strength_attack_away IS 'FPL API attack strength away.';
COMMENT ON COLUMN teams.strength_defence_home IS 'FPL API defence strength at home.';
COMMENT ON COLUMN teams.strength_defence_away IS 'FPL API defence strength away.';
