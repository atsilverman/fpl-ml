# Materialized Views Usage Guide - Direct vs Derived

## Answer: **Materialized Views Are Effective Even When You Derive Data**

Materialized views provide performance benefits **even when you transform, filter, join, or aggregate** the data. You don't need to use them column-for-column, row-for-row.

---

## How Materialized Views Provide Performance Benefits

### 1. **Pre-Calculated Expensive Operations**

Materialized views pre-calculate:
- **Aggregations** (SUM, COUNT, AVG, GROUP BY)
- **JOINs** (multiple table joins)
- **Window functions** (ROW_NUMBER, RANK, etc.)
- **Complex calculations** (point impacts, rank changes)

**Even if you derive from them, you're still querying a smaller, pre-aggregated dataset.**

### 2. **Indexed Columns**

Materialized views can have indexes on their columns, which speeds up:
- WHERE clause filtering
- ORDER BY sorting
- JOIN operations

**These indexes work even when you transform the data.**

### 3. **Reduced Data Volume**

Materialized views typically contain:
- **Fewer rows** (aggregated data)
- **Fewer columns** (only what's needed)
- **Pre-joined data** (no need to join multiple tables)

**Querying a smaller dataset is faster, even with transformations.**

---

## Real Examples from Our Codebase

### Example 1: `mv_mini_league_standings` - Used with JOINs ✅

**Materialized View** (pre-calculates standings):
```sql
CREATE MATERIALIZED VIEW mv_mini_league_standings AS
SELECT 
  ml.league_id,
  m.manager_id,
  m.manager_name,
  mgh.gameweek_points,
  mgh.total_points,
  mgh.mini_league_rank,
  mgh.mini_league_rank_change
FROM mini_leagues ml
JOIN mini_league_managers mlm ON ml.league_id = mlm.league_id
JOIN managers m ON mlm.manager_id = m.manager_id
JOIN manager_gameweek_history mgh ON m.manager_id = mgh.manager_id
WHERE mgh.gameweek = (SELECT id FROM gameweeks WHERE is_current = true);
```

**UI Query** (derives captain info by JOINing):
```sql
-- Standings page: Add captain info to standings
SELECT 
  mvs.league_id,
  mvs.manager_id,
  mvs.manager_name,
  mvs.gameweek_points,
  mvs.total_points,
  mvs.mini_league_rank,
  mvs.mini_league_rank_change,
  -- DERIVED: Captain info (not in materialized view)
  p.web_name as captain_name,
  t.short_name as captain_team_short_name,
  CONCAT('/badges/', t.short_name, '.svg') as captain_team_badge,
  mgh.active_chip
FROM mv_mini_league_standings mvs  -- Start with materialized view
LEFT JOIN manager_picks mp ON mvs.manager_id = mp.manager_id 
  AND mvs.gameweek = mp.gameweek 
  AND mp.is_captain = true
  AND mp.position <= 11
LEFT JOIN players p ON mp.player_id = p.fpl_player_id
LEFT JOIN teams t ON p.team_id = t.team_id
LEFT JOIN manager_gameweek_history mgh ON mvs.manager_id = mgh.manager_id 
  AND mvs.gameweek = mgh.gameweek
WHERE mvs.league_id = :league_id
ORDER BY mvs.total_points DESC;
```

**Performance Benefit**: ✅ **Still Fast**
- The expensive JOINs (mini_leagues → mini_league_managers → managers → manager_gameweek_history) are **already done**
- We're only adding lightweight JOINs to get captain info
- Indexes on `mv_mini_league_standings` speed up WHERE and ORDER BY

---

### Example 2: `mv_manager_transfer_impacts` - Used with Aggregations ✅

**Materialized View** (pre-calculates point impacts):
```sql
CREATE MATERIALIZED VIEW mv_manager_transfer_impacts AS
SELECT 
  mt.manager_id,
  mt.gameweek,
  mt.player_in_id,
  mt.player_out_id,
  p_in.web_name as player_in_name,
  p_out.web_name as player_out_name,
  COALESCE(pgs_in.total_points, 0) as player_in_points,
  COALESCE(pgs_out.total_points, 0) as player_out_points,
  COALESCE(pgs_in.total_points, 0) - COALESCE(pgs_out.total_points, 0) as point_impact
FROM manager_transfers mt
LEFT JOIN players p_in ON mt.player_in_id = p_in.fpl_player_id
LEFT JOIN players p_out ON mt.player_out_id = p_out.fpl_player_id
LEFT JOIN player_gameweek_stats pgs_in ON mt.player_in_id = pgs_in.player_id 
  AND mt.gameweek = pgs_in.gameweek
LEFT JOIN player_gameweek_stats pgs_out ON mt.player_out_id = pgs_out.player_id 
  AND mt.gameweek = pgs_out.gameweek;
```

**UI Query** (derives total delta points per manager):
```sql
-- Transfers page: Sum point impacts per manager
SELECT 
  mgh.mini_league_rank,
  m.manager_name,
  mgh.mini_league_rank_change,
  -- DERIVED: Total delta points (SUM of individual impacts)
  SUM(mti.point_impact) as total_delta_points,
  -- DERIVED: Transfer count
  COUNT(mti.transfer_id) as transfer_count
FROM mv_manager_transfer_impacts mti  -- Start with materialized view
JOIN manager_gameweek_history mgh ON mti.manager_id = mgh.manager_id 
  AND mti.gameweek = mgh.gameweek
JOIN managers m ON mti.manager_id = m.manager_id
WHERE mti.gameweek = :gameweek
  AND mti.manager_id IN (
    SELECT manager_id FROM mini_league_managers WHERE league_id = :league_id
  )
GROUP BY mgh.mini_league_rank, m.manager_name, mgh.mini_league_rank_change, mti.manager_id
ORDER BY mgh.mini_league_rank;
```

**Performance Benefit**: ✅ **Still Fast**
- The expensive JOINs (manager_transfers → players × 2 → player_gameweek_stats × 2) are **already done**
- We're only doing a simple SUM aggregation on pre-calculated `point_impact` values
- Much faster than calculating point impacts on-the-fly

---

### Example 3: `mv_league_transfer_aggregation` - Used with WHERE and ORDER BY ✅

**Materialized View** (pre-aggregates top transfers):
```sql
CREATE MATERIALIZED VIEW mv_league_transfer_aggregation AS
SELECT 
  ml.league_id,
  mt.gameweek,
  mt.player_in_id as player_id,
  p_in.web_name as player_name,
  'in' as transfer_direction,
  COUNT(DISTINCT mt.manager_id) as manager_count,
  COUNT(*) as transfer_count
FROM mini_leagues ml
JOIN mini_league_managers mlm ON ml.league_id = mlm.league_id
JOIN manager_transfers mt ON mlm.manager_id = mt.manager_id
JOIN players p_in ON mt.player_in_id = p_in.fpl_player_id
GROUP BY ml.league_id, mt.gameweek, mt.player_in_id, p_in.web_name
UNION ALL
-- ... transfers OUT ...
```

**UI Query** (derives top transfers with filtering):
```sql
-- Transfers page: Get top 10 transferred IN players
SELECT 
  player_id,
  player_name,
  transfer_count,
  manager_count
FROM mv_league_transfer_aggregation  -- Start with materialized view
WHERE league_id = :league_id
  AND gameweek = :gameweek
  AND transfer_direction = 'in'  -- DERIVED: Filter to IN only
ORDER BY transfer_count DESC, manager_count DESC  -- DERIVED: Sort
LIMIT 10;  -- DERIVED: Limit results
```

**Performance Benefit**: ✅ **Still Fast**
- The expensive GROUP BY and UNION ALL are **already done**
- We're only filtering and sorting a pre-aggregated dataset
- Index on `(league_id, gameweek, transfer_direction, manager_count DESC)` makes this very fast

---

## Performance Comparison

### Without Materialized View (Slow ❌)
```sql
-- Calculate transfer impacts on-the-fly
SELECT 
  mt.manager_id,
  SUM(COALESCE(pgs_in.total_points, 0) - COALESCE(pgs_out.total_points, 0)) as total_delta_points
FROM manager_transfers mt
LEFT JOIN player_gameweek_stats pgs_in ON mt.player_in_id = pgs_in.player_id 
  AND mt.gameweek = pgs_in.gameweek
LEFT JOIN player_gameweek_stats pgs_out ON mt.player_out_id = pgs_out.player_id 
  AND mt.gameweek = pgs_out.gameweek
WHERE mt.gameweek = :gameweek
GROUP BY mt.manager_id;
-- Execution time: ~500ms (joins + aggregations on large tables)
```

### With Materialized View (Fast ✅)
```sql
-- Use pre-calculated impacts
SELECT 
  manager_id,
  SUM(point_impact) as total_delta_points
FROM mv_manager_transfer_impacts
WHERE gameweek = :gameweek
GROUP BY manager_id;
-- Execution time: ~50ms (simple aggregation on pre-joined data)
```

**Performance Gain**: **10x faster** even though we're still doing a SUM aggregation!

---

## When Materialized Views Are Most Effective

### ✅ **Highly Effective** (Even with Derivations):

1. **Pre-aggregated data** (SUM, COUNT, AVG already calculated)
   - You can still filter, sort, or group by different dimensions
   - Example: `mv_league_transfer_aggregation` - filter by direction, sort by count

2. **Pre-joined data** (multiple tables already joined)
   - You can still add lightweight JOINs for additional data
   - Example: `mv_mini_league_standings` - add captain info with simple JOIN

3. **Pre-calculated complex values** (point impacts, rank changes)
   - You can still aggregate or transform these values
   - Example: `mv_manager_transfer_impacts` - SUM point impacts per manager

4. **Filtered data** (WHERE clauses already applied)
   - You can still add additional filters
   - Example: Filter materialized view by league_id, gameweek, etc.

### ⚠️ **Less Effective** (But Still Beneficial):

1. **Heavy transformations** that require re-scanning all rows
   - Example: Complex CASE statements on every row
   - Still faster than without materialized view, but less benefit

2. **Cross-joins or cartesian products**
   - Example: Joining materialized view to itself
   - Can still be faster, but watch for explosion in row count

---

## Best Practices

### 1. **Design Materialized Views for Common Patterns**

Create views that pre-calculate:
- **Expensive JOINs** (multiple table joins)
- **Aggregations** (SUM, COUNT, GROUP BY)
- **Complex calculations** (point impacts, rank changes)
- **Window functions** (ROW_NUMBER, RANK)

Then derive additional data as needed.

### 2. **Add Indexes to Materialized Views**

Index columns that will be used in:
- WHERE clauses
- ORDER BY clauses
- JOIN conditions

```sql
-- Example: Index for common filters
CREATE INDEX idx_mv_transfer_impacts_manager_gw 
  ON mv_manager_transfer_impacts(manager_id, gameweek);
```

### 3. **Use Materialized Views as Base, Then Derive**

**Good Pattern** ✅:
```sql
-- Start with materialized view (pre-calculated)
SELECT ... FROM mv_standings
-- Add lightweight JOINs for additional data
LEFT JOIN manager_picks ON ...
-- Add simple aggregations
GROUP BY ...
-- Add filters
WHERE ...
```

**Bad Pattern** ❌:
```sql
-- Re-calculate everything the materialized view already did
SELECT ... FROM manager_gameweek_history
JOIN mini_league_managers ON ...
JOIN managers ON ...
-- (This defeats the purpose of the materialized view)
```

---

## Real-World Examples from Our Codebase

### Example: Standings Page with Captain Info

**Materialized View**: `mv_mini_league_standings`
- Pre-calculates: League standings with ranks, points, rank changes
- Pre-joins: mini_leagues → mini_league_managers → managers → manager_gameweek_history

**UI Query**:
```sql
SELECT 
  mvs.*,  -- All columns from materialized view
  -- DERIVED: Captain info (not in view)
  p.web_name as captain_name,
  t.short_name as captain_team_short_name
FROM mv_mini_league_standings mvs
LEFT JOIN manager_picks mp ON ...  -- Lightweight JOIN
LEFT JOIN players p ON ...          -- Lightweight JOIN
LEFT JOIN teams t ON ...            -- Lightweight JOIN
WHERE mvs.league_id = :league_id
ORDER BY mvs.total_points DESC;
```

**Performance**: ✅ **Fast** - Only 3 lightweight JOINs added to pre-calculated standings

---

### Example: Transfer Delta Points

**Materialized View**: `mv_manager_transfer_impacts`
- Pre-calculates: Point impact per transfer (player_in_points - player_out_points)
- Pre-joins: manager_transfers → players × 2 → player_gameweek_stats × 2

**UI Query**:
```sql
SELECT 
  manager_id,
  -- DERIVED: Total delta (SUM of pre-calculated impacts)
  SUM(point_impact) as total_delta_points,
  COUNT(*) as transfer_count
FROM mv_manager_transfer_impacts
WHERE gameweek = :gameweek
GROUP BY manager_id;
```

**Performance**: ✅ **Fast** - Simple SUM on pre-calculated values

---

## Conclusion

### ✅ **Materialized Views Are Effective Even When You Derive Data**

**Key Points**:

1. **Pre-calculated expensive operations** remain fast even with derivations
2. **Indexes on materialized views** speed up WHERE, ORDER BY, and JOINs
3. **Smaller dataset** (pre-aggregated) is faster to query even with transformations
4. **Lightweight operations** (simple JOINs, filters, aggregations) on materialized views are still fast

**Best Practice**: 
- Design materialized views to pre-calculate **expensive operations** (JOINs, aggregations, complex calculations)
- Then **derive additional data** as needed (lightweight JOINs, simple aggregations, filters)
- Add **indexes** to materialized views for common query patterns

**You don't need to use materialized views column-for-column, row-for-row. They're designed to be building blocks for efficient queries.**

---

**Last Updated**: 2026-01-26  
**Status**: ✅ Materialized Views Support Derived Queries Effectively
