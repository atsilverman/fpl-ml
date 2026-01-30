# Troubleshooting League Data Issues

## Problem: Missing GW Points, Ranks, and Rank Changes

If you're seeing:
- ✅ Manager names and total points showing correctly
- ❌ GW points showing as 0
- ❌ Rank changes showing as 0 or missing
- ❌ League rank not showing on home page

This means the data exists but hasn't been fully calculated/refreshed yet.

## Understanding the Data Flow

### 1. Data Sources

**League Standings Page** gets data from:
- `mv_mini_league_standings` (materialized view)
- Which pulls from `manager_gameweek_history` table

**Home Page** gets league rank from:
- `mv_mini_league_standings` (for configured league)
- Falls back to `manager_gameweek_history.mini_league_rank`

### 2. What Needs to Happen

For data to show correctly:

1. **Manager Gameweek History** must be populated:
   - `gameweek_points` - calculated from player points
   - `total_points` - previous total + gameweek points
   - `mini_league_rank` - calculated by sorting managers
   - `mini_league_rank_change` - previous rank - current rank

2. **Mini League Ranks** must be calculated:
   - Backend calculates ranks by sorting managers by total_points
   - Updates `manager_gameweek_history.mini_league_rank` and `mini_league_rank_change`

3. **Materialized View** must be refreshed:
   - After ranks are calculated, refresh `mv_mini_league_standings`
   - This makes the data available to the frontend

## Diagnostic Steps

### Step 1: Check What Data Exists

Run the diagnostic script:

```bash
cd backend
source venv/bin/activate
python3 scripts/diagnose_league_data.py --league YOUR_LEAGUE_ID
```

This will show:
- How many managers are in the league
- How many have `manager_gameweek_history` records
- How many have 0 or NULL values
- Whether the materialized view is stale

### Step 2: Populate Missing Data

If managers don't have `manager_gameweek_history` records:

```bash
# Populate manager data for a league
python3 scripts/populate_test_data.py --league YOUR_LEAGUE_ID --gameweeks CURRENT_GW
```

This will:
- Fetch manager picks
- Fetch manager transfers  
- Calculate and store gameweek history
- Calculate mini league ranks

### Step 3: Refresh Data (If Data Exists But Is Stale)

If data exists but shows 0 values, run the refresh orchestrator:

```bash
# Run a full refresh cycle
python3 scripts/refresh_data.py
```

This will:
- Refresh manager points
- Calculate mini league ranks
- Refresh materialized views

### Step 4: Refresh Materialized View

After data is updated, refresh the materialized view:

**Option A: Using Supabase SQL Editor**
```sql
SELECT refresh_mini_league_standings();
```

**Option B: Using Python script**
```bash
python3 scripts/refresh_views.py
```

## Common Issues and Solutions

### Issue 1: GW Points = 0

**Cause**: Manager gameweek history hasn't been calculated yet

**Solution**:
```bash
# Populate data for current gameweek
python3 scripts/populate_test_data.py --league YOUR_LEAGUE_ID --gameweeks CURRENT_GW

# Or run refresh orchestrator
python3 scripts/refresh_data.py
```

### Issue 2: Rank Changes = 0 or NULL

**Cause**: Mini league ranks haven't been calculated yet

**Solution**:
```bash
# Refresh orchestrator calculates ranks automatically
python3 scripts/refresh_data.py

# Then refresh materialized view
python3 scripts/refresh_views.py
```

### Issue 3: League Rank Missing on Home Page

**Cause**: Either:
- No league configured
- Materialized view doesn't have data for configured league
- Materialized view is stale

**Solution**:
1. Make sure league is configured (Settings → Configure)
2. Check if data exists: `python3 scripts/diagnose_league_data.py --league YOUR_LEAGUE_ID`
3. Refresh materialized view: `SELECT refresh_mini_league_standings();`

### Issue 4: Materialized View Shows Old Data

**Cause**: Materialized view hasn't been refreshed after data update

**Solution**:
```sql
-- In Supabase SQL Editor
SELECT refresh_mini_league_standings();
```

Or:
```bash
python3 scripts/refresh_views.py
```

## Quick Fix Checklist

If you're seeing missing data, try these in order:

1. ✅ **Check current gameweek**: Make sure `gameweeks` table has `is_current = true` set
2. ✅ **Run diagnostic**: `python3 scripts/diagnose_league_data.py --league YOUR_LEAGUE_ID`
3. ✅ **Populate data**: `python3 scripts/populate_test_data.py --league YOUR_LEAGUE_ID`
4. ✅ **Refresh data**: `python3 scripts/refresh_data.py`
5. ✅ **Refresh views**: `python3 scripts/refresh_views.py` or `SELECT refresh_mini_league_standings();`
6. ✅ **Clear browser cache** and reload

## Understanding the Refresh Process

The refresh orchestrator (`refresh_data.py`) does:

1. **Refresh Gameweeks** - Updates current gameweek
2. **Refresh Fixtures** - Updates match data
3. **Refresh Players** (if live) - Updates player points
4. **Refresh Manager Points** - Calculates gameweek points for all managers
5. **Calculate Mini League Ranks** - Sorts managers and calculates ranks
6. **Refresh Materialized Views** - Makes data available to frontend

**Note**: The refresh orchestrator needs to run regularly (every 30-60 seconds during live matches) to keep data up to date.

## Data Dependencies

```
manager_gameweek_history (source data)
    ↓
calculate_mini_league_ranks() (calculates ranks)
    ↓
manager_gameweek_history.mini_league_rank (updated)
    ↓
refresh_mini_league_standings() (refreshes view)
    ↓
mv_mini_league_standings (materialized view)
    ↓
Frontend queries (displays data)
```

If any step is missing, the data won't show correctly!
