# Auto-Subs Verification - Standings Accuracy

## Status: ✅ **IMPLEMENTED** | ⚠️ **REFRESH FLOW UPDATED**

Auto-subs are correctly implemented and applied in standings calculations. Refresh orchestrator now updates manager points during live matches to apply auto-subs progressively.

## Implementation Verification

### 1. Auto-Subs Logic ✅

**Location**: `backend/src/utils/points_calculator.py`

**Key Method**: `apply_automatic_subs()`

**Logic**:
```python
# Only apply substitution if:
# 1. Starter (position <= 11)
# 2. Player is in auto-sub map (from FPL API)
# 3. Match is finished (finished OR finished_provisional)
# 4. Player has 0 minutes
if position <= 11 and player_id in sub_map:
    match_finished = fixture.get("finished") or fixture.get("finished_provisional")
    if match_finished and minutes == 0:
        # Use substitute's points
        adjusted_pick["player_id"] = sub_map[player_id]
```

**✅ Correct Timing**: Only applies when match is finished (not during live matches)

### 2. Integration in Points Calculation ✅

**Location**: `backend/src/utils/points_calculator.py` → `calculate_manager_gameweek_points()`

**Flow**:
1. ✅ Gets `automatic_subs` from FPL API (`entry_picks` endpoint)
2. ✅ Gets player minutes and fixtures
3. ✅ Calls `apply_automatic_subs()` to adjust picks
4. ✅ Calculates points using adjusted picks (substitute points count)
5. ✅ Applies multipliers (captain, triple captain)
6. ✅ Subtracts transfer costs

### 3. Integration in Refresh Flow ✅

**Location**: `backend/src/refresh/managers.py` → `refresh_manager_gameweek_history()`

**Flow**:
1. ✅ Calls `calculate_manager_points()` 
2. ✅ Which calls `PointsCalculator.calculate_manager_gameweek_points()`
3. ✅ Which applies auto-subs before calculating points
4. ✅ Stores `gameweek_points` in `manager_gameweek_history`

### 4. Live Updates ✅

**During Live Matches**:
- ✅ Auto-subs are checked on each refresh
- ✅ Only applied when player's match finishes
- ✅ Progressive application as matches finish throughout gameweek
- ✅ Standings recalculated with auto-subs as matches complete

**Refresh Frequency**:
- Every 30-60 seconds during live matches
- Auto-subs applied progressively as matches finish
- Standings update in real-time with correct auto-sub points

## Test Results

**Test Script**: `backend/scripts/test_auto_subs.py`

**Results**:
- ✅ Auto-subs fetched from FPL API
- ✅ Points calculator applies auto-subs correctly
- ✅ Calculated points match database stored values
- ✅ Auto-sub flags stored in `manager_picks` table

## Critical Timing Rules

| Scenario | Auto-Sub Applied? | Reason |
|----------|------------------|--------|
| Match live, player 0 minutes | ❌ No | Player might still come on |
| Match finished, player 0 minutes | ✅ Yes | Safe to apply substitution |
| Match finished, player > 0 minutes | ❌ No | Player played, no substitution |
| Match not started | ❌ No | Too early, wait for match |

## Standings Accuracy

**Auto-subs are accounted for in standings because:**

1. ✅ **Points Calculation**: `calculate_manager_gameweek_points()` applies auto-subs
2. ✅ **Refresh Flow**: `refresh_manager_gameweek_history()` uses points calculator
3. ✅ **Materialized Views**: `mv_mini_league_standings` uses `gameweek_points` from `manager_gameweek_history`
4. ✅ **Standings Query**: Uses materialized view which includes auto-sub adjusted points

## Progressive Application During Live Matches

**Example Timeline**:

```
Saturday 3:00 PM - Match A finishes
  → Auto-sub applied for players in Match A (if 0 minutes)
  → Standings updated with auto-sub points

Saturday 5:30 PM - Match B finishes  
  → Auto-sub applied for players in Match B (if 0 minutes)
  → Standings updated with additional auto-sub points

Sunday 2:00 PM - Match C finishes
  → Auto-sub applied for players in Match C (if 0 minutes)
  → Standings updated with final auto-sub points
```

**Result**: Standings are accurate and live, with auto-subs applied progressively as matches finish.

## Verification Checklist

- [x] Auto-subs logic implemented in `PointsCalculator`
- [x] Auto-subs applied only when match finished
- [x] Auto-subs integrated in points calculation
- [x] Auto-subs integrated in refresh flow
- [x] **Refresh orchestrator updated to refresh manager points during live matches**
- [x] Auto-subs applied during live updates (progressive as matches finish)
- [x] Standings use auto-sub adjusted points
- [x] Progressive application as matches finish
- [x] Test script confirms correct behavior

## Conclusion

**✅ Auto-subs are fully implemented and accounted for in standings.**

The system:
- ✅ Applies auto-subs correctly (only when match finished)
- ✅ Updates standings progressively as matches finish
- ✅ Maintains accuracy during live matches
- ✅ Uses auto-sub adjusted points in all calculations

**No missing functionality** - auto-subs are handled correctly.

---

**Last Updated**: 2026-01-26  
**Status**: ✅ Implemented | Refresh orchestrator updated to apply auto-subs progressively

## Recent Update (2026-01-26)

**Added to Refresh Orchestrator**: `_refresh_manager_points()` method
- Called during `LIVE_MATCHES` and `BONUS_PENDING` states
- Refreshes `manager_gameweek_history` for all tracked managers
- Applies auto-subs progressively as matches finish
- Recalculates mini-league ranks after points update
- Ensures standings are accurate and live with auto-subs
