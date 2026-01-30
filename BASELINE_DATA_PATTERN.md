# Baseline Data Pattern - Critical Architecture Principle

## Overview

**⚠️ CRITICAL**: Delta calculations (rank changes, point changes) require accurate, persistent baselines that are captured at the START of each gameweek and preserved throughout live play.

## The Problem We Solved

Without proper baseline storage:
- `total_points` = `gameweek_points` (missing cumulative history)
- `rank_change` = NULL (no previous rank to compare)
- Deltas cannot be calculated during live matches
- UI cannot show green ▲ / red ▼ indicators

## The Solution: Baseline Capture Pattern

### 1. Baseline Capture Timing

**Critical Window**: Post-deadline, Pre-live matches

```
Transfer Deadline → [BASELINE CAPTURE] → First Match Starts → Live Updates
```

**When to Capture Baselines:**
1. ✅ **After transfer deadline passes** (teams locked)
2. ✅ **Before first match starts** (pre-live state)
3. ✅ **Once per gameweek** (not during live updates)

### 2. Required Baselines

#### A. Total Points Baseline
- **Field**: `manager_gameweek_history.total_points`
- **Source**: FPL API `/api/entry/{manager_id}/history/` → `total_points` for previous gameweek
- **Calculation**: `baseline_total = previous_gw_total + current_gw_points` (for live) OR FPL API `total_points` (when finished)
- **Preservation**: Once stored, **DO NOT overwrite** during live matches
- **Update**: Only when gameweek finishes (FPL API authoritative value)

#### B. Mini League Rank Baseline
- **Field**: `manager_gameweek_history.mini_league_rank` (previous gameweek)
- **Source**: Calculate from previous gameweek's `total_points` (sort and rank)
- **Preservation**: Previous gameweek rank stored, used for delta calculation
- **Calculation**: `rank_change = previous_rank - current_rank`
  - Positive = moved up (green ▲)
  - Negative = moved down (red ▼)

#### C. Overall Rank Baseline
- **Field**: `manager_gameweek_history.overall_rank` (previous gameweek)
- **Source**: FPL API `/api/entry/{manager_id}/history/` → `overall_rank` for previous gameweek
- **Calculation**: `overall_rank_change = previous_overall_rank - current_overall_rank`
- **Preservation**: Previous rank stored, used for delta calculation

### 3. Baseline Preservation Rules

**During Live Matches:**
- ✅ Update `gameweek_points` (real-time calculated)
- ✅ Update `mini_league_rank` (recalculated from current totals)
- ❌ **DO NOT** overwrite `total_points` baseline
- ❌ **DO NOT** overwrite previous gameweek's `mini_league_rank` (it's the baseline)

**When Gameweek Finishes:**
- ✅ Update `total_points` to FPL API authoritative value (one-time)
- ✅ Finalize `mini_league_rank` (from final totals)
- ✅ Calculate and store `rank_change` (from baseline)

**When New Gameweek Starts:**
- ✅ Establish new baselines (previous gameweek becomes baseline)
- ✅ Capture `total_points` at deadline
- ✅ Calculate and store previous gameweek ranks

### 4. Implementation Pattern

```python
async def capture_baselines(manager_id: int, gameweek: int):
    """
    Capture baseline data post-deadline, pre-live.
    
    This should run:
    - After transfer deadline passes
    - Before first match starts
    - Once per gameweek
    """
    # 1. Get previous gameweek baseline
    previous_gw = gameweek - 1
    previous_history = get_manager_history(manager_id, previous_gw)
    
    # 2. Store baseline total_points (from previous + initial gameweek_points)
    baseline_total = previous_history.total_points + initial_gameweek_points
    
    # 3. Store baseline ranks (from previous gameweek)
    baseline_rank = previous_history.mini_league_rank
    baseline_overall_rank = previous_history.overall_rank
    
    # 4. Store in database (this becomes the baseline)
    store_baseline(manager_id, gameweek, {
        "total_points": baseline_total,  # Baseline - preserve during live
        "previous_rank": baseline_rank,  # For delta calculation
        "previous_overall_rank": baseline_overall_rank
    })

async def update_during_live(manager_id: int, gameweek: int):
    """
    Update during live matches - preserve baselines.
    """
    # Calculate real-time gameweek points
    current_gw_points = calculate_gameweek_points(manager_id, gameweek)
    
    # Get baseline
    baseline = get_baseline(manager_id, gameweek)
    
    # Update real-time values (DO NOT overwrite baseline total_points)
    update_manager_history(manager_id, gameweek, {
        "gameweek_points": current_gw_points,  # Real-time
        "total_points": baseline.total_points + current_gw_points,  # Only if no baseline exists
        # DO NOT overwrite if baseline.total_points already exists
    })
    
    # Recalculate current rank (from current totals)
    current_rank = calculate_current_rank(manager_id, gameweek)
    
    # Calculate rank change from baseline
    rank_change = baseline.previous_rank - current_rank
    
    update_manager_history(manager_id, gameweek, {
        "mini_league_rank": current_rank,
        "mini_league_rank_change": rank_change  # Calculated from baseline
    })
```

### 5. Refresh Orchestrator Integration

**State Machine for Baseline Capture:**

```
TRANSFER_DEADLINE → Capture Baselines → IDLE → LIVE_MATCHES → Update (preserve baselines)
```

**Key States:**
1. **TRANSFER_DEADLINE**: Capture baselines (post-deadline, pre-live)
2. **LIVE_MATCHES**: Update real-time data, preserve baselines
3. **BONUS_PENDING**: Update real-time data, preserve baselines
4. **IDLE**: Normal updates, preserve baselines

### 6. Critical Rules Summary

| Action | Baseline Behavior |
|--------|------------------|
| **Post-Deadline Capture** | ✅ Store `total_points` baseline, previous ranks |
| **During Live Matches** | ❌ DO NOT overwrite `total_points` baseline |
| **During Live Matches** | ✅ Update `gameweek_points` (real-time) |
| **During Live Matches** | ✅ Recalculate `mini_league_rank` (from current totals) |
| **During Live Matches** | ✅ Calculate `rank_change` (from baseline) |
| **When Gameweek Finishes** | ✅ Update `total_points` to FPL API authoritative value |
| **When New Gameweek Starts** | ✅ Establish new baselines (previous becomes baseline) |

### 7. Data Flow Example

**Gameweek 23 Timeline:**

```
GW22 Finished:
  - total_points: 1343 (final, authoritative)
  - mini_league_rank: 5 (final)

GW23 Deadline Passes (Baseline Capture):
  - Capture baseline: total_points = 1343 (from GW22)
  - Capture baseline: previous_rank = 5 (from GW22)
  - Store initial gameweek_points = 0 (or from picks)

GW23 Live Matches:
  - Update gameweek_points = 42 (real-time calculated)
  - Preserve total_points baseline = 1343
  - Calculate total_points = 1343 + 42 = 1385 (for display)
  - Recalculate mini_league_rank = 2 (from current totals)
  - Calculate rank_change = 5 - 2 = +3 (from baseline)

GW23 Finishes:
  - Update total_points = 1385 (FPL API authoritative, one-time)
  - Finalize mini_league_rank = 2
  - Finalize rank_change = +3
```

### 8. Why This Matters

**Without Baselines:**
- ❌ Cannot show rank changes (no previous rank to compare)
- ❌ Cannot show cumulative totals (only current gameweek)
- ❌ Deltas are impossible to calculate
- ❌ UI cannot show green ▲ / red ▼ indicators

**With Baselines:**
- ✅ Accurate rank changes throughout gameweek
- ✅ Cumulative totals preserved
- ✅ Deltas always calculable
- ✅ UI can show real-time indicators

### 9. Implementation Checklist

- [x] Store `total_points` baseline (preserve during live)
- [x] Store previous gameweek `mini_league_rank` (for delta)
- [x] Store previous gameweek `overall_rank` (for delta)
- [x] Update `gameweek_points` during live (real-time)
- [x] Recalculate `mini_league_rank` during live (from current totals)
- [x] Calculate `rank_change` from baseline (previous - current)
- [x] Only update `total_points` when gameweek finishes (FPL API)
- [x] Establish new baselines when new gameweek starts

### 10. Testing

**Test Scenarios:**
1. ✅ Baseline capture post-deadline
2. ✅ Baseline preservation during live matches
3. ✅ Rank change calculation from baseline
4. ✅ Total points cumulative calculation
5. ✅ Baseline update when gameweek finishes
6. ✅ New baseline establishment for new gameweek

---

**Last Updated**: 2026-01-26  
**Version**: 1.0  
**Status**: ✅ Implemented
