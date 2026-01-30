# Database Migration Guide

## Migration Files Overview

The database schema is created in three migration files that must be run in order:

1. **001_create_tables.sql** - Creates all core tables (12 tables)
2. **002_create_materialized_views.sql** - Creates 4 materialized views for performance
3. **003_create_refresh_functions.sql** - Creates functions to refresh materialized views

## How to Run Migrations

### Option 1: Supabase SQL Editor (Recommended)

1. Go to your Supabase dashboard: https://supabase.com/dashboard/project/rjkgwyngnqgzqudqqzqi/sql/new

2. **Run Migration 1**: Copy the entire contents of `001_create_tables.sql` and paste into SQL Editor, then click "Run"

3. **Run Migration 2**: Copy the entire contents of `002_create_materialized_views.sql` and paste into SQL Editor, then click "Run"

4. **Run Migration 3**: Copy the entire contents of `003_create_refresh_functions.sql` and paste into SQL Editor, then click "Run"

### Option 2: Using Supabase CLI

```bash
# Install Supabase CLI if not already installed
npm install -g supabase

# Link to your project
supabase link --project-ref rjkgwyngnqgzqudqqzqi

# Run migrations
supabase db push
```

### Option 3: Using psql

```bash
# Get connection string from Supabase dashboard
# Settings → Database → Connection string → URI

psql "postgresql://postgres:[YOUR-PASSWORD]@db.rjkgwyngnqgzqudqqzqi.supabase.co:5432/postgres" < backend/supabase/migrations/001_create_tables.sql
psql "postgresql://postgres:[YOUR-PASSWORD]@db.rjkgwyngnqgzqudqqzqi.supabase.co:5432/postgres" < backend/supabase/migrations/002_create_materialized_views.sql
psql "postgresql://postgres:[YOUR-PASSWORD]@db.rjkgwyngnqgzqudqqzqi.supabase.co:5432/postgres" < backend/supabase/migrations/003_create_refresh_functions.sql
```

## Verification Queries

After running migrations, verify everything was created:

### Check Tables
```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_type = 'BASE TABLE'
ORDER BY table_name;
```

Expected tables:
- fixtures
- gameweeks
- manager_gameweek_history
- manager_picks
- manager_transfers
- managers
- mini_league_managers
- mini_leagues
- player_gameweek_stats
- player_prices
- player_whitelist
- players

### Check Materialized Views
```sql
SELECT matviewname 
FROM pg_matviews 
WHERE schemaname = 'public'
ORDER BY matviewname;
```

Expected views:
- mv_league_transfer_aggregation
- mv_manager_gameweek_summary
- mv_mini_league_standings
- mv_player_gameweek_performance

### Check Functions
```sql
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_schema = 'public'
  AND routine_type = 'FUNCTION'
ORDER BY routine_name;
```

Expected functions:
- refresh_all_materialized_views
- refresh_league_transfer_aggregation
- refresh_manager_gameweek_summary
- refresh_mini_league_standings
- refresh_player_gameweek_performance

### Check Indexes
```sql
SELECT indexname, tablename 
FROM pg_indexes 
WHERE schemaname = 'public'
ORDER BY tablename, indexname;
```

## Migration Details

### Migration 001: Tables (12 tables)

1. **gameweeks** - Gameweek lifecycle tracking
2. **players** - Player master data
3. **player_gameweek_stats** - Player performance per gameweek
4. **player_prices** - Price history
5. **managers** - Manager master data
6. **manager_gameweek_history** - Manager points and ranks
7. **manager_transfers** - Transfer history with prices
8. **manager_picks** - Team selections
9. **fixtures** - Match fixtures
10. **mini_leagues** - Tracked leagues
11. **mini_league_managers** - League membership
12. **player_whitelist** - Players owned by tracked managers

### Migration 002: Materialized Views (4 views)

1. **mv_mini_league_standings** - Pre-calculated standings
2. **mv_manager_gameweek_summary** - Manager GW summary
3. **mv_player_gameweek_performance** - Player performance summary
4. **mv_league_transfer_aggregation** - League transfer stats

### Migration 003: Functions (5 functions)

1. **refresh_mini_league_standings()** - Refresh standings view
2. **refresh_manager_gameweek_summary()** - Refresh manager summary
3. **refresh_player_gameweek_performance()** - Refresh player performance
4. **refresh_league_transfer_aggregation()** - Refresh transfer aggregation
5. **refresh_all_materialized_views()** - Refresh all views at once

## Important Notes

- All migrations use `IF NOT EXISTS` so they're safe to run multiple times
- Indexes are created for performance optimization
- Materialized views use `CONCURRENTLY` to avoid locking
- Unique constraints ensure data integrity
- Foreign keys maintain referential integrity

## Troubleshooting

### Error: "relation already exists"
- This is normal if migrations were run before
- The `IF NOT EXISTS` clauses prevent errors
- You can safely re-run migrations

### Error: "permission denied"
- Ensure you're using a user with proper permissions
- Service role key has full access
- Anon key may have limited access depending on RLS

### Error: "function does not exist"
- Ensure migrations are run in order (001, 002, 003)
- Check that migration 003 was run successfully

### Materialized Views Not Updating
- Views must be manually refreshed using the refresh functions
- The backend service automatically refreshes them after data updates
- You can manually refresh: `SELECT refresh_all_materialized_views();`
