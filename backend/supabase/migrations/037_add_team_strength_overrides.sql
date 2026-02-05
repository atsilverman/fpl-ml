-- User-overridable team strength (1-5) for schedule difficulty. When NULL or {}, use API defaults (teams.strength).

ALTER TABLE user_configurations
  ADD COLUMN IF NOT EXISTS team_strength_overrides JSONB DEFAULT NULL;

COMMENT ON COLUMN user_configurations.team_strength_overrides IS
  'Per-team strength overrides: { "team_id": strength_1_to_5, ... }. Only overridden teams; missing team = use teams.strength. NULL or {} = use system (API) defaults.';
