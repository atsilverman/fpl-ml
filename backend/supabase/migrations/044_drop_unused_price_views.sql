-- Drop unused price views. App uses only player_price_changes_by_date for "Actual by day".
-- player_price_risers_latest and player_price_changes_latest were never used in UI; latest_price_snapshot_date only supported them.
DROP VIEW IF EXISTS player_price_risers_latest;
DROP VIEW IF EXISTS player_price_changes_latest;
DROP VIEW IF EXISTS latest_price_snapshot_date;
