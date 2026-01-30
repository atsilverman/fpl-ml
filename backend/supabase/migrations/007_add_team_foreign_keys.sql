-- Migration: Add Missing Foreign Key Constraints for Team References
-- 
-- This migration adds foreign key constraints to ensure data integrity
-- for all team_id references across the database.

-- 1. Players table
ALTER TABLE players 
  ADD CONSTRAINT fk_players_team 
  FOREIGN KEY (team_id) REFERENCES teams(team_id);

-- 2. Player gameweek stats (team and opponent)
ALTER TABLE player_gameweek_stats 
  ADD CONSTRAINT fk_pgws_team 
  FOREIGN KEY (team_id) REFERENCES teams(team_id),
  ADD CONSTRAINT fk_pgws_opponent 
  FOREIGN KEY (opponent_team_id) REFERENCES teams(team_id);

-- 3. Managers table (favourite team)
ALTER TABLE managers 
  ADD CONSTRAINT fk_managers_favourite_team 
  FOREIGN KEY (favourite_team_id) REFERENCES teams(team_id);

-- 4. Fixtures table (home and away teams)
ALTER TABLE fixtures 
  ADD CONSTRAINT fk_fixtures_home_team 
  FOREIGN KEY (home_team_id) REFERENCES teams(team_id),
  ADD CONSTRAINT fk_fixtures_away_team 
  FOREIGN KEY (away_team_id) REFERENCES teams(team_id);

-- Add comments
COMMENT ON CONSTRAINT fk_players_team ON players IS 
'Foreign key constraint ensuring players.team_id references valid team';

COMMENT ON CONSTRAINT fk_pgws_team ON player_gameweek_stats IS 
'Foreign key constraint ensuring player_gameweek_stats.team_id references valid team';

COMMENT ON CONSTRAINT fk_pgws_opponent ON player_gameweek_stats IS 
'Foreign key constraint ensuring player_gameweek_stats.opponent_team_id references valid team';

COMMENT ON CONSTRAINT fk_managers_favourite_team ON managers IS 
'Foreign key constraint ensuring managers.favourite_team_id references valid team';

COMMENT ON CONSTRAINT fk_fixtures_home_team ON fixtures IS 
'Foreign key constraint ensuring fixtures.home_team_id references valid team';

COMMENT ON CONSTRAINT fk_fixtures_away_team ON fixtures IS 
'Foreign key constraint ensuring fixtures.away_team_id references valid team';
