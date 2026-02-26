-- Seed teams.transfermarkt_club_id for Premier League teams (current and recent).
-- Used by refresh_player_record_vs_opponent_pl.py to map scraped bilanz rows to FPL team_id.
-- Only updates rows where short_name matches; safe to re-run. Add/change rows as teams change.

UPDATE teams SET transfermarkt_club_id = 11   WHERE short_name = 'ARS';
UPDATE teams SET transfermarkt_club_id = 405  WHERE short_name = 'AVL';
UPDATE teams SET transfermarkt_club_id = 989  WHERE short_name = 'BOU';
UPDATE teams SET transfermarkt_club_id = 1148 WHERE short_name = 'BRE';
UPDATE teams SET transfermarkt_club_id = 1237 WHERE short_name = 'BHA';
UPDATE teams SET transfermarkt_club_id = 1132 WHERE short_name = 'BUR';
UPDATE teams SET transfermarkt_club_id = 631  WHERE short_name = 'CHE';
UPDATE teams SET transfermarkt_club_id = 873  WHERE short_name = 'CRY';
UPDATE teams SET transfermarkt_club_id = 29   WHERE short_name = 'EVE';
UPDATE teams SET transfermarkt_club_id = 931  WHERE short_name = 'FUL';
UPDATE teams SET transfermarkt_club_id = 677  WHERE short_name = 'IPS';
UPDATE teams SET transfermarkt_club_id = 1003 WHERE short_name = 'LEI';
UPDATE teams SET transfermarkt_club_id = 31   WHERE short_name = 'LIV';
UPDATE teams SET transfermarkt_club_id = 1031 WHERE short_name = 'LUT';
UPDATE teams SET transfermarkt_club_id = 281  WHERE short_name = 'MCI';
UPDATE teams SET transfermarkt_club_id = 985  WHERE short_name = 'MUN';
UPDATE teams SET transfermarkt_club_id = 762  WHERE short_name = 'NEW';
UPDATE teams SET transfermarkt_club_id = 703  WHERE short_name = 'NFO';
UPDATE teams SET transfermarkt_club_id = 180  WHERE short_name = 'SOU';
UPDATE teams SET transfermarkt_club_id = 350  WHERE short_name = 'SHU';
UPDATE teams SET transfermarkt_club_id = 289  WHERE short_name = 'SUN';
UPDATE teams SET transfermarkt_club_id = 148  WHERE short_name = 'TOT';
UPDATE teams SET transfermarkt_club_id = 379  WHERE short_name = 'WHU';
UPDATE teams SET transfermarkt_club_id = 543  WHERE short_name = 'WOL';
