-- User-overridable attack and defence strength (1-5) for schedule difficulty dimensions.

ALTER TABLE user_configurations
  ADD COLUMN IF NOT EXISTS team_attack_overrides JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS team_defence_overrides JSONB DEFAULT NULL;

COMMENT ON COLUMN user_configurations.team_attack_overrides IS
  'Per-team attack strength overrides (1-5). NULL or {} = use API defaults.';

COMMENT ON COLUMN user_configurations.team_defence_overrides IS
  'Per-team defence strength overrides (1-5). NULL or {} = use API defaults.';
