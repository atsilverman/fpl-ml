-- FPL Database Schema Migration
-- Creates all core tables for FPL data tracking

-- 1. Teams table (MUST BE FIRST - needed by players table)
CREATE TABLE IF NOT EXISTS teams (
  team_id INTEGER PRIMARY KEY,  -- FPL team ID (1-20)
  team_name TEXT NOT NULL,      -- Full name: "Arsenal"
  short_name TEXT NOT NULL,     -- Abbreviation: "ARS" (used for badge filename)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teams_team_id ON teams(team_id);

COMMENT ON TABLE teams IS 
'Teams table stores team information from FPL API bootstrap-static.
- team_id: FPL team ID (1-20)
- team_name: Full team name (e.g., "Arsenal")
- short_name: Abbreviation (e.g., "ARS") - used directly as badge filename
- Badge path: /badges/{short_name}.svg (e.g., /badges/ARS.svg)
- Populated from FPL API /api/bootstrap-static/ → teams array
- Updates infrequently (only on season start or team changes)';

-- 2. Gameweeks table
CREATE TABLE IF NOT EXISTS gameweeks (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  deadline_time TIMESTAMPTZ NOT NULL,
  is_current BOOLEAN DEFAULT FALSE,
  is_previous BOOLEAN DEFAULT FALSE,
  is_next BOOLEAN DEFAULT FALSE,
  finished BOOLEAN DEFAULT FALSE,
  data_checked BOOLEAN DEFAULT FALSE,
  highest_score INTEGER,
  average_entry_score DECIMAL(5,2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gameweeks_is_current ON gameweeks(is_current) WHERE is_current = true;
CREATE INDEX IF NOT EXISTS idx_gameweeks_finished ON gameweeks(finished);

-- 3. Players table
CREATE TABLE IF NOT EXISTS players (
  fpl_player_id INTEGER PRIMARY KEY,
  first_name TEXT,
  second_name TEXT,
  web_name TEXT NOT NULL,
  team_id INTEGER NOT NULL,
  position INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_players_team_id ON players(team_id);
CREATE INDEX IF NOT EXISTS idx_players_position ON players(position);

-- 4. Player Gameweek Stats table
CREATE TABLE IF NOT EXISTS player_gameweek_stats (
  id BIGSERIAL PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(fpl_player_id),
  gameweek INTEGER NOT NULL REFERENCES gameweeks(id),
  
  -- Match Context
  fixture_id INTEGER,
  team_id INTEGER NOT NULL,
  opponent_team_id INTEGER,
  was_home BOOLEAN,
  kickoff_time TIMESTAMPTZ,
  
  -- Match Status
  minutes INTEGER DEFAULT 0,
  started BOOLEAN DEFAULT FALSE,
  
  -- Points (CRITICAL: Handles provisional bonus)
  total_points INTEGER DEFAULT 0,
  bonus INTEGER DEFAULT 0,
  bps INTEGER DEFAULT 0,
  bonus_status TEXT DEFAULT 'provisional',
  
  -- Attacking Stats
  goals_scored INTEGER DEFAULT 0,
  assists INTEGER DEFAULT 0,
  own_goals INTEGER DEFAULT 0,
  penalties_missed INTEGER DEFAULT 0,
  
  -- Defending Stats
  tackles INTEGER DEFAULT 0,
  clearances_blocks_interceptions INTEGER DEFAULT 0,
  recoveries INTEGER DEFAULT 0,
  defensive_contribution INTEGER DEFAULT 0,
  
  -- Goalkeeping Stats
  saves INTEGER DEFAULT 0,
  clean_sheets INTEGER DEFAULT 0,
  goals_conceded INTEGER DEFAULT 0,
  penalties_saved INTEGER DEFAULT 0,
  
  -- Cards
  yellow_cards INTEGER DEFAULT 0,
  red_cards INTEGER DEFAULT 0,
  
  -- Expected Stats
  expected_goals DECIMAL(5,2) DEFAULT 0,
  expected_assists DECIMAL(5,2) DEFAULT 0,
  expected_goal_involvements DECIMAL(5,2) DEFAULT 0,
  expected_goals_conceded DECIMAL(5,2) DEFAULT 0,
  
  -- ICT
  influence DECIMAL(5,2) DEFAULT 0,
  creativity DECIMAL(5,2) DEFAULT 0,
  threat DECIMAL(5,2) DEFAULT 0,
  ict_index DECIMAL(5,2) DEFAULT 0,
  
  -- Match Result
  team_h_score INTEGER,
  team_a_score INTEGER,
  match_finished BOOLEAN DEFAULT FALSE,
  match_finished_provisional BOOLEAN DEFAULT FALSE,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(player_id, gameweek)
);

CREATE INDEX IF NOT EXISTS idx_pgws_player_gw ON player_gameweek_stats(player_id, gameweek);
CREATE INDEX IF NOT EXISTS idx_pgws_gameweek ON player_gameweek_stats(gameweek);
CREATE INDEX IF NOT EXISTS idx_pgws_team_gw ON player_gameweek_stats(team_id, gameweek);
CREATE INDEX IF NOT EXISTS idx_pgws_bonus_status ON player_gameweek_stats(gameweek, bonus_status) WHERE bonus_status = 'provisional';

-- 5. Player Prices table
CREATE TABLE IF NOT EXISTS player_prices (
  id BIGSERIAL PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(fpl_player_id),
  gameweek INTEGER NOT NULL REFERENCES gameweeks(id),
  price_tenths INTEGER NOT NULL,
  price_change_tenths INTEGER DEFAULT 0,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recorded_date DATE NOT NULL DEFAULT CURRENT_DATE,
  
  UNIQUE(player_id, gameweek, recorded_date)
);

CREATE INDEX IF NOT EXISTS idx_player_prices_player_gw ON player_prices(player_id, gameweek);
CREATE INDEX IF NOT EXISTS idx_player_prices_recorded_at ON player_prices(recorded_at);

-- 6. Managers table
CREATE TABLE IF NOT EXISTS managers (
  manager_id BIGINT PRIMARY KEY,
  manager_name TEXT NOT NULL,
  favourite_team_id INTEGER,
  joined_time TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Manager Gameweek History table
CREATE TABLE IF NOT EXISTS manager_gameweek_history (
  id BIGSERIAL PRIMARY KEY,
  manager_id BIGINT NOT NULL REFERENCES managers(manager_id),
  gameweek INTEGER NOT NULL REFERENCES gameweeks(id),
  
  -- Points
  gameweek_points INTEGER NOT NULL DEFAULT 0,
  transfer_cost INTEGER DEFAULT 0,
  total_points INTEGER NOT NULL,
  
  -- Team Value
  team_value_tenths INTEGER,
  bank_tenths INTEGER,
  
  -- Ranks
  overall_rank INTEGER,
  mini_league_rank INTEGER,
  mini_league_rank_change INTEGER,
  
  -- Transfers
  transfers_made INTEGER DEFAULT 0,
  active_chip TEXT,
  
  -- Status
  is_provisional BOOLEAN DEFAULT TRUE,
  data_status TEXT DEFAULT 'provisional',
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(manager_id, gameweek)
);

CREATE INDEX IF NOT EXISTS idx_mgh_manager_gw ON manager_gameweek_history(manager_id, gameweek);
CREATE INDEX IF NOT EXISTS idx_mgh_gameweek ON manager_gameweek_history(gameweek);
CREATE INDEX IF NOT EXISTS idx_mgh_total_points ON manager_gameweek_history(gameweek, total_points DESC);
CREATE INDEX IF NOT EXISTS idx_mgh_provisional ON manager_gameweek_history(gameweek, is_provisional) WHERE is_provisional = true;

-- 8. Manager Transfers table
CREATE TABLE IF NOT EXISTS manager_transfers (
  id BIGSERIAL PRIMARY KEY,
  manager_id BIGINT NOT NULL REFERENCES managers(manager_id),
  gameweek INTEGER NOT NULL REFERENCES gameweeks(id),
  
  -- Transfer Details
  player_in_id INTEGER NOT NULL REFERENCES players(fpl_player_id),
  player_out_id INTEGER NOT NULL REFERENCES players(fpl_player_id),
  transfer_time TIMESTAMPTZ NOT NULL,
  
  -- Prices at Time of Transfer
  price_in_tenths INTEGER NOT NULL,
  price_out_tenths INTEGER NOT NULL,
  net_price_change_tenths INTEGER NOT NULL,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(manager_id, gameweek, player_in_id, player_out_id)
);

CREATE INDEX IF NOT EXISTS idx_manager_transfers_manager_gw ON manager_transfers(manager_id, gameweek);
CREATE INDEX IF NOT EXISTS idx_manager_transfers_gameweek ON manager_transfers(gameweek);
CREATE INDEX IF NOT EXISTS idx_manager_transfers_net_change ON manager_transfers(gameweek, net_price_change_tenths DESC);

-- 9. Manager Picks table
CREATE TABLE IF NOT EXISTS manager_picks (
  id BIGSERIAL PRIMARY KEY,
  manager_id BIGINT NOT NULL REFERENCES managers(manager_id),
  gameweek INTEGER NOT NULL REFERENCES gameweeks(id),
  
  -- Pick Details
  player_id INTEGER NOT NULL REFERENCES players(fpl_player_id),
  position INTEGER NOT NULL,
  is_captain BOOLEAN DEFAULT FALSE,
  is_vice_captain BOOLEAN DEFAULT FALSE,
  multiplier INTEGER DEFAULT 1,
  
  -- Auto-Sub Status
  was_auto_subbed_out BOOLEAN DEFAULT FALSE,
  was_auto_subbed_in BOOLEAN DEFAULT FALSE,
  auto_sub_replaced_player_id INTEGER,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(manager_id, gameweek, position)
);

CREATE INDEX IF NOT EXISTS idx_manager_picks_manager_gw ON manager_picks(manager_id, gameweek);
CREATE INDEX IF NOT EXISTS idx_manager_picks_player_gw ON manager_picks(player_id, gameweek);

-- 10. Fixtures table
CREATE TABLE IF NOT EXISTS fixtures (
  fpl_fixture_id INTEGER PRIMARY KEY,
  gameweek INTEGER NOT NULL REFERENCES gameweeks(id),
  
  -- Teams
  home_team_id INTEGER NOT NULL,
  away_team_id INTEGER NOT NULL,
  
  -- Scores
  home_score INTEGER,
  away_score INTEGER,
  
  -- Status
  started BOOLEAN DEFAULT FALSE,
  finished BOOLEAN DEFAULT FALSE,
  finished_provisional BOOLEAN DEFAULT FALSE,
  minutes INTEGER DEFAULT 0,
  
  -- Timing
  kickoff_time TIMESTAMPTZ NOT NULL,
  deadline_time TIMESTAMPTZ,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fixtures_gameweek ON fixtures(gameweek);
CREATE INDEX IF NOT EXISTS idx_fixtures_finished ON fixtures(finished, finished_provisional);
CREATE INDEX IF NOT EXISTS idx_fixtures_teams ON fixtures(home_team_id, away_team_id);

-- 11. Mini Leagues table
CREATE TABLE IF NOT EXISTS mini_leagues (
  league_id BIGINT PRIMARY KEY,
  league_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 12. Mini League Managers table
CREATE TABLE IF NOT EXISTS mini_league_managers (
  league_id BIGINT NOT NULL REFERENCES mini_leagues(league_id),
  manager_id BIGINT NOT NULL REFERENCES managers(manager_id),
  joined_time TIMESTAMPTZ,
  PRIMARY KEY (league_id, manager_id)
);

CREATE INDEX IF NOT EXISTS idx_mlm_league ON mini_league_managers(league_id);
CREATE INDEX IF NOT EXISTS idx_mlm_manager ON mini_league_managers(manager_id);

-- 13. Player Whitelist table
CREATE TABLE IF NOT EXISTS player_whitelist (
  id BIGSERIAL PRIMARY KEY,
  league_id BIGINT NOT NULL REFERENCES mini_leagues(league_id),
  gameweek INTEGER NOT NULL REFERENCES gameweeks(id),
  player_id INTEGER NOT NULL REFERENCES players(fpl_player_id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(league_id, gameweek, player_id)
);

CREATE INDEX IF NOT EXISTS idx_player_whitelist_league_gw ON player_whitelist(league_id, gameweek);
CREATE INDEX IF NOT EXISTS idx_player_whitelist_player ON player_whitelist(player_id);
