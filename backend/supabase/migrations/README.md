# Database Migrations

## Migration Files (Sequential Order)

Run these migrations in order for a fresh database setup:

1. **001_create_tables.sql** - Creates all core tables (13 tables including teams)
2. **002_create_materialized_views.sql** - Creates materialized views with indexes
3. **003_create_refresh_functions.sql** - Creates functions to refresh materialized views
4. **004_create_player_owned_leaderboard_view.sql** - Creates player-owned leaderboard view
5. **005_create_transfer_impacts_view.sql** - Creates transfer impacts materialized view
6. **006_add_baseline_columns.sql** - Adds baseline columns for data preservation
7. **007_add_team_foreign_keys.sql** - Adds foreign key constraints for team references
21. **021_manager_player_gameweek_points_mv.sql** - Per-GW points MV for Gantt gradient (All filter)
31. **031_player_owned_leaderboard_autosub_out.sql** - Fix player-owned leaderboard: when a starter is auto-subbed OUT, attribute that slot's points to the substitute (fixes inflated Total Points e.g. Haaland 349→291)

## Migration Details

### 001: Create Tables (13 tables)
- **Teams** (created first - needed by players)
- Gameweeks
- Players (references teams)
- Player Gameweek Stats
- Player Prices
- Managers
- Manager Gameweek History
- Manager Transfers
- Manager Picks
- Fixtures
- Mini Leagues
- Mini League Managers
- Player Whitelist

### 002: Create Materialized Views (4 views + indexes)
- mv_mini_league_standings
- mv_manager_gameweek_summary
- mv_player_gameweek_performance
- mv_league_transfer_aggregation (with unique index for concurrent refresh)

### 003: Create Refresh Functions (5 functions)
- refresh_mini_league_standings()
- refresh_manager_gameweek_summary()
- refresh_player_gameweek_performance()
- refresh_league_transfer_aggregation()
- refresh_all_materialized_views()

### 004: Player Owned Leaderboard
- mv_player_owned_leaderboard materialized view
- calculate_ownership_periods() function

### 005: Transfer Impacts View
- mv_manager_transfer_impacts materialized view
- Pre-calculates transfer point impacts

### 021: Manager Player Gameweek Points MV
- v_manager_player_gameweek_points view + mv_manager_player_gameweek_points
- One row per (manager_id, player_id, gameweek) with points (starting XI, auto-subs, multiplier)
- Used by frontend for Gantt gradient in "All" filter (single query instead of picks + stats)
- refresh_manager_player_gameweek_points() added; included in refresh_all_materialized_views()

### 006: Baseline Columns
- Adds baseline preservation columns to manager_gameweek_history
- Adds baseline columns to manager_transfers
- Populates existing data from previous gameweek

### 007: Foreign Key Constraints
- Adds foreign key constraints for all team_id references
- Ensures data integrity across tables

## Running Migrations

### Using Supabase SQL Editor

1. Go to Supabase Dashboard → SQL Editor
2. Run each migration file in order (001 → 007)
3. Copy and paste each file's contents
4. Execute each migration

### Using psql

```bash
psql $DATABASE_URL -f backend/supabase/migrations/001_create_tables.sql
psql $DATABASE_URL -f backend/supabase/migrations/002_create_materialized_views.sql
psql $DATABASE_URL -f backend/supabase/migrations/003_create_refresh_functions.sql
psql $DATABASE_URL -f backend/supabase/migrations/004_create_player_owned_leaderboard_view.sql
psql $DATABASE_URL -f backend/supabase/migrations/005_create_transfer_impacts_view.sql
psql $DATABASE_URL -f backend/supabase/migrations/006_add_baseline_columns.sql
psql $DATABASE_URL -f backend/supabase/migrations/007_add_team_foreign_keys.sql
```

## Verification

After running migrations, verify:

```sql
-- Check tables (should have 13 tables)
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- Check materialized views (should have 5 views)
SELECT matviewname 
FROM pg_matviews 
WHERE schemaname = 'public'
ORDER BY matviewname;

-- Check functions (should have 6 functions)
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_schema = 'public'
  AND routine_type = 'FUNCTION'
ORDER BY routine_name;
```

## Notes

- All migrations use `IF NOT EXISTS` for idempotency
- Migrations can be safely re-run
- Teams table is created first (needed by players table)
- Foreign keys are added last (after all tables exist)
- Baseline columns include data migration for existing rows
