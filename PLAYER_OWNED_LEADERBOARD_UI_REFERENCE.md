# Player-Owned Leaderboard - UI Development Reference

## Overview

This document provides a comprehensive reference for building the **Player-Owned Leaderboard** UI component, which shows each unique player owned by a manager with cumulative points received from starting positions only. This table helps managers understand which players contributed the most points during their ownership periods, accounting for captain multipliers, multiple ownership periods, and excluding bench points.

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Key Files & Components](#key-files--components)
3. [Data Structures](#data-structures)
4. [Core Calculation Logic](#core-calculation-logic)
5. [API Endpoints](#api-endpoints)
6. [Features & Rules](#features--rules)
7. [Database Schema Mapping](#database-schema-mapping)
8. [UI Component Recommendations](#ui-component-recommendations)
9. [Example Data Flows](#example-data-flows)
10. [Testing & Validation](#testing--validation)

---

## System Architecture

### High-Level Flow

```
User Request → Backend API → FPL API → Player Points Aggregation → Database → UI Display
```

### Key Components

1. **Player Ownership Tracker**
   - Tracks all gameweeks where each player was in starting XI
   - Handles multiple ownership periods (owned, sold, owned again)
   - Accumulates points across all ownership periods

2. **Points Calculator**
   - Calculates points from starting positions only (positions 1-11)
   - Applies captain multipliers (×2 or ×3)
   - Excludes bench points (positions 12-15)
   - Handles auto-subs (substitute points count if starter didn't play)

3. **Ownership Period Analyzer**
   - Identifies continuous ownership periods
   - Detects gaps (sold and bought back)
   - Formats ownership periods for display

4. **Database** (Supabase)
   - Stores manager picks per gameweek
   - Stores player gameweek stats
   - Enables efficient queries for historical data

---

## Key Files & Components

### Core Calculation Files

| File | Purpose | Key Functions |
|------|---------|---------------|
| `test_player_owned_leaderboard.py` | Main leaderboard calculation | `build_player_owned_leaderboard()`, `get_ownership_periods()` |
| `test_multiple_ownership.py` | Verification for multiple ownership periods | `test_multiple_ownership()`, `get_ownership_periods()` |
| `backend/src/utils/points_calculator.py` | Backend points calculation utility | `get_player_points()`, `apply_automatic_subs()` |
| `backend/src/refresh/managers.py` | Database refresh logic | `refresh_manager_picks()` |

### Documentation Files

| File | Purpose |
|------|---------|
| `FPL_API_COMPLETE_REFERENCE.md` | Complete FPL API reference with calculation logic |
| `FPL_DATA_DICTIONARY.md` | Data dictionary for all API fields |
| `SUPABASE_DATABASE_SCHEMA_DESIGN.md` | Database schema documentation |

---

## Data Structures

### PlayerOwnershipStats

Represents a player's ownership and points contribution for a manager.

```python
@dataclass
class PlayerOwnershipStats:
    player_id: int
    player_name: str
    total_points: int                    # Cumulative points from all ownership periods
    gameweeks_owned: List[int]           # All gameweeks where player was in starting XI
    ownership_periods: List[str]         # Formatted periods (e.g., ["1-6", "10-12", "14-15"])
    average_points_per_gw: float        # total_points / len(gameweeks_owned)
    gameweek_details: List[Dict]        # Detailed breakdown per gameweek
```

### GameweekDetail

Represents a player's contribution in a specific gameweek.

```python
@dataclass
class GameweekDetail:
    gameweek: int
    base_points: int                     # Player's base points (before multiplier)
    multiplier: int                      # 1 (normal), 2 (captain), 3 (triple captain)
    points_with_multiplier: int          # base_points × multiplier
    was_captain: bool                    # True if captain this gameweek
    was_auto_subbed: bool                # True if auto-subbed in
```

### PlayerOwnedLeaderboard

Complete leaderboard data for a manager.

```python
@dataclass
class PlayerOwnedLeaderboard:
    manager_id: int
    manager_name: str
    players: List[PlayerOwnershipStats]  # Sorted by total_points descending
    total_unique_players: int           # Count of unique players owned
    total_points_from_all_players: int  # Sum of all player points
```

---

## Core Calculation Logic

### Player Points Aggregation

The core calculation happens in `build_player_owned_leaderboard()`:

```python
async def build_player_owned_leaderboard(manager_id: int) -> PlayerOwnedLeaderboard:
    """
    Build player-owned leaderboard showing cumulative points from starting positions.
    
    Returns:
        PlayerOwnedLeaderboard with all players sorted by total_points
    """
```

#### Step 1: Get Manager History

```python
history = await get_manager_history(manager_id)
# Returns list of all gameweeks where manager has data
```

#### Step 2: Process Each Gameweek

For each gameweek, get manager picks and player points:

```python
picks_data = await get_manager_picks(manager_id, gameweek)
live_data = await get_live_data(gameweek)

picks = picks_data.get("picks", [])
automatic_subs = picks_data.get("automatic_subs", [])
```

#### Step 3: Filter to Starting XI Only

**Critical:** Only process players in starting positions (1-11), exclude bench (12-15):

```python
starters = [p for p in picks if p.get("position", 0) <= 11]
# Bench players (position > 11) are EXCLUDED
```

#### Step 4: Handle Auto-Subs

If a starter didn't play (0 minutes), their substitute's points count:

```python
sub_map = {}
for auto_sub in automatic_subs:
    sub_map[auto_sub.get("element_out")] = auto_sub.get("element_in")

for pick in starters:
    player_id = pick.get("element")
    original_player_id = player_id
    
    # Check if auto-subbed
    if player_id in sub_map:
        player_id = sub_map[player_id]  # Use substitute player
```

#### Step 5: Get Player Points

```python
player_points_map = {}
for element in live_data.get("elements", []):
    player_id = element["id"]
    stats = element.get("stats", {})
    points = stats.get("total_points", 0)
    player_points_map[player_id] = points
```

#### Step 6: Apply Multipliers

```python
base_points = player_points_map.get(player_id, 0)
multiplier = pick.get("multiplier", 1)  # 1, 2 (captain), or 3 (triple captain)
points_with_multiplier = base_points * multiplier
```

**Multiplier Rules:**
- `multiplier: 1` = Normal player
- `multiplier: 2` = Captain (or vice-captain if captain didn't play)
- `multiplier: 3` = Triple captain chip active

#### Step 7: Accumulate Points

```python
# Track this player
if player_id not in player_stats:
    player_stats[player_id] = {
        "name": player_name,
        "total_points": 0,
        "gameweeks": [],
        "details": []
    }

player_stats[player_id]["total_points"] += points_with_multiplier
if gameweek not in player_stats[player_id]["gameweeks"]:
    player_stats[player_id]["gameweeks"].append(gameweek)
```

**Key Point:** Points are accumulated across ALL ownership periods. If a player is owned in GWs 1-5, sold, then bought back in GWs 10-15, both periods contribute to their total.

#### Step 8: Calculate Ownership Periods

Convert list of gameweeks to formatted periods (handles gaps):

```python
def get_ownership_periods(gameweeks: List[int]) -> List[str]:
    """
    Convert [1,2,3,4,5,10,11,12,14,15] to ["1-5", "10-12", "14-15"]
    """
    sorted_gws = sorted(gameweeks)
    periods = []
    start = sorted_gws[0]
    end = sorted_gws[0]
    
    for i in range(1, len(sorted_gws)):
        if sorted_gws[i] == sorted_gws[i-1] + 1:
            # Continuous
            end = sorted_gws[i]
        else:
            # Gap detected - end current period, start new one
            if start == end:
                periods.append(str(start))
            else:
                periods.append(f"{start}-{end}")
            start = sorted_gws[i]
            end = sorted_gws[i]
    
    # Add final period
    if start == end:
        periods.append(str(start))
    else:
        periods.append(f"{start}-{end}")
    
    return periods
```

#### Step 9: Sort and Format

```python
sorted_players = sorted(
    player_stats.items(),
    key=lambda x: x[1]["total_points"],
    reverse=True
)
```

---

## Data Source

### Database View (Primary Method)

**No API calls needed** - Uses existing Supabase tables:
- `manager_picks` - Already stored picks with multipliers, auto-subs
- `player_gameweek_stats` - Already stored player points per gameweek
- `players` - Already stored player names
- `managers` - Already stored manager names

**View:** `v_player_owned_leaderboard` (computed on-demand)
**Materialized View:** `mv_player_owned_leaderboard` (for performance)

### Database Query

```sql
-- Get full leaderboard for a manager
SELECT 
  player_name,
  total_points,
  ownership_periods,
  gameweeks_owned,
  average_points_per_gw,
  captain_weeks,
  player_position
FROM v_player_owned_leaderboard
WHERE manager_id = :manager_id
ORDER BY total_points DESC;
```

### Backend API Endpoint (Recommended)

```javascript
// GET /api/managers/{managerId}/players-owned
// Returns: List<PlayerOwnershipStats>

// Example response:
{
  "manager_id": 344182,
  "manager_name": "SD Spurs",
  "players": [
    {
      "player_id": 123,
      "player_name": "Haaland",
      "total_points": 339,
      "gameweeks_owned": 23,
      "ownership_periods": "1-23",
      "average_points_per_gw": 14.74,
      "captain_weeks": 22,
      "player_position": 4
    },
    // ... more players
  ],
  "total_unique_players": 47,
  "total_points_from_all_players": 1316
}
```

### Direct Database Access (Alternative)

If using Supabase client directly:

```javascript
// Using Supabase JS client
const { data, error } = await supabase
  .from('v_player_owned_leaderboard')
  .select('*')
  .eq('manager_id', managerId)
  .order('total_points', { ascending: false });
```

---

## Features & Rules

### 1. Starting Positions Only

**Rule:** Only count points when player was in starting XI (positions 1-11).

**Exclusions:**
- Bench players (positions 12-15) are **NOT** included
- Even if Bench Boost chip was active, bench points are excluded from this leaderboard
- This leaderboard shows "points from starting positions only"

**Rationale:** This shows which players contributed when they were actually selected to start, not when they happened to be on the bench.

### 2. Captain Multipliers

**Rule:** Points are multiplied by captain multiplier (×2 or ×3).

**Calculation:**
```python
base_points = player_stats.get("total_points", 0)
multiplier = pick.get("multiplier", 1)  # 1, 2, or 3
points_with_multiplier = base_points * multiplier
```

**Examples:**
- Normal player: 5 points → 5 points
- Captain: 5 points → 10 points (×2)
- Triple Captain: 5 points → 15 points (×3)

**UI Display:**
- Show base points and multiplier separately
- Indicate (C) or (TC) for captaincy
- Show total points with multiplier applied

### 3. Multiple Ownership Periods

**Rule:** Points are accumulated across ALL ownership periods.

**Example:**
- Player owned GWs 1-5: 25 points
- Player sold
- Player bought back GWs 10-15: 30 points
- **Total: 55 points** (both periods count)

**Ownership Period Display:**
- Continuous: "1-23" (owned all gameweeks)
- Multiple periods: "1-6, 10-12, 14-15" (owned, sold, bought back)

**Verification:**
- Test confirmed 19 players with multiple ownership periods for manager 344182
- All points correctly accumulated across periods

### 4. Automatic Substitutions

**Rule:** If starter didn't play (0 minutes), substitute's points count.

**Logic:**
```python
# Check if auto-subbed
if original_player_id in sub_map:
    player_id = sub_map[original_player_id]  # Use substitute
    # Points from substitute count toward original player's position
```

**Important:**
- Only applies to starters (position ≤ 11)
- Substitute must have played (minutes > 0)
- Points count toward the starting position, not the bench player

### 5. Exclude Bench Points

**Rule:** Bench points are NEVER included, even if Bench Boost was active.

**Rationale:**
- This leaderboard shows "points from starting positions"
- Bench Boost is a chip effect, not a reflection of starting selection
- Managers want to see which players performed when selected to start

### 6. Gameweek Details

**Rule:** Track detailed breakdown per gameweek for each player.

**Data Stored:**
- Gameweek number
- Base points (before multiplier)
- Multiplier applied
- Points with multiplier
- Was captain
- Was auto-subbed

**Use Case:**
- Expandable rows showing gameweek-by-gameweek breakdown
- Identify which gameweeks contributed most points
- See captaincy impact per gameweek

---

## Database Schema Mapping

### Primary Tables

#### `manager_picks`

Stores manager picks per gameweek:

```sql
CREATE TABLE manager_picks (
  manager_id BIGINT,
  gameweek INTEGER,
  player_id INTEGER,
  position INTEGER,              -- 1-11 = starting XI, 12-15 = bench
  is_captain BOOLEAN,
  is_vice_captain BOOLEAN,
  multiplier INTEGER,             -- 1, 2 (captain), or 3 (triple captain)
  was_auto_subbed_out BOOLEAN,
  was_auto_subbed_in BOOLEAN,
  auto_sub_replaced_player_id INTEGER
);
```

#### `player_gameweek_stats`

Stores player points per gameweek:

```sql
CREATE TABLE player_gameweek_stats (
  player_id INTEGER,
  gameweek INTEGER,
  total_points INTEGER,           -- Points scored this gameweek
  bonus INTEGER,
  minutes INTEGER,
  -- ... other stats
);
```

### Query Example

**Use the view directly (recommended):**

```sql
-- Get player-owned leaderboard for a manager
SELECT 
  player_name,
  total_points,
  ownership_periods,
  gameweeks_owned,
  average_points_per_gw,
  captain_weeks,
  player_position
FROM v_player_owned_leaderboard
WHERE manager_id = :manager_id
ORDER BY total_points DESC;
```

**Or use materialized view for better performance:**

```sql
SELECT * FROM mv_player_owned_leaderboard
WHERE manager_id = :manager_id
ORDER BY total_points DESC;
```

**Refresh materialized view (after data updates):**

```sql
SELECT refresh_player_owned_leaderboard();
```

### Materialized View

Already created in migration `004_create_player_owned_leaderboard_view.sql`:

```sql
-- View: v_player_owned_leaderboard (computed on-demand)
-- Materialized View: mv_player_owned_leaderboard (for performance)

-- Refresh after data updates:
SELECT refresh_player_owned_leaderboard();

-- Or refresh all materialized views:
SELECT refresh_all_materialized_views();
```

**When to refresh:**
- After manager picks are updated (new gameweek data)
- After player gameweek stats are updated
- Periodically during live gameweeks (every 30-60 seconds)
- After gameweek is finalized

---

## UI Component Recommendations

### Main Leaderboard Table

**Required Columns:**
1. Rank (1, 2, 3, ...)
2. Player Name (clickable for details)
3. Total Points (with breakdown tooltip)
4. Ownership Periods (e.g., "1-6, 10-12, 14-15")
5. Average Points/GW (total_points / gameweeks_owned)

**Optional Columns:**
- Gameweeks Owned (count)
- Captain Weeks (number of gameweeks as captain)
- Best Gameweek (highest points in single GW)

**Features:**
- Sortable columns (default: Total Points descending)
- Expandable rows (show gameweek-by-gameweek breakdown)
- Filter by position (GK, DEF, MID, FWD)
- Search by player name
- Export to CSV

### Player Details View (Expandable)

**When expanded, show:**
- Gameweek-by-gameweek breakdown:
  - Gameweek number
  - Base points
  - Multiplier (if captain)
  - Points with multiplier
  - Captain indicator (C) or (TC)
  - Auto-sub indicator (if applicable)

**Visual Indicators:**
- (C) = Captain (×2)
- (TC) = Triple Captain (×3)
- ⚡ = Auto-subbed in
- Color code: High points (green), Low points (red)

### Summary Statistics

**Show at top of table:**
- Total unique players owned
- Total points from all players
- Average points per player
- Most owned player (by gameweeks)
- Highest scoring player

### Ownership Period Display

**Format:**
- Continuous: "1-23" (single period)
- Multiple: "1-6, 10-12, 14-15" (multiple periods with gaps)

**Visual:**
- Use different colors for different periods
- Show tooltip on hover: "Owned in 3 separate periods"
- Highlight gaps (e.g., "Sold after GW 6, bought back in GW 10")

### Filtering & Sorting

**Filters:**
- Position (GK, DEF, MID, FWD)
- Minimum points threshold
- Ownership period (e.g., "Only players owned in GW 1-10")
- Captain only (show only players who were captain)

**Sort Options:**
- Total Points (default)
- Average Points/GW
- Gameweeks Owned
- Player Name (alphabetical)

---

## Example Data Flows

### Flow 1: Initial Leaderboard Load

```
1. User navigates to Player-Owned Leaderboard page
2. Frontend calls: GET /api/managers/{managerId}/players-owned
3. Backend queries: v_player_owned_leaderboard view (or mv_player_owned_leaderboard)
4. Backend returns: List<PlayerOwnershipStats> (already computed)
5. Frontend renders: Leaderboard table sorted by total_points

Note: No calculation needed - view handles all aggregation from existing tables
```

### Flow 2: Player Details Expand

```
1. User clicks player name or expand icon
2. Frontend calls: GET /api/managers/{managerId}/players/{playerId}/gameweeks
3. Backend queries: manager_picks + player_gameweek_stats for this player
4. Backend returns: List<GameweekDetail>
5. Frontend renders: Expandable gameweek-by-gameweek breakdown

Query:
SELECT mp.gameweek, mp.multiplier, mp.is_captain, 
       pgs.total_points as base_points,
       pgs.total_points * mp.multiplier as points_with_multiplier
FROM manager_picks mp
JOIN player_gameweek_stats pgs ON mp.player_id = pgs.player_id AND mp.gameweek = pgs.gameweek
WHERE mp.manager_id = :manager_id 
  AND mp.player_id = :player_id
  AND mp.position <= 11
ORDER BY mp.gameweek
```

### Flow 3: Filter by Position

```
1. User selects "MID" filter
2. Frontend filters: Existing data by position
3. Frontend re-renders: Table with only midfielders
4. (No API call needed if position data already loaded)
```

### Flow 4: Historical View

```
1. User selects "Show only GW 1-10"
2. Frontend calls: GET /api/managers/{managerId}/players-owned?gameweeks=1-10
3. Backend queries: v_player_owned_leaderboard with WHERE clause filtering gameweeks
4. Backend filters: WHERE first_owned_gw <= 10 AND last_owned_gw >= 1
5. Backend returns: Filtered leaderboard
6. Frontend renders: Updated table

Alternative: Filter in SQL using array operations on gameweeks_array
```

---

## Testing & Validation

### Validation Rules

1. **Points Sum:**
   - Sum of all player points should equal manager's total points (minus transfer costs)
   - Formula: `Sum(player_points) = Manager Total Points`
   - Note: Transfer costs are deducted at manager level, not player level

2. **Starting Positions Only:**
   - No player with position > 11 should appear in leaderboard
   - Verify: `SELECT * FROM manager_picks WHERE position > 11` returns 0 rows in results

3. **Ownership Periods:**
   - Gameweeks list should match ownership periods
   - Example: [1,2,3,4,5,10,11,12,14,15] → ["1-5", "10-12", "14-15"]
   - Verify: No gaps are incorrectly merged

4. **Multipliers:**
   - Captain points should be exactly 2× base points
   - Triple captain points should be exactly 3× base points
   - Verify: `points_with_multiplier = base_points × multiplier`

5. **Multiple Ownership:**
   - Points from all periods should be summed
   - Example: Player owned GWs 1-5 (25 pts) and GWs 10-15 (30 pts) → Total: 55 pts
   - Verify: No double-counting or missing periods

### Test Cases

**Test 1: Single Ownership Period**
- Player owned continuously GWs 1-23
- Verify: Ownership period shows "1-23"
- Verify: Total points = sum of all GW points

**Test 2: Multiple Ownership Periods**
- Player owned GWs 1-5, sold, bought back GWs 10-15
- Verify: Ownership periods show "1-5, 10-15"
- Verify: Total points = sum from both periods

**Test 3: Captain Multiplier**
- Player was captain in GW 6 with 13 base points
- Verify: Points counted as 26 (13 × 2)
- Verify: Captain indicator shown

**Test 4: Triple Captain**
- Player was triple captain in GW 6 with 13 base points
- Verify: Points counted as 39 (13 × 3)
- Verify: Triple captain indicator shown

**Test 5: Auto-Sub**
- Starter didn't play (0 minutes), substitute played (90 minutes, 5 points)
- Verify: Substitute's 5 points count toward starter's position
- Verify: Auto-sub indicator shown

**Test 6: Bench Points Exclusion**
- Player was on bench (position 12) in GW 5 with 8 points
- Verify: Player does NOT appear in leaderboard for GW 5
- Verify: Even if Bench Boost was active, bench points excluded

**Test 7: Points Sum Validation**
- Calculate sum of all player points
- Compare to manager's total points (from manager_gameweek_history)
- Verify: Sum matches (accounting for transfer costs at manager level)

### Test Script

Use `test_player_owned_leaderboard.py` to validate:

```bash
python3 test_player_owned_leaderboard.py
```

This generates:
- Full leaderboard for manager 344182
- Ownership periods for all players
- Detailed breakdown for top 5 players
- Verification of points calculation

### Verification Example

**Manager 344182 - Sels:**
- Ownership periods: GWs 1-6, 10-12, 14-15
- Points breakdown:
  - GW 1-6: 2+2+2+1+3+2 = 12 points
  - GW 10-12: 2+2+7 = 11 points
  - GW 14-15: 6+2 = 8 points
- **Total: 31 points** ✓ (verified)

---

## Key Implementation Notes

### 1. Performance Considerations

- Use materialized views for frequently accessed leaderboards
- Cache player names (bootstrap data) - updates infrequently
- Index on `(manager_id, gameweek, position)` for fast queries
- Consider pagination for managers with many players (50+)

### 2. Data Consistency

- Always filter to `position <= 11` (starting XI only)
- Always apply multipliers from `manager_picks.multiplier`
- Always use `player_gameweek_stats.total_points` (includes bonus)
- Handle auto-subs correctly (substitute points count)

### 3. Ownership Period Calculation

- Sort gameweeks before calculating periods
- Detect gaps: if `gameweeks[i] != gameweeks[i-1] + 1`, there's a gap
- Format periods: single GW = "5", range = "1-6", multiple = "1-6, 10-12"

### 4. Edge Cases

- **Player never started:** If player was only on bench, they won't appear (correct behavior)
- **Player auto-subbed every week:** Points from substitute count (correct behavior)
- **Player owned in 0 gameweeks:** Should not appear in leaderboard
- **Missing gameweek data:** Handle gracefully, show warning if data incomplete

### 5. UI/UX Considerations

- Show loading state while calculating (can take time for many gameweeks)
- Allow export to CSV for analysis
- Provide tooltips explaining calculations
- Show "Last updated" timestamp
- Highlight top performers (top 3-5 players)

---

## Related Documentation

- **FPL_API_COMPLETE_REFERENCE.md** - Complete API reference with calculation examples
- **FPL_DATA_DICTIONARY.md** - Data dictionary for all API fields
- **SUPABASE_DATABASE_SCHEMA_DESIGN.md** - Database schema and relationships
- **LEAGUE_STANDINGS_UI_REFERENCE.md** - League standings UI reference (similar format)

---

## Quick Reference: Calculation Formula

```
For each player owned by manager:
  total_points = 0
  gameweeks = []
  
  For each gameweek where player in starting XI (position <= 11):
    base_points = player_gameweek_stats[player_id][gameweek].total_points
    multiplier = manager_picks[manager_id][gameweek][player_id].multiplier
    points_with_multiplier = base_points × multiplier
    
    total_points += points_with_multiplier
    gameweeks.append(gameweek)
  
  ownership_periods = calculate_periods(gameweeks)  # Handles gaps
  average_points_per_gw = total_points / len(gameweeks)

Sort players by total_points descending
```

**Key Rules:**
- Only starting XI (position ≤ 11)
- Exclude bench (position > 11)
- Apply multipliers (captain ×2, triple captain ×3)
- Sum across all ownership periods
- Handle auto-subs (substitute points count)

---

**Last Updated:** 2026-01-25  
**Version:** 1.0  
**Status:** Production Ready
