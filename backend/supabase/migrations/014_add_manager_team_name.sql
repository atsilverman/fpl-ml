-- Add manager team name (FPL squad/entry name) for display
-- FPL API: entry "name" and league standings "entry_name" are the team name
-- manager_name can remain the person name or legacy value

ALTER TABLE managers
  ADD COLUMN IF NOT EXISTS manager_team_name TEXT;

COMMENT ON COLUMN managers.manager_team_name IS
'FPL squad/entry name (e.g. "SoCal Big Guy FEPL"). Populated from entry/name or standings entry_name. Used for UI display instead of manager_name when set.';
