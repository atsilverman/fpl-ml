-- Player record vs opponent (Premier League only), for Transfermarkt-style "record vs" stats.
-- Populated by a one-time or periodic scrape of Transfermarkt bilanz/wettbewerb/GB1 per player.
-- Requires player_transfermarkt mapping (fpl_player_id -> transfermarkt_player_id) and
-- teams.transfermarkt_club_id for opponent lookups.

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS transfermarkt_club_id integer NULL;

COMMENT ON COLUMN teams.transfermarkt_club_id IS
  'Transfermarkt club/verein ID for mapping scraped "record vs" rows to FPL team_id. Seed per season (e.g. ARS=11, LIV=31, MUN=985, MCI=281, CHE=631, TOT=148, ...).';

-- Mapping: FPL player -> Transfermarkt player (so we can scrape bilanz per player).
CREATE TABLE IF NOT EXISTS player_transfermarkt (
  fpl_player_id integer PRIMARY KEY REFERENCES players(fpl_player_id) ON DELETE CASCADE,
  transfermarkt_player_id integer NOT NULL,
  updated_at timestamptz DEFAULT now()
);

COMMENT ON TABLE player_transfermarkt IS
  'Maps FPL player_id to Transfermarkt player ID for scraping "record vs opponent" (bilanz). Populate via script or manual list.';

-- Premier League only: record vs each opponent (apps, W-D-L, goals, assists).
CREATE TABLE IF NOT EXISTS player_record_vs_opponent_pl (
  fpl_player_id integer NOT NULL REFERENCES players(fpl_player_id) ON DELETE CASCADE,
  opponent_team_id integer NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
  apps integer NOT NULL DEFAULT 0,
  wins integer NOT NULL DEFAULT 0,
  draws integer NOT NULL DEFAULT 0,
  losses integer NOT NULL DEFAULT 0,
  goals integer NOT NULL DEFAULT 0,
  assists integer NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (fpl_player_id, opponent_team_id)
);

CREATE INDEX IF NOT EXISTS idx_player_record_vs_opponent_pl_player
  ON player_record_vs_opponent_pl(fpl_player_id);

COMMENT ON TABLE player_record_vs_opponent_pl IS
  'Scraped from Transfermarkt player bilanz filtered by Premier League (wettbewerb/GB1). One row per (player, opponent).';
