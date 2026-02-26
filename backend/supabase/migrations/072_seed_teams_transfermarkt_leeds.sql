-- Add Leeds (LEE) so "record vs opponent" includes Haaland vs Leeds etc.
UPDATE teams SET transfermarkt_club_id = 399 WHERE short_name = 'LEE';
