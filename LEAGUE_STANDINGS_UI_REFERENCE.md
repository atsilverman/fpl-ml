# League Standings - UI Development Reference

## Overview

This document provides a comprehensive reference for building the **League Standings** UI component, which is a primary page in the FPL application. The standings system calculates live mini-league rankings with real-time gameweek points, rank changes, and detailed manager team analysis.

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
User Request → Backend API → FPL API → Calculation Engine → Database → UI Display
```

### Key Components

1. **Standings Calculator** (`calculate_mini_league_standings.py`)
   - Core logic for calculating manager gameweek points
   - Handles provisional bonus, auto-subs, captaincy, chips
   - Calculates rank changes

2. **Audit System** (`audit_league_standings.py`)
   - Detailed validation and debugging tool
   - Shows player-level status (Live, Complete, Left, DNP)
   - Displays auto-substitution details

3. **Backend Refresh** (`backend/src/refresh/managers.py`)
   - Populates database with calculated standings
   - Handles data refresh and updates

4. **Database** (Supabase)
   - Stores calculated standings
   - Materialized views for performance
   - Historical data for rank changes

---

## Key Files & Components

### Core Calculation Files

| File | Purpose | Key Functions |
|------|---------|---------------|
| `calculate_mini_league_standings.py` | Main standings calculation engine | `calculate_standings()`, `calculate_manager_gameweek_points()`, `analyze_manager_team_status()` |
| `audit_league_standings.py` | Audit/debugging tool with HTML output | `generate_html()`, `generate_player_details_html()` |
| `backend/src/utils/points_calculator.py` | Backend points calculation utility | `calculate_manager_gameweek_points()` |
| `backend/src/refresh/managers.py` | Database refresh logic | `refresh_manager_gameweek_history()` |

### Documentation Files

| File | Purpose |
|------|---------|
| `FPL_API_COMPLETE_REFERENCE.md` | Complete FPL API reference with calculation logic |
| `FPL_DATA_DICTIONARY.md` | Data dictionary for all API fields |
| `SUPABASE_DATABASE_SCHEMA_DESIGN.md` | Database schema documentation |
| `AUDIT_SCRIPT_FLOW.md` | Flow diagram for audit script logic |

---

## Data Structures

### ManagerStanding

Represents a manager's position in the league standings.

```python
@dataclass
class ManagerStanding:
    manager_id: int
    manager_name: str
    current_total_points: int      # Cumulative total (previous + GW points)
    gameweek_points: int            # Points this gameweek (after transfer costs)
    previous_total_points: int      # Total at start of gameweek
    rank: int                       # Current rank (1 = first)
    previous_rank: int              # Rank at start of gameweek
    rank_change: int                # Positive = moved up, negative = moved down
    is_provisional: bool            # True if any player has provisional bonus
    auto_subs_in: List[Tuple]       # [(player_id, name, points), ...]
    auto_subs_out: List[Tuple]      # [(player_id, name, points), ...]
    auto_sub_points: int             # Net points from auto-subs
```

### PlayerStatus

Represents a player's status in a manager's team (for detailed view).

```python
@dataclass
class PlayerStatus:
    player_id: int
    player_name: str
    position: int                   # 1-15 (pick position)
    is_starter: bool                # True if position <= 11
    fixture_status: str             # "live", "complete", "left", "dnp", "none"
    minutes: int
    points: int                     # Base points (before multiplier)
    multiplier: int                 # 1 (normal), 2 (captain), 3 (triple captain)
    fixture: Optional[dict]         # Fixture data
```

### ManagerAuditData

Extended audit data for detailed manager analysis.

```python
@dataclass
class ManagerAuditData:
    manager_id: int
    manager_name: str
    live_count: int                 # Players in live games
    complete_count: int             # Players whose games finished
    left_count: int                 # Players left to play
    dnp_count: int                 # Did not play (finished, 0 min)
    auto_subs: List[Tuple]          # [(out_name, in_name, point_diff), ...]
    player_statuses: List[PlayerStatus]  # All 15 players
```

---

## Core Calculation Logic

### Gameweek Points Calculation

The core calculation happens in `calculate_manager_gameweek_points()`:

```python
def calculate_manager_gameweek_points(
    manager_id: int,
    gameweek: int,
    live_data: dict,
    fixtures: List[dict],
    bootstrap: dict
) -> Tuple[int, bool, List, List, int]:
    """
    Calculate manager's gameweek points with all FPL rules.
    
    Returns:
        (gameweek_points, is_provisional, auto_subs_in, auto_subs_out, auto_sub_points)
    """
```

#### Step 1: Get Manager Picks

```python
picks_url = f"{API_BASE}/entry/{manager_id}/event/{gameweek}/picks/"
picks_data = fetch_json(picks_url)
picks = picks_data.get("picks", [])
automatic_subs = picks_data.get("automatic_subs", [])
active_chip = picks_data.get("active_chip")  # "bboost", "3xc", "wildcard", "freehit"
```

#### Step 2: Calculate Player Points (with Provisional Bonus)

```python
def get_player_points(player_id: int, player_stats: dict, fixture: dict) -> Tuple[int, bool]:
    """
    Get player points with provisional bonus logic.
    
    Returns: (points, is_provisional)
    """
    # If match finished and bonus confirmed → use total_points from API
    # If match finished but bonus not confirmed → calculate provisional bonus from BPS
    # If match not finished → use current points (will update live)
```

**Provisional Bonus Logic:**
- Match finished + bonus confirmed → Use `total_points` from API
- Match finished + bonus NOT confirmed → Calculate from BPS ranking
- Match not finished → Use current `total_points` (updates live)

#### Step 3: Apply Automatic Substitutions

**API Auto-Subs (if available):**
- Use `automatic_subs` from picks endpoint
- API handles all edge cases (position compatibility, formation rules)

**Manual Auto-Subs (for live/provisional):**
- Check if starter has `minutes == 0` and match finished
- Find first eligible bench player (in order 12, 13, 14, 15):
  - Position compatible (GK ↔ GK, Outfield ↔ Outfield)
  - Has `minutes > 0` (even if their match still live)
  - Maintains valid formation (min 1 GK, 3 DEF, 2 MID, 1 FWD)

#### Step 4: Apply Multipliers

```python
for pick in starters:
    player_points = player_points_map[player_id]
    multiplier = pick.get("multiplier", 1)  # 1, 2 (captain), or 3 (triple captain)
    total_points += player_points * multiplier
```

**Multiplier Rules:**
- `multiplier: 1` = Normal player
- `multiplier: 2` = Captain (or vice-captain if captain didn't play)
- `multiplier: 3` = Triple captain chip active
- API adjusts multipliers after auto-subs (vice-captain promotion)

#### Step 5: Add Bench Points (if Bench Boost)

```python
if active_chip == "bboost":
    for pick in bench:
        player_points = player_points_map[player_id]
        total_points += player_points
```

#### Step 6: Subtract Transfer Costs (Hits)

```python
entry_history = picks_data.get("entry_history", {})
transfer_cost = entry_history.get("event_transfers_cost", 0)
gameweek_points = total_points - transfer_cost
```

**Transfer Cost Rules:**
- 1 free transfer per gameweek
- Can accumulate up to 2 free transfers
- Each extra transfer = -4 points (hit)
- Wildcard/Free Hit = unlimited free transfers

#### Step 7: Calculate Current Total

```python
current_total_points = previous_total_points + gameweek_points
```

---

## API Endpoints

### Required Endpoints

| Endpoint | Purpose | Used For |
|----------|---------|----------|
| `/api/bootstrap-static/` | Static data (players, teams, gameweeks) | Player names, positions, current gameweek |
| `/api/event/{gw}/live/` | Live gameweek data | Player stats, points, fixture status |
| `/api/fixtures/` | All fixtures | Match status, bonus points |
| `/api/leagues-classic/{id}/standings/` | League standings | Manager IDs, names, ranks |
| `/api/entry/{id}/event/{gw}/picks/` | Manager picks | Team selection, auto-subs, chips, transfer costs |
| `/api/entry/{id}/history/` | Manager history | Previous total points, rank history |

### Example API Calls

```javascript
// Get league standings
const leagueData = await fetch(`/api/leagues-classic/${leagueId}/standings/`);

// Get live gameweek data
const liveData = await fetch(`/api/event/${gameweekId}/live`);

// Get manager picks
const picksData = await fetch(`/api/entry/${managerId}/event/${gameweekId}/picks/`);

// Get manager history
const history = await fetch(`/api/entry/${managerId}/history/`);
```

---

## Features & Rules

### 1. Provisional Bonus Points

**When:** Match finished but bonus points not yet confirmed

**Logic:**
- Calculate provisional bonus from BPS (Bonus Points System) ranking
- Top 3 BPS players get 3, 2, 1 bonus points respectively
- Mark as `is_provisional: true` until bonus confirmed

**UI Display:**
- Show indicator (e.g., ⚠️ or yellow highlight) for provisional points
- Update automatically when bonus confirmed

### 2. Automatic Substitutions

**Rules:**
- Only applies to starting XI players with 0 minutes
- Bench players subbed in order (12, 13, 14, 15)
- Position compatibility: GK ↔ GK, Outfield ↔ Outfield
- Must maintain valid formation (min 1 GK, 3 DEF, 2 MID, 1 FWD)
- Bench player must have `minutes > 0` (even if match still live)

**UI Display:**
- Show auto-sub details: "PlayerOut → PlayerIn (+X points)"
- Highlight substituted players
- Show net points gained/lost

### 3. Captaincy & Vice-Captaincy

**Rules:**
- Captain points × 2 (or × 3 with Triple Captain chip)
- If captain doesn't play → vice-captain gets × 2
- API adjusts `multiplier` field automatically after auto-subs

**UI Display:**
- Show (C) indicator for captain
- Show (TC) indicator for triple captain
- Display multiplied points in player details

### 4. Chips

| Chip | Effect |
|------|--------|
| **Bench Boost** | Add all bench points to total |
| **Triple Captain** | Captain points × 3 instead of × 2 |
| **Wildcard** | Unlimited free transfers (no hits) |
| **Free Hit** | Unlimited free transfers (no hits), team resets next GW |

**UI Display:**
- Show chip indicator next to manager name or GW points
- Highlight when active

### 5. Transfer Costs (Hits)

**Rules:**
- 1 free transfer per gameweek
- Can accumulate up to 2 free transfers
- Each extra transfer = -4 points
- Wildcard/Free Hit = unlimited free transfers

**Calculation:**
```python
transfer_cost = entry_history.get("event_transfers_cost", 0)
gameweek_points = raw_points - transfer_cost
```

**UI Display:**
- Show transfer cost separately (e.g., "GW Points: 45 (-4 hits)")
- Show number of transfers made
- Highlight negative impact

### 6. Rank Changes

**Calculation:**
```python
rank_change = previous_rank - current_rank
# Positive = moved up, negative = moved down
```

**UI Display:**
- Show ↑ for rank up, ↓ for rank down
- Color code: green (up), red (down), gray (same)
- Show number of positions moved

### 7. Player Status Categories

**Mutually Exclusive Categories (must sum to 15):**

| Status | Condition |
|--------|-----------|
| **Live** | `fixture.started == true` AND `fixture.finished == false` |
| **Complete** | `(fixture.finished == true OR fixture.finished_provisional == true)` AND `minutes > 0` |
| **Left** | `fixture.started == false` OR no fixture found |
| **DNP** | `(fixture.finished == true OR fixture.finished_provisional == true)` AND `minutes == 0` |

**UI Display:**
- Show counts for each category
- Color code: Live (yellow), Complete (green), Left (blue), DNP (red)
- Expandable view showing all 15 players with status

---

## Database Schema Mapping

### Primary Table: `manager_gameweek_history`

```sql
CREATE TABLE manager_gameweek_history (
  manager_id BIGINT,
  gameweek INTEGER,
  gameweek_points INTEGER,      -- Points this GW (after transfer costs)
  transfer_cost INTEGER,         -- Points deducted for transfers
  total_points INTEGER,          -- Cumulative total (at end of GW)
  transfers_made INTEGER,        -- Number of transfers
  active_chip TEXT,              -- 'wildcard', 'freehit', 'bboost', '3xc'
  is_provisional BOOLEAN,        -- True if points include provisional bonus
  mini_league_rank INTEGER,      -- Rank in tracked league
  mini_league_rank_change INTEGER -- Change from previous GW
);
```

### Materialized View: `mv_manager_gameweek_summary`

Pre-aggregated view for fast standings queries:

```sql
SELECT 
  manager_id,
  gameweek,
  gameweek_points,
  total_points,
  transfer_cost,
  transfers_made,
  active_chip,
  is_provisional
FROM manager_gameweek_history
```

### Query Example

```sql
-- Get current standings for a league
SELECT 
  m.manager_id,
  m.manager_name,
  mgh.gameweek_points,
  mgh.total_points,
  mgh.mini_league_rank,
  mgh.mini_league_rank_change,
  mgh.is_provisional,
  mgh.transfer_cost,
  mgh.active_chip
FROM managers m
JOIN manager_gameweek_history mgh ON m.manager_id = mgh.manager_id
WHERE mgh.gameweek = :current_gameweek
  AND m.manager_id IN (
    SELECT manager_id FROM mini_league_managers WHERE league_id = :league_id
  )
ORDER BY mgh.total_points DESC;
```

---

## UI Component Recommendations

### Main Standings Table

**Required Columns:**
1. Rank (with change indicator)
2. Manager Name (clickable for details)
3. GW Points (with provisional indicator)
4. Total Points
5. Rank Change (↑/↓ with number)

**Optional Columns:**
- Transfer Cost (hits)
- Active Chip
- Auto-Subs Summary
- Player Status Counts (Live/Complete/Left/DNP)

**Features:**
- Sortable columns
- Expandable manager rows (show full team)
- Real-time updates (polling or WebSocket)
- Filter by chip usage, transfers, etc.

### Manager Details View (Expandable)

**When expanded, show:**
- All 15 players with:
  - Position (1-15)
  - Player name
  - Status badge (Live/Complete/Left/DNP)
  - Minutes played
  - Points (with multiplier if captain)
  - Dividing line between starters (1-11) and bench (12-15)

**Visual Indicators:**
- (C) = Captain
- (TC) = Triple Captain
- Color-coded status badges
- Highlight auto-subbed players

### Status Summary Cards

**Show counts for:**
- Live: Players in live games
- Complete: Players whose games finished
- Left: Players left to play
- DNP: Did not play

**Validation:**
- Must sum to 15 per manager
- Show warning if counts don't match

### Auto-Substitution Display

**Format:**
```
PlayerOut → PlayerIn (+X points)
```

**Multiple subs:**
```
Player1 → Sub1 (+2), Player2 → Sub2 (0)
```

**Visual:**
- Show in separate column or tooltip
- Highlight net points gained/lost
- Show which players were subbed

### Rank Change Indicators

**Visual:**
- ↑ Green for rank up
- ↓ Red for rank down
- — Gray for no change

**Display:**
```
↑ +3  (moved from 5th to 2nd)
↓ -2  (moved from 3rd to 5th)
```

### Provisional Points Indicator

**Visual:**
- ⚠️ Icon or yellow highlight
- Tooltip: "Points include provisional bonus"
- Auto-update when bonus confirmed

---

## Example Data Flows

### Flow 1: Initial Standings Load

```
1. User navigates to League Standings page
2. Frontend calls: GET /api/standings/{leagueId}?gameweek={gw}
3. Backend queries: manager_gameweek_history for current GW
4. Backend calculates: rank changes from previous GW
5. Backend returns: List<ManagerStanding>
6. Frontend renders: Standings table with all data
```

### Flow 2: Real-Time Update

```
1. User on Standings page (polling every 30s)
2. Frontend calls: GET /api/standings/{leagueId}?gameweek={gw}&live=true
3. Backend fetches: Latest live data from FPL API
4. Backend recalculates: GW points with updated player stats
5. Backend updates: Database with new calculations
6. Backend returns: Updated standings
7. Frontend updates: Table with new points/ranks (highlight changes)
```

### Flow 3: Manager Details Expand

```
1. User clicks manager name
2. Frontend calls: GET /api/standings/{leagueId}/manager/{managerId}/details
3. Backend fetches: Manager picks, player stats, fixture data
4. Backend calculates: PlayerStatus for all 15 players
5. Backend returns: ManagerAuditData with player_statuses
6. Frontend renders: Expandable player list with status badges
```

### Flow 4: Historical Standings

```
1. User selects different gameweek
2. Frontend calls: GET /api/standings/{leagueId}?gameweek={gw}
3. Backend queries: manager_gameweek_history for selected GW
4. Backend returns: Standings for that GW
5. Frontend renders: Historical standings (no live updates)
```

---

## Testing & Validation

### Validation Rules

1. **Player Status Counts:**
   - Live + Complete + Left + DNP = 15 (per manager)
   - If not, show warning/error

2. **Points Calculation:**
   - GW Points = (Sum of starter points × multipliers) + (Bench points if Bench Boost) - Transfer Costs
   - Total Points = Previous Total + GW Points

3. **Rank Changes:**
   - Rank change = Previous Rank - Current Rank
   - Positive = moved up, Negative = moved down

4. **Auto-Subs:**
   - Only starters (position ≤ 11) can be subbed out
   - Only bench players (position > 11) can be subbed in
   - Position compatibility must be maintained

### Test Cases

**Test 1: Captain with 0 points**
- Captain doesn't play → Vice-captain gets × 2 multiplier
- Verify multiplier adjustment in player details

**Test 2: Auto-Sub with Bench Player**
- Starter has 0 minutes, match finished
- Bench player has minutes > 0 (even if match live)
- Verify auto-sub occurs and points calculated correctly

**Test 3: Transfer Costs**
- Manager makes 3 transfers with 1 free transfer available
- Verify: transfer_cost = -8 (2 hits × -4)
- Verify: gameweek_points = raw_points - 8

**Test 4: Provisional Bonus**
- Match finished but bonus not confirmed
- Verify: is_provisional = true
- Verify: Bonus calculated from BPS ranking
- Verify: Updates when bonus confirmed

**Test 5: Bench Boost**
- Manager activates Bench Boost chip
- Verify: All 15 players' points included in total
- Verify: Chip indicator shown

### Audit Tool

Use `audit_league_standings.py` to validate calculations:

```bash
python3 audit_league_standings.py <league_id1> <league_id2> <league_id3>
```

This generates an HTML report showing:
- Detailed player status for each manager
- Auto-substitution details
- Point calculations with multipliers
- Validation of status counts

---

## Key Implementation Notes

### 1. Performance Considerations

- Use materialized views for standings queries
- Cache bootstrap data (players, teams) - updates infrequently
- Poll live data every 30-60 seconds during active gameweeks
- Use database indexes on `(manager_id, gameweek)` and `(gameweek, total_points)`

### 2. Error Handling

- Handle missing data gracefully (e.g., manager not found)
- Show loading states during calculations
- Display error messages for API failures
- Fallback to cached data if live data unavailable

### 3. Real-Time Updates

- Poll FPL API every 30-60 seconds during live gameweeks
- Update only changed managers (not full recalculation)
- Highlight changes (new points, rank changes)
- Show "Last updated" timestamp

### 4. Data Consistency

- Always use `previous_total_points + gameweek_points` for current total
- Don't rely on FPL API's `summary_overall_points` during live gameweeks
- Recalculate ranks after each update
- Validate player status counts sum to 15

---

## Related Documentation

- **FPL_API_COMPLETE_REFERENCE.md** - Complete API reference with calculation examples
- **FPL_DATA_DICTIONARY.md** - Data dictionary for all API fields
- **SUPABASE_DATABASE_SCHEMA_DESIGN.md** - Database schema and relationships
- **AUDIT_SCRIPT_FLOW.md** - Flow diagram for audit logic

---

## Quick Reference: Calculation Formula

```
Gameweek Points = (
  Sum(Starter Points × Multiplier) 
  + (Bench Points if Bench Boost)
  - Transfer Costs
)

Current Total = Previous Total + Gameweek Points

Rank = Position when sorted by Current Total (descending)
Rank Change = Previous Rank - Current Rank
```

---

**Last Updated:** 2026-01-25  
**Version:** 1.0  
**Status:** Production Ready
