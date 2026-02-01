# Backfill Data Guide

This guide explains what data might be missing and how to backfill it, especially for the **total points bar graph** for the configured manager.

## Overview

The total points bar graph (player owned performance chart) requires several data sources to be populated:

1. **`manager_picks`** - Which players the manager selected for each gameweek
2. **`player_gameweek_stats`** - Player points per gameweek
3. **`mv_player_owned_leaderboard`** - Materialized view that aggregates player owned performance

## Quick Start

### Check What's Missing

```bash
# Check what data is missing for the configured manager (from VITE_MANAGER_ID env var)
python backend/scripts/backfill_configured_manager.py --check-only

# Or specify a manager ID
python backend/scripts/backfill_configured_manager.py --manager-id 344182 --check-only
```

### Backfill Missing Data

```bash
# Backfill all missing data for configured manager
python backend/scripts/backfill_configured_manager.py

# Or specify a manager ID
python backend/scripts/backfill_configured_manager.py --manager-id 344182

# Force refresh (overwrite existing data)
python backend/scripts/backfill_configured_manager.py --force
```

## What Gets Backfilled

The `backfill_configured_manager.py` script will:

1. ✅ **Check coverage** - Reports what data exists and what's missing
2. ✅ **Backfill manager picks** - Populates `manager_picks` table for all gameweeks
3. ✅ **Backfill player stats** - Ensures `player_gameweek_stats` exists for all owned players
4. ✅ **Backfill manager history** - Populates `manager_gameweek_history` for all gameweeks
5. ✅ **Refresh materialized views** - Refreshes `mv_player_owned_leaderboard` and other views

## Data Dependencies

### Total Points Bar Graph

The total points bar graph requires:

- **`manager_picks`** - Manager's team selections per gameweek
  - Includes: position, multiplier (captain), auto-subs
  - Script: `backfill_manager_picks.py` or `backfill_configured_manager.py`

- **`player_gameweek_stats`** - Player points per gameweek
  - Includes: total_points for each player-gameweek combination
  - Script: Automatically refreshed when backfilling picks

- **`mv_player_owned_leaderboard`** - Materialized view aggregating player owned performance
  - Must be refreshed after backfilling picks/stats
  - Script: `refresh_views.py` or `backfill_configured_manager.py`

### Overall Rank Chart

Requires:

- **`manager_gameweek_history`** - Historical gameweek data
  - Includes: overall_rank, total_points, active_chip
  - Script: `backfill_manager_history.py` or `backfill_configured_manager.py`

### Team Value Chart

Requires:

- **`manager_gameweek_history`** - Historical gameweek data
  - Includes: team_value_tenths, bank_tenths
  - Script: `backfill_manager_history.py` or `backfill_configured_manager.py`

### Transfers Summary

Requires:

- **`manager_transfers`** - Transfer history
  - Includes: player_in_id, player_out_id, gameweek
  - Note: This is typically populated during live refresh, but may need backfilling for historical data

## Individual Backfill Scripts

If you need to backfill specific data types:

### Manager Picks

```bash
# Backfill all tracked managers (only managers in mini_league_managers)
python backend/scripts/backfill_manager_picks.py

# Backfill your configured manager (required if they are not in a mini league)
python backend/scripts/backfill_manager_picks.py --manager-id 344182

# Backfill specific gameweeks
python backend/scripts/backfill_manager_picks.py --gameweeks 1,2,3,4,5
```

**Note:** Running without `--manager-id` only processes managers listed in `mini_league_managers`. If your configured manager (e.g. your own team) is not in any loaded mini league, the UI will show 0 points and an empty GW points / player list until you run the backfill with `--manager-id YOUR_MANAGER_ID`.

### Manager History

```bash
# Backfill all tracked managers
python backend/scripts/backfill_manager_history.py

# Backfill specific manager
python backend/scripts/backfill_manager_history.py --manager-id 344182

# Backfill specific gameweeks
python backend/scripts/backfill_manager_history.py --gameweeks 1,2,3,4,5
```

### Refresh Materialized Views

```bash
# Refresh all materialized views
python backend/scripts/refresh_views.py

# Or manually in Supabase SQL Editor:
SELECT refresh_all_materialized_views();
```

## Common Issues

### Empty Bar Graph

If the total points bar graph is empty or missing data:

1. **Check manager picks exist:**
   ```sql
   SELECT COUNT(*) FROM manager_picks WHERE manager_id = YOUR_MANAGER_ID;
   ```

2. **Check player stats exist:**
   ```sql
   SELECT COUNT(*) FROM player_gameweek_stats;
   ```

3. **Refresh materialized view:**
   ```sql
   SELECT refresh_player_owned_leaderboard();
   ```

4. **Run backfill script:**
   ```bash
   python backend/scripts/backfill_configured_manager.py --manager-id YOUR_MANAGER_ID
   ```

### Missing Historical Data

If charts show incomplete data:

1. **Check gameweek coverage:**
   ```sql
   SELECT gameweek, COUNT(*) 
   FROM manager_picks 
   WHERE manager_id = YOUR_MANAGER_ID 
   GROUP BY gameweek 
   ORDER BY gameweek;
   ```

2. **Backfill missing gameweeks:**
   ```bash
   python backend/scripts/backfill_configured_manager.py --manager-id YOUR_MANAGER_ID
   ```

### Materialized View Stale

If the view shows old data:

1. **Refresh the view:**
   ```bash
   python backend/scripts/refresh_views.py
   ```

2. **Or refresh manually:**
   ```sql
   SELECT refresh_player_owned_leaderboard();
   ```

## Verification

After backfilling, verify data exists:

```sql
-- Check manager picks coverage
SELECT 
  manager_id,
  COUNT(DISTINCT gameweek) as gameweeks_with_picks,
  COUNT(*) as total_picks
FROM manager_picks
WHERE manager_id = YOUR_MANAGER_ID
GROUP BY manager_id;

-- Check manager history coverage
SELECT 
  manager_id,
  COUNT(DISTINCT gameweek) as gameweeks_with_history,
  MIN(gameweek) as first_gw,
  MAX(gameweek) as last_gw
FROM manager_gameweek_history
WHERE manager_id = YOUR_MANAGER_ID
GROUP BY manager_id;

-- Check materialized view has data
SELECT COUNT(*) 
FROM mv_player_owned_leaderboard 
WHERE manager_id = YOUR_MANAGER_ID;

-- Sample player owned data
SELECT 
  player_name,
  total_points,
  gameweeks_owned
FROM mv_player_owned_leaderboard
WHERE manager_id = YOUR_MANAGER_ID
ORDER BY total_points DESC
LIMIT 10;
```

## Environment Variables

The backfill script uses the `VITE_MANAGER_ID` environment variable if no `--manager-id` is provided. Make sure this is set in your `.env` file:

```bash
VITE_MANAGER_ID=344182
```

## Rate Limiting

The FPL API has rate limits (~30 requests/minute). The backfill scripts include automatic rate limiting (2 second delays between requests) to avoid hitting these limits.

## Next Steps

After backfilling:

1. ✅ Verify data exists using the SQL queries above
2. ✅ Check the frontend - the total points bar graph should now show data
3. ✅ Refresh materialized views if needed
4. ✅ Check other charts (overall rank, team value) for completeness
