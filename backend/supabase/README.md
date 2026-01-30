# Supabase Database Migrations

This directory contains SQL migration files for setting up the FPL database schema.

## Migration Files

1. **001_create_tables.sql** - Creates all core tables
2. **002_create_materialized_views.sql** - Creates materialized views for performance
3. **003_create_refresh_functions.sql** - Creates functions for refreshing materialized views

## Running Migrations

### Using Supabase CLI

```bash
# Apply all migrations
supabase db push

# Or apply specific migration
supabase migration up
```

### Using Supabase Dashboard

1. Go to your Supabase project dashboard
2. Navigate to SQL Editor
3. Copy and paste each migration file in order
4. Execute each migration

### Manual Application

1. Connect to your Supabase PostgreSQL database
2. Run migrations in order:
   ```bash
   psql $DATABASE_URL < migrations/001_create_tables.sql
   psql $DATABASE_URL < migrations/002_create_materialized_views.sql
   psql $DATABASE_URL < migrations/003_create_refresh_functions.sql
   ```

## Verifying Migrations

After running migrations, verify tables exist:

```sql
-- Check tables
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;

-- Check materialized views
SELECT matviewname 
FROM pg_matviews 
ORDER BY matviewname;

-- Check indexes
SELECT indexname, tablename 
FROM pg_indexes 
WHERE schemaname = 'public'
ORDER BY tablename, indexname;
```

## Refreshing Materialized Views

Materialized views should be refreshed after data updates:

```sql
-- Refresh all views
SELECT refresh_all_materialized_views();

-- Or refresh individually
SELECT refresh_mini_league_standings();
SELECT refresh_manager_gameweek_summary();
SELECT refresh_player_gameweek_performance();
SELECT refresh_league_transfer_aggregation();
```

## Notes

- All migrations use `IF NOT EXISTS` to be idempotent
- Indexes are created for performance optimization
- Materialized views use `CONCURRENTLY` option to avoid locking
- Unique constraints ensure data integrity
