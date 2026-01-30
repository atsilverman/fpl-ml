# UI Components and Data Mapping

## Overview

This document catalogs all UI elements from the reference website (https://fpl-mini-league.vercel.app), maps them to data dependencies, and verifies they can be supported by the existing Supabase backend. The primary goal is to ensure all UI components can be built with optimized queries using materialized views and proper indexing for fast load times.

**Reference Site**: https://fpl-mini-league.vercel.app

---

## Navigation Structure

### Primary Navigation

1. **Home** - Landing/dashboard page
2. **League** - Mini-league specific views
   - Standings
   - Transfers
   - Status
3. **Gameweek** - Gameweek-specific analysis
   - Matches
   - DEFCON
   - Bonus
4. **Research** - Player and team research tools
   - Statistics
   - Fixtures
   - Other

### Secondary Navigation

Each primary section has sub-navigation tabs that appear when the section is active.

---

## Page-by-Page Documentation

### 1. Home Page

**Route**: `/`

**Description**: Manager-focused dashboard page displaying comprehensive statistics for configured managers. Supports up to 75 managers across 3 leagues. Shows current gameweek performance, historical trends, team composition, and comparative analysis.

**⚠️ CRITICAL FEATURE**: Overall rank change (green/red arrows) is a vital part of the FPL experience. Users need to see if they moved up (green ▲) or down (red ▼). This must be computed reliably and always available.

**Manager Configuration**:
- Configure manager ID/name within allowed leagues
- Support for multiple managers (up to 75 total across 3 leagues)
- Manager selection/filtering for focused view

**Bentos/Components**:

1. **Manager Summary Cards**
   - **Overall Rank & Change** ⚠️ **CRITICAL FEATURE**
     - Current overall rank (from FPL, across 11M+ managers)
     - Overall rank change (computed reliably: previous rank - current rank)
     - **Vital UX**: Green arrow ▲ (moved up) or Red arrow ▼ (moved down) with number
     - FPL API may eventually provide this, but computation is reliable and always available
   - **Gameweek Points**
     - Current gameweek points (always computable live)
     - Updates dynamically during live matches
   - **Gameweek Rank**
     - Rank for current gameweek (similar to overall rank, stale is OK)
     - Updates when FPL API updates
   - **Total Points**
     - Cumulative total points (always computable live/dynamically)
     - Updates in real-time based on player performance during live games
   - **League Rank & Change**
     - Rank within tracked mini-league
     - Rank change from previous gameweek (live/dynamic, always computable)
     - Visual indicator: ▲ (up) or ▼ (down) with number
   - **Team Value**
     - Team value in cash (`bank_tenths`)
     - Team value in team (`team_value_tenths`)
     - Display format: "£X.Xm ITB / £XX.Xm Total"

2. **Performance Graph**
   - **Line Chart**: Shows configured manager's performance over time
   - **X-Axis**: Gameweeks
   - **Y-Axis**: Overall rank (lower = better)
   - **Features**:
     - Plot points showing when chips were played (visual markers)
     - Chip indicators: Wildcard, Free Hit, Bench Boost, Triple Captain
     - Timeframe filters:
       - "All Gameweeks" (full season)
       - "Last 12" (last 12 gameweeks)
       - "Last 6" (last 6 gameweeks)
     - **Overlay Comparison**: Button to overlay mini-league leader's performance
       - Shows both managers' rank lines on same graph
       - Synced axes for easy comparison
       - Toggle on/off for leader overlay
   - **Visual Elements**:
     - Different line colors for configured manager vs leader
     - Chip markers at gameweek points where chips were used
     - Hover tooltips showing exact rank and gameweek

3. **Transfers Summary** ⚠️ **CRITICAL**
   - **Transfers Used**: Number of transfers made this gameweek
   - **Delta Points**: Net points gained/lost from transfers
     - **Calculation**: For each transfer: (new player points - old player points)
     - **Total**: SUM all transfer deltas for net impact
     - Shows: "+X" (green), "-X" (red), or "0" (grey)
   - **Transfer Details**: List of transfers (player in → player out)
     - **Player Names**: Must render names of players transferred in/out
     - **Critical**: Requires storing manager teams before deadline (previous gameweek) and after deadline (current gameweek)
     - **Data Source**: Compare `manager_picks` between gameweeks OR use `manager_transfers` table

4. **Chips Used**
   - **Chip History**: List of chips used and which gameweek they were played
   - **Display Format**: 
     - "Wildcard - GW 5"
     - "Triple Captain - GW 12"
     - "Bench Boost - GW 18"
     - "Free Hit - GW 23"
   - **Current Gameweek**: Show active chip if one is being used

5. **Player Table (Current Team)**
   - **Shows**: Configured manager's current team and their gameweek performance
   - **Columns**:
     - Position (1-15, with visual separation for Starting XI vs Bench)
     - Player Name (with team logo)
     - Position Type (GK, DEF, MID, FWD)
     - Points (current gameweek points)
     - Minutes
     - Opponent (team name and fixture status)
     - Status (Live, Played, Yet to play)
     - Captain indicator (C) or Triple Captain (TC)
   - **Features**:
     - Color-coded status indicators
     - Sortable columns
     - Highlights for captain and vice-captain
     - Shows auto-substitution status if applicable
   - **Data Source**: Reuses data from other areas/tables (manager_picks, player_gameweek_stats, fixtures)

**Data Dependencies**:

1. **Overall Rank & Change** ⚠️ **CRITICAL**:
   - `manager_gameweek_history.overall_rank` (current)
   - `manager_gameweek_history.overall_rank` (previous gameweek) for change calculation
   - **Computation**: `overall_rank_change = previous_overall_rank - current_overall_rank`
     - Positive = moved up (green arrow ▲)
     - Negative = moved down (red arrow ▼)
   - **Reliable**: Always computable if previous gameweek data exists
   - Note: Overall rank itself may be stale (FPL updates slowly across 11M+ managers), but change calculation is always accurate

2. **Gameweek Points**:
   - `manager_gameweek_history.gameweek_points` (always computable live)
   - Can be calculated dynamically from `manager_picks` + `player_gameweek_stats`

3. **Gameweek Rank**:
   - Need to calculate rank among all managers for current gameweek
   - Or use FPL API gameweek rank (stale is OK)

4. **Total Points**:
   - `manager_gameweek_history.total_points` (always computable live/dynamically)
   - Can be calculated: `previous_total_points + current_gameweek_points`

5. **League Rank & Change**:
   - `manager_gameweek_history.mini_league_rank` (live/dynamic)
   - `manager_gameweek_history.mini_league_rank_change` (live/dynamic)
   - Always computable from `mv_mini_league_standings`

6. **Team Value**:
   - `manager_gameweek_history.team_value_tenths` (team value)
   - `manager_gameweek_history.bank_tenths` (cash in bank)

7. **Performance Graph**:
   - Historical `manager_gameweek_history` data across all gameweeks
   - `overall_rank` per gameweek
   - `active_chip` per gameweek (for chip markers)
   - Mini-league leader's `overall_rank` for overlay comparison

8. **Transfers Used & Delta Points** ⚠️ **CRITICAL**:
   - `manager_gameweek_history.transfers_made` (count)
   - `manager_transfers` (transfer details: player_in_id, player_out_id)
   - **Team Snapshots**: `manager_picks` table stores team before deadline (previous GW) and after deadline (current GW)
   - **Player Names**: `players.web_name` for rendering transfer details
   - **Transfer Point Impacts**: 
     - For each transfer: (player_in_points - player_out_points)
     - Points from `player_gameweek_stats.total_points` for current gameweek
     - **Critical**: Must have team snapshots at deadline to know which players were transferred

9. **Chips Used**:
   - `manager_gameweek_history.active_chip` per gameweek
   - Historical chip usage across all gameweeks

10. **Player Table**:
    - `manager_picks` (current team selection)
    - `player_gameweek_stats` (current gameweek performance)
    - `fixtures` (opponent information)
    - `players` (player names, positions, team info)

**Supabase Support**:

- ✅ `manager_gameweek_history`
  - `overall_rank`, `overall_rank_change` ⚠️ (CRITICAL - compute if not stored)
  - `gameweek_points`, `total_points`
  - `mini_league_rank`, `mini_league_rank_change`
  - `team_value_tenths`, `bank_tenths`
  - `transfers_made`, `active_chip`
  - Historical data across all gameweeks for performance graph
- ✅ `manager_picks` (for player table)
  - Current gameweek picks with positions, captain status
- ✅ `player_gameweek_stats` (for player table and live calculations)
  - Current gameweek player points, minutes, status
- ✅ `fixtures` (for player table opponent info)
  - Opponent team, fixture status, kickoff time
- ✅ `manager_transfers` (for transfers summary)
  - Transfer details and point impacts
- ✅ `players` (for player table)
  - Player names, positions, team info
- ✅ `mv_mini_league_standings` (for league rank)
  - Pre-calculated league ranks
- ⚠️ **Overall Rank Change**: Need to calculate by comparing current vs previous gameweek
- ⚠️ **Gameweek Rank**: May need to calculate or use FPL API (stale OK)
- ✅ **Transfer Delta Points**: Fully doable - Calculate SUM((player_in_points - player_out_points)) for all transfers
- ⚠️ **Mini-League Leader Data**: Need to query leader's historical data for overlay

**Query Example - Manager Summary**:
```sql
-- Get current gameweek summary for configured manager
SELECT 
  m.manager_id,
  m.manager_name,
  mgh.gameweek,
  mgh.gameweek_points,
  mgh.total_points,
  mgh.overall_rank,
  mgh.mini_league_rank,
  mgh.mini_league_rank_change,
  mgh.team_value_tenths,
  mgh.bank_tenths,
  mgh.transfers_made,
  mgh.active_chip,
  -- Calculate overall rank change (CRITICAL: Vital UX feature - green/red arrows)
  -- Formula: previous_rank - current_rank
  -- In FPL: Lower rank number = better (rank 1 is best)
  -- Example: Previous 5000 → Current 3000 (improved) = 5000 - 3000 = +2000 (positive) = Green ▲
  -- Example: Previous 3000 → Current 5000 (worsened) = 3000 - 5000 = -2000 (negative) = Red ▼
  -- Positive = moved up/improved (better rank, lower number) = Green arrow ▲
  -- Negative = moved down/worsened (worse rank, higher number) = Red arrow ▼
  CASE 
    WHEN prev_mgh.overall_rank IS NOT NULL AND mgh.overall_rank IS NOT NULL 
      THEN prev_mgh.overall_rank - mgh.overall_rank
    ELSE NULL
  END as overall_rank_change,
  CASE 
    WHEN prev_mgh.overall_rank IS NOT NULL AND mgh.overall_rank IS NOT NULL THEN
      CASE 
        WHEN prev_mgh.overall_rank - mgh.overall_rank > 0 THEN 'up'  -- Green arrow ▲ (moved up)
        WHEN prev_mgh.overall_rank - mgh.overall_rank < 0 THEN 'down'  -- Red arrow ▼ (moved down)
        ELSE 'same'
      END
    ELSE NULL
  END as rank_change_direction
FROM managers m
JOIN manager_gameweek_history mgh ON m.manager_id = mgh.manager_id
LEFT JOIN manager_gameweek_history prev_mgh ON m.manager_id = prev_mgh.manager_id 
  AND prev_mgh.gameweek = mgh.gameweek - 1
WHERE m.manager_id = :manager_id
  AND mgh.gameweek = (SELECT id FROM gameweeks WHERE is_current = true);
```

**Query Example - Performance Graph**:
```sql
-- Get historical performance data for graph
SELECT 
  mgh.gameweek,
  mgh.overall_rank,
  mgh.total_points,
  mgh.active_chip,
  gw.name as gameweek_name
FROM manager_gameweek_history mgh
JOIN gameweeks gw ON mgh.gameweek = gw.id
WHERE mgh.manager_id = :manager_id
ORDER BY mgh.gameweek;

-- Get mini-league leader's performance for overlay
SELECT 
  mgh.gameweek,
  mgh.overall_rank,
  mgh.total_points
FROM manager_gameweek_history mgh
WHERE mgh.manager_id = (
  SELECT manager_id 
  FROM mv_mini_league_standings 
  WHERE league_id = :league_id 
  ORDER BY total_points DESC 
  LIMIT 1
)
ORDER BY mgh.gameweek;
```

**Query Example - Chips Used**:
```sql
-- Get chip usage history
SELECT 
  mgh.gameweek,
  gw.name as gameweek_name,
  mgh.active_chip
FROM manager_gameweek_history mgh
JOIN gameweeks gw ON mgh.gameweek = gw.id
WHERE mgh.manager_id = :manager_id
  AND mgh.active_chip IS NOT NULL
ORDER BY mgh.gameweek;
```

**Query Example - Player Table**:
```sql
-- Get current team with performance and opponent (with team names and badges)
SELECT 
  mp.position,
  mp.is_captain,
  mp.is_vice_captain,
  mp.multiplier,
  p.web_name as player_name,
  p.position as player_position,
  p.team_id as player_team_id,
  t_player.team_name as player_team_name,
  t_player.short_name as player_team_short_name,
  CONCAT('/badges/', t_player.short_name, '.svg') as player_team_badge,
  pgs.total_points as points,
  pgs.minutes,
  pgs.fixture_id,
  f.home_team_id,
  f.away_team_id,
  f.started as fixture_started,
  f.finished as fixture_finished,
  f.kickoff_time,
  -- Determine opponent (fully doable: player's team_id + fixture determines opponent)
  CASE 
    WHEN pgs.team_id = f.home_team_id THEN f.away_team_id
    ELSE f.home_team_id
  END as opponent_team_id,
  -- Opponent team info (join teams table to get name and abbreviation for badge)
  CASE 
    WHEN pgs.team_id = f.home_team_id THEN t_away.team_name
    ELSE t_home.team_name
  END as opponent_team_name,
  CASE 
    WHEN pgs.team_id = f.home_team_id THEN t_away.short_name
    ELSE t_home.short_name
  END as opponent_team_short_name,
  CASE 
    WHEN pgs.team_id = f.home_team_id THEN CONCAT('/badges/', t_away.short_name, '.svg')
    ELSE CONCAT('/badges/', t_home.short_name, '.svg')
  END as opponent_team_badge,
  -- Determine status
  CASE 
    WHEN f.started = true AND f.finished = false THEN 'live'
    WHEN f.finished = true OR f.finished_provisional = true THEN 'played'
    WHEN f.started = false OR f.kickoff_time > NOW() THEN 'yet_to_play'
    ELSE 'unknown'
  END as player_status
FROM manager_picks mp
JOIN players p ON mp.player_id = p.fpl_player_id
JOIN teams t_player ON p.team_id = t_player.team_id
LEFT JOIN player_gameweek_stats pgs ON mp.player_id = pgs.player_id 
  AND mp.gameweek = pgs.gameweek
LEFT JOIN fixtures f ON pgs.fixture_id = f.fpl_fixture_id
LEFT JOIN teams t_home ON f.home_team_id = t_home.team_id
LEFT JOIN teams t_away ON f.away_team_id = t_away.team_id
WHERE mp.manager_id = :manager_id
  AND mp.gameweek = (SELECT id FROM gameweeks WHERE is_current = true)
ORDER BY mp.position;
```

**Query Example - Transfers & Delta Points**:
```sql
-- Get transfers with point impacts and player names (CRITICAL: Requires team snapshots)
-- Formula: For each transfer, calculate (player_in_points - player_out_points)
-- Then SUM all transfers for total delta points
-- CRITICAL: manager_picks table stores teams before/after deadline for comparison
SELECT 
  mt.player_in_id,
  p_in.web_name as player_in_name,
  p_in.team_id as player_in_team_id,
  mt.player_out_id,
  p_out.web_name as player_out_name,
  p_out.team_id as player_out_team_id,
  COALESCE(pgs_in.total_points, 0) as player_in_points,
  COALESCE(pgs_out.total_points, 0) as player_out_points,
  COALESCE(pgs_in.total_points, 0) - COALESCE(pgs_out.total_points, 0) as point_impact
FROM manager_transfers mt
JOIN players p_in ON mt.player_in_id = p_in.fpl_player_id
JOIN players p_out ON mt.player_out_id = p_out.fpl_player_id
LEFT JOIN player_gameweek_stats pgs_in ON mt.player_in_id = pgs_in.player_id 
  AND mt.gameweek = pgs_in.gameweek
LEFT JOIN player_gameweek_stats pgs_out ON mt.player_out_id = pgs_out.player_id 
  AND mt.gameweek = pgs_out.gameweek
WHERE mt.manager_id = :manager_id
  AND mt.gameweek = (SELECT id FROM gameweeks WHERE is_current = true)
ORDER BY mt.transfer_time;

-- Alternative: Compare manager_picks between gameweeks to identify transfers
-- This shows the team before deadline (previous GW) vs after deadline (current GW)
WITH previous_team AS (
  SELECT player_id, position
  FROM manager_picks
  WHERE manager_id = :manager_id 
    AND gameweek = (SELECT id FROM gameweeks WHERE is_current = true) - 1
),
current_team AS (
  SELECT player_id, position
  FROM manager_picks
  WHERE manager_id = :manager_id 
    AND gameweek = (SELECT id FROM gameweeks WHERE is_current = true)
)
SELECT 
  COALESCE(ct.player_id, pt.player_id) as player_id,
  COALESCE(p_ct.web_name, p_pt.web_name) as player_name,
  CASE 
    WHEN pt.player_id IS NULL THEN 'IN'  -- Transferred in
    WHEN ct.player_id IS NULL THEN 'OUT'  -- Transferred out
    ELSE 'KEPT'
  END as transfer_status
FROM previous_team pt
FULL OUTER JOIN current_team ct ON pt.player_id = ct.player_id
LEFT JOIN players p_pt ON pt.player_id = p_pt.fpl_player_id
LEFT JOIN players p_ct ON ct.player_id = p_ct.fpl_player_id
WHERE pt.player_id IS NULL OR ct.player_id IS NULL  -- Only show transfers (IN or OUT)
ORDER BY transfer_status, COALESCE(ct.position, pt.position);

-- Sum for total delta points (fully doable)
SELECT 
  SUM(COALESCE(pgs_in.total_points, 0) - COALESCE(pgs_out.total_points, 0)) as total_delta_points
FROM manager_transfers mt
LEFT JOIN player_gameweek_stats pgs_in ON mt.player_in_id = pgs_in.player_id 
  AND mt.gameweek = pgs_in.gameweek
LEFT JOIN player_gameweek_stats pgs_out ON mt.player_out_id = pgs_out.player_id 
  AND mt.gameweek = pgs_out.gameweek
WHERE mt.manager_id = :manager_id
  AND mt.gameweek = (SELECT id FROM gameweeks WHERE is_current = true);
```

**Query Complexity**: Low to Medium
- Manager summary: Simple SELECT with LEFT JOIN for previous gameweek
- Performance graph: Simple SELECT across gameweeks
- Player table: JOINs with status calculation
- Transfers: JOINs with point calculations

**Performance Considerations**:
- ✅ Most data available in `manager_gameweek_history` (well-indexed)
- ✅ Index on `manager_gameweek_history(manager_id, gameweek)` for fast lookups
- ✅ Use `mv_mini_league_standings` for league rank (pre-calculated)
- ⚠️ **Performance Graph**: Querying all gameweeks is efficient (indexed)
- ⚠️ **Player Table**: JOINs are necessary but well-indexed
- ✅ **Transfer Delta Points**: Fully doable with JOIN - Calculate SUM((player_in_points - player_out_points)) per transfer
- ✅ Cache historical performance data (doesn't change for past gameweeks)
- ✅ Real-time updates only needed for current gameweek data

**Real-time Updates**:
- **High Priority** (30-60 second updates during live matches):
  - Gameweek points
  - Total points
  - League rank & change
  - Player table (points, minutes, status)
  - Transfer delta points (as player points update)
- **Low Priority** (update when FPL API updates, stale is OK):
  - Overall rank & change
  - Gameweek rank
- **Static** (update after gameweek completion):
  - Historical performance graph (past gameweeks don't change)
  - Chip history (doesn't change)

---

### Home Page - Readiness Summary

| Component/Bento | Status | Data Source | Notes |
|----------------|--------|-------------|-------|
| **Overall Rank** | ✅ Ready | `manager_gameweek_history.overall_rank` | From FPL API, may be stale |
| **Overall Rank Change** | ✅ Ready | Computed: `prev_overall_rank - current_overall_rank` | Query-based calculation, reliable |
| **Gameweek Points** | ✅ Ready | `manager_gameweek_history.gameweek_points` | Always computable live |
| **Gameweek Rank** | ⚠️ Partial | FPL API or computed | Stale OK, may need calculation |
| **Total Points** | ✅ Ready | `manager_gameweek_history.total_points` | Always computable live |
| **League Rank** | ✅ Ready | `manager_gameweek_history.mini_league_rank` | From materialized view |
| **League Rank Change** | ✅ Ready | `manager_gameweek_history.mini_league_rank_change` | Pre-calculated |
| **Team Value (Cash)** | ✅ Ready | `manager_gameweek_history.bank_tenths` | Available |
| **Team Value (Total)** | ✅ Ready | `manager_gameweek_history.team_value_tenths` | Available |
| **Performance Graph** | ✅ Ready | `manager_gameweek_history` (all gameweeks) | Historical data available |
| **Chip Markers** | ✅ Ready | `manager_gameweek_history.active_chip` | Per gameweek data |
| **Leader Overlay** | ✅ Ready | Query leader from `mv_mini_league_standings` | Can query leader's history |
| **Transfers Used** | ✅ Ready | `manager_gameweek_history.transfers_made` | Available |
| **Transfer Delta Points** | ✅ Ready | `manager_transfers` + `player_gameweek_stats` | Calculate: SUM((player_in_points - player_out_points)) per transfer. **CRITICAL**: Requires team snapshots in `manager_picks` before/after deadline |
| **Transfer Player Names** | ✅ Ready | `manager_transfers` + `players.web_name` | Join to players table to render names of transferred players |
| **Chips Used History** | ✅ Ready | `manager_gameweek_history.active_chip` | Historical data available |
| **Player Table - Team** | ✅ Ready | `manager_picks` | Current team available |
| **Player Table - Points** | ✅ Ready | `player_gameweek_stats.total_points` | Available |
| **Player Table - Minutes** | ✅ Ready | `player_gameweek_stats.minutes` | Available |
| **Player Table - Opponent** | ✅ Ready | `player_gameweek_stats.team_id` + `fixtures` + `teams` | Join fixtures to determine opponent team, then get badge from teams table |
| **Player Table - Status** | ✅ Ready | `fixtures` (started/finished) | Can compute status |
| **Player Table - Badges** | ✅ Ready | `players.team_id` + `teams.short_name` | Join players to teams table to get abbreviation for badge path |

**Overall Status**: ✅ **100% Ready** - All components doable with current schema

**Blockers**:
- ✅ None - `teams` table created and populated

**Missing Data**:
- ⚠️ **Overall Rank Change**: Need to calculate by comparing current vs previous gameweek (query handles this) ✅
- ⚠️ **Gameweek Rank**: May need to calculate rank among all managers, or use FPL API rank (stale OK)
- ✅ **Team Names/Logos**: `teams` table created - fully supported
- ✅ **Transfer Delta Points**: Fully doable - Calculate SUM((player_in_points - player_out_points)) per transfer

---

### 2. League Section

#### 2.1 Standings Page

**Route**: `/league/standings` or `/league` (default)

**Description**: Displays the mini-league standings table showing manager ranks, gameweek points, total points, captains, and rank changes.

**Bentos/Components**:

1. **Standings Table**
   - **Columns**:
     - RANK: Manager's current rank in league
     - MANAGER: Manager name (highlighted if current user)
     - GW23: Gameweek points for current gameweek
     - TOTAL: Cumulative total points
     - CAPTAIN: Captain selection with player icon/name
   - **Features**:
     - Sortable by TOTAL (default descending)
     - Highlighted row for current user's team
     - Rank change indicators (▲ green for up, ▼ red for down)
     - Chip indicators (e.g., "Triple Captain" badge)

2. **Rank Change Indicators**
   - Visual: ▲ (green) for rank up, ▼ (red) for rank down
   - Shows number of positions moved (e.g., "▲ 3", "▼ 3")
   - Displayed next to rank number

3. **Captain Display**
   - Shows captain player name with small circular team logo/badge
   - Badge path: `/badges/{team_short_name}.svg` (e.g., `/badges/MCI.svg` for Man City)
   - Examples: "Haaland" (with MCI badge), "Saka" (with ARS badge), "Thiago" (with LIV badge), "Semenyo" (with BOU badge)
   - "-" if no captain selected (shouldn't happen)

4. **Search Functionality**
   - Search input: "Search for players.."
   - Located to the right of secondary navigation
   - Filters managers/players in the table

5. **Chip Indicators**
   - Badge below manager name (e.g., "Triple Captain")
   - Indicates active chip usage

**Data Dependencies**:
- Manager standings (rank, points, rank change)
- Current gameweek points
- Captain selections per manager
- Manager names
- Previous gameweek rank (for rank change calculation)
- Active chip information

**Supabase Support**:
- ✅ `mv_mini_league_standings` (materialized view)
  - Contains: `league_id`, `manager_id`, `manager_name`, `gameweek`, `gameweek_points`, `total_points`, `mini_league_rank`, `mini_league_rank_change`, `is_provisional`
- ✅ `manager_gameweek_history`
  - `gameweek_points`, `total_points`, `mini_league_rank`, `mini_league_rank_change`
- ✅ `manager_picks` (for captain info)
  - Join on `manager_id`, `gameweek`, `is_captain = true`, `position <= 11`
- ✅ `players` (for captain player names)
  - Join via `manager_picks.player_id = players.fpl_player_id`
- ✅ `teams` (for captain team badges)
  - Join via `players.team_id = teams.team_id`
  - Badge path: `/badges/{teams.short_name}.svg`
- ✅ `manager_gameweek_history.active_chip` (for chip indicators)

**Query Example**:
```sql
-- Get standings with captain info (including team badges)
SELECT 
  mvs.league_id,
  mvs.manager_id,
  mvs.manager_name,
  mvs.gameweek_points,
  mvs.total_points,
  mvs.mini_league_rank,
  mvs.mini_league_rank_change,
  mvs.is_provisional,
  p.web_name as captain_name,
  p.team_id as captain_team_id,
  t.team_name as captain_team_name,
  t.short_name as captain_team_short_name,
  CONCAT('/badges/', t.short_name, '.svg') as captain_team_badge,
  mgh.active_chip
FROM mv_mini_league_standings mvs
LEFT JOIN manager_picks mp ON mvs.manager_id = mp.manager_id 
  AND mvs.gameweek = mp.gameweek 
  AND mp.is_captain = true
  AND mp.position <= 11
LEFT JOIN players p ON mp.player_id = p.fpl_player_id
LEFT JOIN teams t ON p.team_id = t.team_id
LEFT JOIN manager_gameweek_history mgh ON mvs.manager_id = mgh.manager_id 
  AND mvs.gameweek = mgh.gameweek
WHERE mvs.league_id = :league_id
ORDER BY mvs.total_points DESC, mvs.manager_id ASC;
```

**Query Complexity**: Medium
- JOIN between materialized view and tables
- Single query can get all data

**Performance Considerations**:
- ✅ Uses materialized view `mv_mini_league_standings` (pre-calculated)
- ✅ Index on `(league_id, manager_id, gameweek)` in materialized view
- ✅ Index on `manager_picks(manager_id, gameweek, is_captain)` for captain lookup
- Refresh materialized view after gameweek updates
- Search can be done client-side or with ILIKE on manager_name

**Real-time Updates**: 
- During live gameweeks: Refresh every 30-60 seconds
- Update `mv_mini_league_standings` materialized view
- Highlight changed rows/values

---

#### 2.1 Standings Page - Readiness Summary

| Component/Bento | Status | Data Source | Notes |
|----------------|--------|-------------|-------|
| **Standings Table - Rank** | ✅ Ready | `mv_mini_league_standings.mini_league_rank` | Materialized view |
| **Standings Table - Manager Name** | ✅ Ready | `mv_mini_league_standings.manager_name` | Available |
| **Standings Table - GW Points** | ✅ Ready | `mv_mini_league_standings.gameweek_points` | Available |
| **Standings Table - Total Points** | ✅ Ready | `mv_mini_league_standings.total_points` | Available |
| **Rank Change Indicators** | ✅ Ready | `mv_mini_league_standings.mini_league_rank_change` | Pre-calculated |
| **Captain Display - Name** | ✅ Ready | `manager_picks` + `players.web_name` | JOIN required |
| **Captain Display - Badge** | ✅ Ready | `players.team_id` + `teams.short_name` | Teams table created and populated |
| **Chip Indicators** | ✅ Ready | `manager_gameweek_history.active_chip` | Available |
| **Search Functionality** | ✅ Ready | `manager_gameweek_history.manager_name` | Can filter/search |
| **Provisional Indicator** | ✅ Ready | `mv_mini_league_standings.is_provisional` | Available |

**Overall Status**: ✅ **100% Ready** - All components doable with current schema + `teams` table

**Blockers**:
- ✅ `teams` table created and populated (20 teams with badges ready)

---

#### 2.2 Transfers Page

**Route**: `/league/transfers`

**Description**: Shows transfer activity across the league, including most transferred players and individual manager transfer impacts.

**Bentos/Components**:

1. **Top Transfers Section**
   - **Header**: "TOP TRANSFERS" with "Gameweek 23" indicator
   - **Two Columns**:
     - **→OUT** (Outgoing Transfers): 
       - List of players transferred out
       - Shows player name, team logo, and count (e.g., "Woltemade (2)", "Cunha (2)", "Foden (2)")
       - Red-tinted background
     - **←IN** (Incoming Transfers):
       - List of players transferred in
       - Shows player name, team logo, and count (e.g., "Enzo (2)", "Calvert-Lewin (1)", "Dorgu (1)")
       - Green-tinted background
   - **"Show more" Button**: Expands to show additional top transfers

2. **Manager Transfers Table**
   - **Columns**:
     - RANK: Manager's current rank
     - MANAGER: Manager name (with rank change indicator if applicable)
     - TRANSFERS: Transfer details (e.g., "Foden → Enzo", "Woltemade → Calvert-...")
     - Δ PTS: Points change from transfers (badge with +X, -X, or 0)
   - **Features**:
     - Rank change indicators (▲/▼) next to rank
     - Transfer impact badges:
       - Green badge with "+X" for positive impact
       - Red badge with "-X" for negative impact
       - "0" for no impact
     - "No transfers made" displayed if manager made no transfers
     - Highlighted row for current user's team

3. **Transfer Impact Calculation**
   - Shows net points gained/lost from transfers
   - Based on points scored by transferred players vs. players transferred out

**Data Dependencies**:
- Most transferred in/out players (aggregated by player)
- Manager transfer history
- Transfer point impacts (net points from transfers)
- Transfer counts per player
- Manager ranks (for table ordering)

**Supabase Support**:
- ✅ `mv_league_transfer_aggregation` (materialized view)
  - Contains: `league_id`, `gameweek`, `player_id`, `player_name`, `transfer_direction` ('in' or 'out'), `manager_count`, `transfer_count`
  - Pre-aggregated top transfers
- ✅ `manager_transfers`
  - `player_in_id`, `player_out_id`, `net_price_change_tenths` (for price analysis)
  - `transfer_time`, `gameweek`
- ✅ `manager_gameweek_history`
  - For manager ranks
  - `transfers_made` count
- ✅ `players` (for player names)
- ⚠️ **Transfer Point Impact**: Need to calculate points difference between transferred players
  - Points from `player_gameweek_stats` for `player_in_id` vs `player_out_id`
  - May need additional view or calculation

**Query Example - Top Transfers**:
```sql
-- Get top transferred in players
SELECT 
  player_id,
  player_name,
  transfer_count,
  manager_count
FROM mv_league_transfer_aggregation
WHERE league_id = :league_id
  AND gameweek = :gameweek
  AND transfer_direction = 'in'
ORDER BY transfer_count DESC, manager_count DESC
LIMIT 10;

-- Get top transferred out players
SELECT 
  player_id,
  player_name,
  transfer_count,
  manager_count
FROM mv_league_transfer_aggregation
WHERE league_id = :league_id
  AND gameweek = :gameweek
  AND transfer_direction = 'out'
ORDER BY transfer_count DESC, manager_count DESC
LIMIT 10;
```

**Query Example - Manager Transfers**:
```sql
-- Get manager transfers with point impacts
SELECT 
  mgh.mini_league_rank,
  m.manager_name,
  mgh.mini_league_rank_change,
  mt.player_in_id,
  p_in.web_name as player_in_name,
  mt.player_out_id,
  p_out.web_name as player_out_name,
  -- Calculate point impact (simplified - may need more complex logic)
  COALESCE(pgs_in.total_points, 0) - COALESCE(pgs_out.total_points, 0) as point_impact
FROM manager_transfers mt
JOIN manager_gameweek_history mgh ON mt.manager_id = mgh.manager_id 
  AND mt.gameweek = mgh.gameweek
JOIN managers m ON mt.manager_id = m.manager_id
JOIN players p_in ON mt.player_in_id = p_in.fpl_player_id
JOIN players p_out ON mt.player_out_id = p_out.fpl_player_id
LEFT JOIN player_gameweek_stats pgs_in ON mt.player_in_id = pgs_in.player_id 
  AND mt.gameweek = pgs_in.gameweek
LEFT JOIN player_gameweek_stats pgs_out ON mt.player_out_id = pgs_out.player_id 
  AND mt.gameweek = pgs_out.gameweek
WHERE mt.gameweek = :gameweek
  AND mt.manager_id IN (
    SELECT manager_id FROM mini_league_managers WHERE league_id = :league_id
  )
ORDER BY mgh.mini_league_rank;
```

**Query Complexity**: Medium to High
- Top transfers: Simple SELECT from materialized view
- Manager transfers: JOINs with point calculations

**Performance Considerations**:
- ✅ Uses materialized view `mv_league_transfer_aggregation` for top transfers
- ✅ Index on `(league_id, gameweek, transfer_direction, manager_count DESC)` in materialized view
- ✅ **OPTIMIZED**: Materialized view `mv_manager_transfer_impacts` created for fast transfer point impact queries
  - Pre-calculates point impacts (player_in_points - player_out_points)
  - Reduces JOIN overhead from 2x `player_gameweek_stats` lookups
  - Refresh every 30-60 seconds during live gameweeks
- Refresh materialized views after gameweek updates

**Real-time Updates**:
- During live gameweeks: Refresh every 30-60 seconds
- Update transfer point impacts as player points change
- Update top transfers if new transfers occur

---

#### 2.2 Transfers Page - Readiness Summary

| Component/Bento | Status | Data Source | Notes |
|----------------|--------|-------------|-------|
| **Top Transfers - OUT** | ✅ Ready | `mv_league_transfer_aggregation` (direction='out') | Materialized view |
| **Top Transfers - IN** | ✅ Ready | `mv_league_transfer_aggregation` (direction='in') | Materialized view |
| **Top Transfers - Counts** | ✅ Ready | `mv_league_transfer_aggregation.transfer_count` | Available |
| **Top Transfers - Player Names** | ✅ Ready | `mv_league_transfer_aggregation.player_name` | Available |
| **Top Transfers - Badges** | ✅ Ready | `teams.short_name` for badge path | Teams table created and populated |
| **Manager Transfers - Rank** | ✅ Ready | `manager_gameweek_history.mini_league_rank` | Available |
| **Manager Transfers - Manager Name** | ✅ Ready | `managers.manager_name` | Available |
| **Manager Transfers - Rank Change** | ✅ Ready | `manager_gameweek_history.mini_league_rank_change` | Available |
| **Manager Transfers - Transfer Details** | ✅ Ready | `manager_transfers` (player_in/out) | Available |
| **Manager Transfers - Player Names** | ✅ Ready | `players.web_name` | Available |
| **Transfer Delta Points (Δ PTS)** | ✅ Ready | `manager_transfers` + `player_gameweek_stats` | Calculate: SUM((player_in_points - player_out_points)) - fully doable |
| **Transfer Impact Badges** | ✅ Ready | Calculated from delta points | Fully doable once delta points calculated |

**Overall Status**: ✅ **100% Ready** - All components ready

**Blockers**:
- ✅ None - `teams` table created and populated

---

#### 2.3 Status Page

**Route**: `/league/status`

**Description**: Visual representation of player status for all managers in the league, showing which players are live, have played, or are yet to play.

**Bentos/Components**:

1. **Captains Section**
   - **Header**: "CAPTAINS" with "Gameweek 23" indicator
   - **List of Top Captains**:
     - Shows player name with team logo
     - Displays points scored (e.g., "14" for Haaland, "1" for others)
     - Examples: Haaland (14), Saka (1), Thiago (1), Semenyo (1), Ekitiké (1)
     - Limited to top 5 most selected captains

2. **Status Legend**
   - **Green square**: "Live" (match in progress)
   - **Blue square**: "Played" (match finished)
   - **Grey square**: "Yet to play" (match not started)
   - **Green 'C' on square**: "Captain" (captain indicator)

3. **Team Status Table**
   - **Columns**:
     - RANK: Manager's current rank
     - MANAGER: Manager name (with rank change indicator)
     - STARTING XI: Visual representation with 11 squares
       - Each square represents a player position (1-11)
       - Color-coded by status (green=Live, blue=Played, grey=Yet to play)
       - Green 'C' indicates captain
     - BENCH: Visual representation with 4 squares
       - Each square represents bench position (12-15)
       - Color-coded by status
   - **Features**:
     - Rank change indicators (▲/▼) next to rank
     - Highlighted row for current user's team
     - Visual status at a glance

**Data Dependencies**:
- Manager picks (starting XI positions 1-11, bench positions 12-15)
- Player fixture status (live/finished/upcoming)
- Captain selections
- Player minutes/status
- Fixture timing (kickoff_time, started, finished)
- Match status per player

**Supabase Support**:
- ✅ `manager_picks`
  - `position` (1-15), `is_captain`, `player_id`
- ✅ `player_gameweek_stats`
  - `minutes`, `match_finished`, `match_finished_provisional`
  - `kickoff_time`
- ✅ `fixtures`
  - `started`, `finished`, `finished_provisional`, `kickoff_time`
- ⚠️ **Status Determination Logic**: Need to join and calculate status
  - Live: `fixtures.started = true AND fixtures.finished = false`
  - Played: `fixtures.finished = true OR fixtures.finished_provisional = true`
  - Yet to play: `fixtures.started = false` OR no fixture found
  - May need view or function to determine status

**Query Example - Team Status**:
```sql
-- Get team status for all managers
SELECT 
  mgh.mini_league_rank,
  m.manager_name,
  mgh.mini_league_rank_change,
  mp.position,
  mp.is_captain,
  p.web_name as player_name,
  pgs.minutes,
  f.started as fixture_started,
  f.finished as fixture_finished,
  f.finished_provisional as fixture_finished_provisional,
  f.kickoff_time,
  -- Determine status
  CASE 
    WHEN f.started = true AND f.finished = false THEN 'live'
    WHEN f.finished = true OR f.finished_provisional = true THEN 'played'
    WHEN f.started = false OR f.kickoff_time > NOW() THEN 'yet_to_play'
    ELSE 'unknown'
  END as player_status
FROM manager_picks mp
JOIN manager_gameweek_history mgh ON mp.manager_id = mgh.manager_id 
  AND mp.gameweek = mgh.gameweek
JOIN managers m ON mp.manager_id = m.manager_id
JOIN players p ON mp.player_id = p.fpl_player_id
LEFT JOIN player_gameweek_stats pgs ON mp.player_id = pgs.player_id 
  AND mp.gameweek = pgs.gameweek
LEFT JOIN fixtures f ON pgs.fixture_id = f.fpl_fixture_id
WHERE mp.gameweek = :gameweek
  AND mp.manager_id IN (
    SELECT manager_id FROM mini_league_managers WHERE league_id = :league_id
  )
ORDER BY mgh.mini_league_rank, mp.position;
```

**Query Example - Top Captains**:
```sql
-- Get top captains by selection count
SELECT 
  p.web_name as captain_name,
  p.team_id,
  COUNT(DISTINCT mp.manager_id) as selection_count,
  AVG(pgs.total_points) as avg_points
FROM manager_picks mp
JOIN players p ON mp.player_id = p.fpl_player_id
LEFT JOIN player_gameweek_stats pgs ON mp.player_id = pgs.player_id 
  AND mp.gameweek = pgs.gameweek
WHERE mp.gameweek = :gameweek
  AND mp.is_captain = true
  AND mp.position <= 11
  AND mp.manager_id IN (
    SELECT manager_id FROM mini_league_managers WHERE league_id = :league_id
  )
GROUP BY p.fpl_player_id, p.web_name, p.team_id
ORDER BY selection_count DESC, avg_points DESC
LIMIT 5;
```

**Query Complexity**: High
- Multiple JOINs required
- Status calculation logic
- Aggregation for top captains

**Performance Considerations**:
- ⚠️ Complex query with multiple JOINs
- Consider materialized view for team status
- Index on `fixtures(fpl_fixture_id, started, finished)`
- Index on `player_gameweek_stats(fixture_id, gameweek)`
- Cache fixture status (updates during live matches)
- Consider denormalizing status in `player_gameweek_stats` if frequently accessed

**Real-time Updates**:
- During live matches: Refresh every 30-60 seconds
- Update fixture status as matches progress
- Update player minutes and points
- Highlight changes in status squares

---

#### 2.3 Status Page - Readiness Summary

| Component/Bento | Status | Data Source | Notes |
|----------------|--------|-------------|-------|
| **Top Captains - Player Names** | ✅ Ready | `manager_picks` + `players.web_name` | JOIN required |
| **Top Captains - Points** | ✅ Ready | `player_gameweek_stats.total_points` | Available |
| **Top Captains - Badges** | ✅ Ready | `teams.short_name` for badge path | Teams table created and populated |
| **Top Captains - Selection Count** | ✅ Ready | COUNT aggregation on `manager_picks` | Available |
| **Status Legend** | ✅ Ready | Client-side rendering | No data needed |
| **Team Status - Rank** | ✅ Ready | `manager_gameweek_history.mini_league_rank` | Available |
| **Team Status - Manager Name** | ✅ Ready | `managers.manager_name` | Available |
| **Team Status - Rank Change** | ✅ Ready | `manager_gameweek_history.mini_league_rank_change` | Available |
| **Team Status - Starting XI** | ✅ Ready | `manager_picks` (position 1-11) | Available |
| **Team Status - Bench** | ✅ Ready | `manager_picks` (position 12-15) | Available |
| **Team Status - Captain Indicator** | ✅ Ready | `manager_picks.is_captain` | Available |
| **Player Status - Live/Played/Yet to Play** | ✅ Ready | `fixtures` (started/finished) | Can compute status |
| **Status Squares Rendering** | ✅ Ready | Client-side from status data | No additional data needed |

**Overall Status**: ✅ **100% Ready** - All components ready

**Blockers**:
- ✅ None - `teams` table created and populated

---

### 3. Gameweek Section

#### 3.1 Matches Page

**Route**: `/gameweek/matches`

**Description**: Displays match results and fixtures for the current gameweek.

**Bentos/Components**:

1. **Match Cards**
   - **Layout**: Vertical list of match cards grouped by status (Live, Finished Provisional, Finished Final, Scheduled)
   - **Each Card Contains**:
     - **Status Badge**: "LIVE" (green), "PROVISIONAL" (grey), "FINAL" (grey), or "SCHEDULED" (grey)
     - **Team Logos**: Left team (home) and right team (away)
       - Circular team logos/crests
       - Examples: Everton (blue), Leeds (yellow), West Ham (maroon/blue), Sunderland (red), Burnley (maroon/blue), Spurs (navy/white)
     - **Score**: "X - Y" format (e.g., "0 - 1", "3 - 1", "2 - 2") or "—" for scheduled matches
     - **Date/Time**: "Mon, Jan 26 • 12:00 PM" or "Sat, Jan 24 • 4:30 AM"
     - **Minutes**: Current minute for live matches (e.g., "45'")
   - **Features**:
     - Cards sorted by status sections, then by date/time within each section
     - Visual distinction between live, provisional, final, and scheduled matches
     - **Status Determination**: Based on fixture attributes (`started`, `finished`, `finished_provisional`, `minutes`) - see query example below

**Data Dependencies**:
- Fixture data (teams, scores, status)
- Match timing (kickoff_time, finished status)
- Team information (names, logos)
- Gameweek association

**Supabase Support**:
- ✅ `fixtures`
  - `home_team_id`, `away_team_id`, `home_score`, `away_score`
  - `started`, `finished`, `finished_provisional`, `minutes`
  - `kickoff_time`, `gameweek`
- ✅ `teams` (after Phase 1 implementation)
  - `team_id`, `team_name`, `short_name`
  - Badge path: `/badges/{short_name}.svg`

**Status Determination Logic** (implemented in `LivePage.jsx`):
- **FINAL**: `started=true`, `finished=true`, `finished_provisional=true`, `minutes=90`
- **PROVISIONAL**: `started=true`, `finished=false`, `finished_provisional=true`, `minutes=90`
- **LIVE**: `started=true`, `finished=false`, `finished_provisional=false` (any minutes)
- **SCHEDULED**: `started=false`, `finished=false`, `finished_provisional=false`, `minutes=0`

**Query Example**:
```sql
-- Get all fixtures for current gameweek with team names and badges
SELECT 
  f.fpl_fixture_id,
  f.gameweek,
  f.home_team_id,
  t_home.team_name as home_team_name,
  t_home.short_name as home_team_short_name,
  CONCAT('/badges/', t_home.short_name, '.svg') as home_team_badge,
  f.away_team_id,
  t_away.team_name as away_team_name,
  t_away.short_name as away_team_short_name,
  CONCAT('/badges/', t_away.short_name, '.svg') as away_team_badge,
  f.home_score,
  f.away_score,
  f.started,
  f.finished,
  f.finished_provisional,
  f.kickoff_time,
  f.minutes,
  -- Determine status (matches LivePage.jsx implementation)
  CASE 
    WHEN f.started = true AND f.finished = true AND f.finished_provisional = true AND f.minutes = 90 THEN 'FINAL'
    WHEN f.started = true AND f.finished = false AND f.finished_provisional = true AND f.minutes = 90 THEN 'PROVISIONAL'
    WHEN f.started = true AND f.finished = false AND f.finished_provisional = false THEN 'LIVE'
    WHEN f.started = false AND f.finished = false AND f.finished_provisional = false AND f.minutes = 0 THEN 'SCHEDULED'
    ELSE 'UNKNOWN'
  END as match_status
FROM fixtures f
JOIN teams t_home ON f.home_team_id = t_home.team_id
JOIN teams t_away ON f.away_team_id = t_away.team_id
WHERE f.gameweek = :gameweek
ORDER BY f.kickoff_time;
```

**Query Complexity**: Low
- Simple SELECT with WHERE clause
- Status determination is straightforward

**Performance Considerations**:
- ✅ Simple query, well-indexed
- Index on `fixtures(gameweek, kickoff_time)`
- Cache team names/logos (rarely changes)
- Consider materialized view if frequently accessed with joins

**Real-time Updates**:
- During live matches: Refresh every 30-60 seconds
- Update scores, minutes, and status
- Highlight live matches

---

#### 3.1 Matches Page - Readiness Summary

| Component/Bento | Status | Data Source | Notes |
|----------------|--------|-------------|-------|
| **Match Cards - Fixture Data** | ✅ Ready | `fixtures` (all fields) | Available |
| **Match Cards - Home Team ID** | ✅ Ready | `fixtures.home_team_id` | Available |
| **Match Cards - Away Team ID** | ✅ Ready | `fixtures.away_team_id` | Available |
| **Match Cards - Scores** | ✅ Ready | `fixtures.home_score`, `away_score` | Available |
| **Match Cards - Status Badge** | ✅ Ready | `fixtures.started`, `finished` | Can compute LIVE/FINISHED |
| **Match Cards - Date/Time** | ✅ Ready | `fixtures.kickoff_time` | Available |
| **Match Cards - Team Names** | ✅ Ready | `teams.team_name` | Teams table created and populated |
| **Match Cards - Team Badges** | ✅ Ready | `teams.short_name` for badge path | Teams table created and populated |
| **Show Details Button** | ✅ Ready | Additional fixture data available | Expandable content ready |

**Overall Status**: ✅ **100% Ready** - All components ready

**Blockers**:
- ✅ None - `teams` table created and populated

**Missing Data**:
- ✅ Team names and logos - `teams` table created and populated

---

#### 3.2 DEFCON Page

**Route**: `/gameweek/defcon`

**Description**: Defensive contribution tracking and analysis.

**Status**: Page exists but content not fully explored during browser session.

**Potential Components** (to be confirmed):
- Defensive contribution leaderboard
- Player defensive stats
- Team defensive analysis
- DEFCON points breakdown

**Data Dependencies**:
- Defensive contribution stats
- Player defensive metrics (tackles, clearances, blocks, interceptions, recoveries)
- Player gameweek stats

**Supabase Support**:
- ✅ `player_gameweek_stats`
  - `defensive_contribution` (DEFCON field)
  - `tackles`, `clearances_blocks_interceptions`, `recoveries`
- ✅ `mv_player_gameweek_performance`
  - Includes `defcon` field
- ✅ `players` (for player names and positions)

**Query Example**:
```sql
-- Get DEFCON leaderboard for current gameweek
SELECT 
  p.web_name as player_name,
  p.position,
  pgs.defensive_contribution as defcon,
  pgs.tackles,
  pgs.clearances_blocks_interceptions,
  pgs.recoveries,
  pgs.total_points
FROM player_gameweek_stats pgs
JOIN players p ON pgs.player_id = p.fpl_player_id
WHERE pgs.gameweek = :gameweek
  AND pgs.defensive_contribution > 0
ORDER BY pgs.defensive_contribution DESC;
```

**Query Complexity**: Low to Medium
- Simple SELECT with filtering
- May need aggregation for season totals

**Performance Considerations**:
- ✅ Uses indexed table
- Index on `player_gameweek_stats(gameweek, defensive_contribution DESC)`
- Consider materialized view if frequently accessed

**Real-time Updates**:
- During live matches: Refresh every 30-60 seconds
- Update defensive stats as matches progress

---

#### 3.2 DEFCON Page - Readiness Summary

| Component/Bento | Status | Data Source | Notes |
|----------------|--------|-------------|-------|
| **DEFCON Values** | ✅ Ready | `player_gameweek_stats.defensive_contribution` | Available |
| **Player Names** | ✅ Ready | `players.web_name` | Available |
| **Player Positions** | ✅ Ready | `players.position` | Available |
| **Defensive Stats** | ✅ Ready | `player_gameweek_stats` (tackles, clearances, etc.) | Available |
| **Materialized View** | ✅ Ready | `mv_player_gameweek_performance.defcon` | Available |

**Overall Status**: ✅ **100% Ready** - All data available

**Blockers**: None

---

#### 3.3 Bonus Page

**Route**: `/gameweek/bonus`

**Description**: Bonus points tracking and analysis.

**Status**: Page exists but content not fully explored during browser session.

**Potential Components** (to be confirmed):
- Bonus points leaderboard
- Provisional vs confirmed bonus
- BPS (Bonus Points System) scores
- Bonus points by fixture

**Data Dependencies**:
- Bonus points (provisional and confirmed)
- BPS (Bonus Points System) scores
- Fixture bonus allocation
- Player gameweek stats

**Supabase Support**:
- ✅ `player_gameweek_stats`
  - `bonus` (confirmed bonus)
  - `bps` (BPS score)
  - `bonus_status` ('provisional' or 'confirmed')
- ✅ `mv_player_gameweek_performance`
  - `effective_bonus` (NULL if provisional, bonus value if confirmed)
  - `bonus_status`
- ✅ `players` (for player names)
- ✅ `fixtures` (for fixture association)

**Query Example**:
```sql
-- Get bonus points leaderboard
SELECT 
  p.web_name as player_name,
  p.position,
  pgs.bonus,
  pgs.bps,
  pgs.bonus_status,
  pgs.total_points,
  f.home_team_id,
  f.away_team_id
FROM player_gameweek_stats pgs
JOIN players p ON pgs.player_id = p.fpl_player_id
LEFT JOIN fixtures f ON pgs.fixture_id = f.fpl_fixture_id
WHERE pgs.gameweek = :gameweek
  AND (pgs.bonus > 0 OR pgs.bonus_status = 'provisional')
ORDER BY pgs.bonus DESC, pgs.bps DESC;
```

**Query Complexity**: Low to Medium
- Simple SELECT with filtering
- May need aggregation for fixture-level bonus

**Performance Considerations**:
- ✅ Uses indexed table
- Index on `player_gameweek_stats(gameweek, bonus DESC)`
- Index on `player_gameweek_stats(gameweek, bonus_status)` for provisional filtering
- Consider materialized view if frequently accessed

**Real-time Updates**:
- During live matches: Refresh every 30-60 seconds
- Update bonus status when confirmed
- Highlight provisional vs confirmed bonus

---

#### 3.3 Bonus Page - Readiness Summary

| Component/Bento | Status | Data Source | Notes |
|----------------|--------|-------------|-------|
| **Bonus Points** | ✅ Ready | `player_gameweek_stats.bonus` | Available |
| **BPS Scores** | ✅ Ready | `player_gameweek_stats.bps` | Available |
| **Bonus Status** | ✅ Ready | `player_gameweek_stats.bonus_status` | Available |
| **Player Names** | ✅ Ready | `players.web_name` | Available |
| **Player Positions** | ✅ Ready | `players.position` | Available |
| **Fixture Association** | ✅ Ready | `player_gameweek_stats.fixture_id` | Available |
| **Materialized View** | ✅ Ready | `mv_player_gameweek_performance` | Available |

**Overall Status**: ✅ **100% Ready** - All data available

**Blockers**: None

---

### 4. Research Section

#### 4.1 Statistics Page

**Route**: `/research/statistics`

**Description**: Comprehensive player performance statistics table with advanced filtering and sorting.

**Bentos/Components**:

1. **Statistics Table**
   - **Columns**:
     - PLAYER: Player name with team logo and position (FWD, MID, DEF)
     - PTS▾: Total points (sorted descending by default, indicated by down arrow)
     - G: Goals scored
     - xG: Expected goals
     - A: Assists
     - xA: Expected assists
     - GI: Goal involvements (goals + assists)
     - xGI: Expected goal involvements
     - B: Bonus points
     - BPS: Bonus Points System score
     - CRE: Creativity (ICT metric)
   - **Features**:
     - Sortable columns (default: PTS descending)
     - Color-coded value highlighting (green intensity based on value)
     - Pagination (e.g., "1 / 33" pages)
     - 13+ players visible per page

2. **Search and Filter Controls**
   - **Search Input**: "Search for players, team.."
   - **Filter Button**: "Open filters" (filter icon)
   - **View Options**: Eye icon with dropdown
   - **Information Help**: Info icon button

3. **Viewing Context**
   - **Text**: "Viewing: Actual Values" (indicates current view mode)
   - May have toggle for different view modes (Actual vs Expected, etc.)

4. **Color-Coded Highlighting**
   - Green background intensity indicates higher values
   - Relative to column values (higher = more green)
   - Examples: Haaland's 166 PTS and 20 G are highly highlighted

**Data Dependencies**:
- Player gameweek stats (all metrics)
- Player names, positions, team IDs
- Cumulative season stats (SUM across gameweeks)
- Search/filter capabilities

**Supabase Support**:
- ✅ `player_gameweek_stats`
  - All stat fields: `total_points`, `goals_scored`, `expected_goals`, `assists`, `expected_assists`, `bonus`, `bps`, `creativity`
  - Goal involvements: `goals_scored + assists` (can calculate)
  - Expected goal involvements: `expected_goal_involvements` (stored)
- ✅ `players`
  - `web_name`, `position`, `team_id`
- ⚠️ **Season Totals**: Need aggregation across all gameweeks
  - Current table has per-gameweek data
  - Need SUM/GROUP BY for season totals
  - Consider materialized view for season aggregates

**Query Example - Season Totals**:
```sql
-- Get season statistics (aggregated across all gameweeks)
SELECT 
  p.fpl_player_id,
  p.web_name as player_name,
  p.position,
  p.team_id,
  SUM(pgs.total_points) as total_points,
  SUM(pgs.goals_scored) as goals,
  SUM(pgs.expected_goals) as xg,
  SUM(pgs.assists) as assists,
  SUM(pgs.expected_assists) as xa,
  SUM(pgs.goals_scored + pgs.assists) as goal_involvements,
  SUM(pgs.expected_goal_involvements) as xgi,
  SUM(pgs.bonus) as bonus,
  SUM(pgs.bps) as bps,
  SUM(pgs.creativity) as creativity
FROM player_gameweek_stats pgs
JOIN players p ON pgs.player_id = p.fpl_player_id
WHERE pgs.gameweek <= (SELECT id FROM gameweeks WHERE is_current = true)
GROUP BY p.fpl_player_id, p.web_name, p.position, p.team_id
ORDER BY total_points DESC;
```

**Query Complexity**: Medium to High
- Aggregation across all gameweeks
- Filtering and sorting
- Search functionality

**Performance Considerations**:
- ⚠️ Aggregation query can be expensive
- Consider materialized view for season statistics
- Index on `player_gameweek_stats(player_id, gameweek)`
- Pagination reduces data transfer
- Search can use ILIKE on player names or full-text search
- Cache season totals (updates after each gameweek)

**Real-time Updates**:
- During live gameweeks: Refresh every 30-60 seconds for current gameweek
- Season totals update after gameweek completion
- Consider incremental updates rather than full recalculation

---

#### 4.1 Statistics Page - Readiness Summary

| Component/Bento | Status | Data Source | Notes |
|----------------|--------|-------------|-------|
| **Player Names** | ✅ Ready | `players.web_name` | Available |
| **Player Positions** | ✅ Ready | `players.position` | Available |
| **Total Points (PTS)** | ⚠️ Needs Aggregation | SUM(`player_gameweek_stats.total_points`) | Need season totals |
| **Goals (G)** | ⚠️ Needs Aggregation | SUM(`player_gameweek_stats.goals_scored`) | Need season totals |
| **Expected Goals (xG)** | ⚠️ Needs Aggregation | SUM(`player_gameweek_stats.expected_goals`) | Need season totals |
| **Assists (A)** | ⚠️ Needs Aggregation | SUM(`player_gameweek_stats.assists`) | Need season totals |
| **Expected Assists (xA)** | ⚠️ Needs Aggregation | SUM(`player_gameweek_stats.expected_assists`) | Need season totals |
| **Goal Involvements (GI)** | ⚠️ Needs Aggregation | SUM(goals + assists) | Calculated from aggregated data |
| **Expected GI (xGI)** | ⚠️ Needs Aggregation | SUM(`player_gameweek_stats.expected_goal_involvements`) | Need season totals |
| **Bonus Points (B)** | ⚠️ Needs Aggregation | SUM(`player_gameweek_stats.bonus`) | Need season totals |
| **BPS** | ⚠️ Needs Aggregation | SUM(`player_gameweek_stats.bps`) | Need season totals |
| **Creativity (CRE)** | ⚠️ Needs Aggregation | SUM(`player_gameweek_stats.creativity`) | Need season totals |
| **Color Highlighting** | ✅ Ready | Client-side rendering | No data needed |
| **Search/Filter** | ✅ Ready | `players.web_name`, `players.position` | Available |
| **Pagination** | ✅ Ready | Standard SQL LIMIT/OFFSET | Available |

**Overall Status**: ⚠️ **60% Ready** - Need season aggregation (materialized view recommended)

**Blockers**:
- ⚠️ Need `mv_player_season_statistics` materialized view (Phase 1 - High Priority)
- Can calculate on-demand but will be slow without materialized view

**Missing Data**:
- ⚠️ Need season aggregation view
- Consider `mv_player_season_statistics` materialized view
- Or calculate on-demand with proper indexes

---

#### 4.2 Fixtures Page

**Route**: `/research/fixtures`

**Description**: Upcoming fixtures analysis and research.

**Status**: Page exists but content not fully explored during browser session.

**Potential Components** (to be confirmed):
- Upcoming fixtures list
- Fixture difficulty analysis
- Team matchup analysis
- Fixture timing and deadlines

**Data Dependencies**:
- Future fixtures (kickoff_time > NOW())
- Team matchups
- Fixture difficulty ratings (if available)
- Gameweek deadlines

**Supabase Support**:
- ✅ `fixtures`
  - `kickoff_time`, `home_team_id`, `away_team_id`, `gameweek`
  - Filter: `WHERE kickoff_time > NOW()`
- ✅ `gameweeks`
  - `deadline_time` for transfer deadlines
- ⚠️ **Fixture Difficulty**: Not in current schema
  - May need to calculate or add field
  - Or use FPL API difficulty ratings

**Query Example**:
```sql
-- Get upcoming fixtures
SELECT 
  f.fpl_fixture_id,
  f.gameweek,
  f.home_team_id,
  f.away_team_id,
  f.kickoff_time,
  gw.deadline_time
FROM fixtures f
JOIN gameweeks gw ON f.gameweek = gw.id
WHERE f.kickoff_time > NOW()
ORDER BY f.kickoff_time;
```

**Query Complexity**: Low
- Simple SELECT with date filter

**Performance Considerations**:
- ✅ Simple query, well-indexed
- Index on `fixtures(kickoff_time)` for future fixtures
- Cache upcoming fixtures (updates infrequently)

**Real-time Updates**:
- Low priority (upcoming fixtures don't change frequently)
- Update when new gameweek fixtures are loaded

---

#### 4.2 Fixtures Page - Readiness Summary

| Component/Bento | Status | Data Source | Notes |
|----------------|--------|-------------|-------|
| **Upcoming Fixtures** | ✅ Ready | `fixtures` (kickoff_time > NOW()) | Available |
| **Fixture Timing** | ✅ Ready | `fixtures.kickoff_time` | Available |
| **Team IDs** | ✅ Ready | `fixtures.home_team_id`, `away_team_id` | Available |
| **Gameweek Association** | ✅ Ready | `fixtures.gameweek` | Available |
| **Team Names** | ✅ Ready | `teams.team_name` | Teams table created and populated |
| **Team Badges** | ✅ Ready | `teams.short_name` for badge path | Teams table created and populated |
| **Fixture Difficulty** | ❌ Not Available | Not in schema | May need to add or use FPL API |

**Overall Status**: ✅ **95% Ready** - Missing fixture difficulty (optional)

**Blockers**:
- ✅ None - `teams` table created and populated
- ⚠️ Fixture difficulty not in schema (optional feature)

---

#### 4.3 Other Page

**Route**: `/research/other`

**Description**: Additional research tools and features.

**Status**: Page exists but content not fully explored during browser session.

**Potential Components** (to be determined):
- Additional research tools
- Custom analysis features
- Export functionality

**Data Dependencies**: (To be determined)

**Supabase Support**: (To be determined)

---

#### 4.3 Other Page - Readiness Summary

| Component/Bento | Status | Data Source | Notes |
|----------------|--------|-------------|-------|
| **Components** | ❓ Unknown | TBD | Page not fully explored |

**Overall Status**: ❓ **Unknown** - Page content not fully explored during browser session

**Blockers**: Need to determine page requirements

---

## Common UI Elements

### 1. Search Functionality

**Locations**:
- League section: "Search for players.."
- Research section: "Search for players, team.."

**Functionality**:
- Filter managers/players in tables
- Real-time search as user types
- Case-insensitive matching

**Data Dependencies**:
- Player names (`players.web_name`)
- Manager names (`managers.manager_name`)
- Team names (if team search enabled)

**Supabase Support**:
- ✅ `players.web_name` - For player search
- ✅ `managers.manager_name` - For manager search
- ⚠️ Team names not in schema (need team lookup)

**Implementation**:
- Client-side filtering (for small datasets)
- Or SQL ILIKE query: `WHERE web_name ILIKE '%search%'`
- Or full-text search for better performance

**Performance Considerations**:
- Index on `players(web_name)` for fast search
- Consider full-text search index for large datasets
- Debounce search input to reduce queries

---

### 2. Filter Controls

**Locations**:
- Research section: "Open filters" button

**Functionality**:
- Filter by position (GK, DEF, MID, FWD)
- Filter by team
- Filter by value ranges (points, goals, etc.)
- Filter by ownership (in league teams)

**Data Dependencies**:
- Player positions (`players.position`)
- Team IDs (`players.team_id`)
- Stat ranges (from `player_gameweek_stats`)
- Ownership data (`player_whitelist` or `manager_picks`)

**Supabase Support**:
- ✅ `players.position` - Position filter
- ✅ `players.team_id` - Team filter
- ✅ `player_gameweek_stats` - Stat range filters
- ✅ `player_whitelist` - Ownership filter (players owned by league managers)

**Implementation**:
- Add WHERE clauses to queries based on filter selection
- Combine multiple filters with AND conditions

**Performance Considerations**:
- Index on `players(position, team_id)` for filter combinations
- Index on `player_gameweek_stats(gameweek, total_points)` for range filters
- Consider materialized view for filtered views

---

### 3. View Options Toggle

**Locations**:
- Research section: "View Options" (eye icon)

**Functionality**:
- Toggle between view modes (e.g., "Actual Values" vs "Expected Values")
- May include other view preferences

**Data Dependencies**:
- Same as Statistics page
- May toggle between actual stats and expected stats (xG, xA, etc.)

**Supabase Support**:
- ✅ All data available in `player_gameweek_stats`
- Actual: `goals_scored`, `assists`, etc.
- Expected: `expected_goals`, `expected_assists`, etc.

**Implementation**:
- Client-side toggle (same data, different columns displayed)
- Or separate queries for different view modes

**Performance Considerations**:
- No additional query needed if client-side toggle
- Same performance considerations as Statistics page

---

### 4. Pagination Controls

**Locations**:
- Research Statistics page: "1 / 33" with Previous/Next buttons

**Functionality**:
- Navigate through paginated results
- Show current page and total pages
- Disable Previous on first page, Next on last page

**Data Dependencies**:
- Total count of results
- Page size (items per page)
- Current page number

**Supabase Support**:
- ✅ Standard SQL pagination with LIMIT and OFFSET
- ✅ COUNT(*) for total pages

**Implementation**:
```sql
-- Get paginated results
SELECT * FROM ...
ORDER BY ...
LIMIT :page_size OFFSET :offset;

-- Get total count
SELECT COUNT(*) FROM ...;
```

**Performance Considerations**:
- Use LIMIT/OFFSET for pagination
- Consider cursor-based pagination for large datasets
- Cache total count if it doesn't change frequently
- Index on ORDER BY columns for fast sorting

---

### 5. Status Badges/Indicators

**Locations**:
- Throughout the application

**Types**:
- "LIVE" (green) - Match in progress
- "FINISHED" (grey) - Match completed
- "UPCOMING" - Match not started
- Rank change indicators (▲ green, ▼ red)
- Chip indicators ("Triple Captain", etc.)
- Provisional indicator (⚠️ or yellow highlight)

**Data Dependencies**:
- Fixture status (`fixtures.started`, `fixtures.finished`)
- Rank changes (`manager_gameweek_history.mini_league_rank_change`)
- Chip usage (`manager_gameweek_history.active_chip`)
- Provisional status (`manager_gameweek_history.is_provisional`)

**Supabase Support**:
- ✅ All data available in existing tables
- Status calculated from fixture data
- Rank changes stored in `manager_gameweek_history`

**Implementation**:
- Client-side rendering based on data values
- No additional queries needed

**Performance Considerations**:
- No performance impact (client-side rendering)
- Data already included in main queries

---

### 6. Expandable Sections ("Show more" buttons)

**Locations**:
- Transfers page: "Show more" for top transfers
- Matches page: "Show Details" for match cards
- Various tables: Expandable rows

**Functionality**:
- Show/hide additional content
- Load more items (pagination)
- Expand row details

**Data Dependencies**:
- Same as parent component
- May need additional detail queries when expanded

**Supabase Support**:
- ✅ Depends on parent component data
- May need additional queries for expanded content

**Implementation**:
- Client-side expansion (no additional query)
- Or lazy-load additional data when expanded

**Performance Considerations**:
- Lazy-load expanded content to reduce initial load
- Cache expanded content if user expands multiple items

---

## Data Dependency Analysis

### Summary by Component Type

#### Simple SELECT Queries (Low Complexity)
- **Matches Page**: Simple fixture listing
- **Fixtures Page**: Upcoming fixtures
- **Status Badges**: Client-side rendering

**Performance**: ✅ Excellent - Well-indexed, fast queries

#### JOIN Queries (Medium Complexity)
- **Standings Page**: Materialized view + captain lookup
- **Transfers Page**: Top transfers from materialized view
- **Status Page**: Multiple JOINs for team status
- **Home Page**: Manager summary with previous gameweek JOIN, player table with multiple JOINs

**Performance**: ✅ Good - Uses materialized views where possible, proper indexes

#### Aggregation Queries (High Complexity)
- **Statistics Page**: Season totals (SUM across gameweeks)
- **Transfers Page**: Transfer point impacts (calculations)
- **Home Page**: Transfer delta points (SUM of point impacts)
- **Top Captains**: COUNT and AVG aggregations

**Performance**: ⚠️ Needs Optimization - Consider materialized views

---

### Required Tables Summary

| Table | Used By | Critical Fields |
|-------|---------|----------------|
| `gameweeks` | All pages | `id`, `is_current`, `name`, `deadline_time` |
| `players` | All pages | `fpl_player_id`, `web_name`, `position`, `team_id` |
| `player_gameweek_stats` | Statistics, Status, DEFCON, Bonus, Home | All stat fields |
| `manager_gameweek_history` | Standings, Transfers, Status, Home | `gameweek_points`, `total_points`, `overall_rank`, `overall_rank_change` ⚠️ (CRITICAL), `mini_league_rank`, `mini_league_rank_change`, `team_value_tenths`, `bank_tenths`, `transfers_made`, `active_chip` |
| `manager_picks` | Standings, Status, Home | `position`, `is_captain`, `player_id`, `multiplier` |
| `manager_transfers` | Transfers, Home | `player_in_id`, `player_out_id`, `net_price_change_tenths` |
| `fixtures` | Matches, Status, Bonus, Home | `started`, `finished`, `kickoff_time`, `home_score`, `away_score` |
| `mini_leagues` | All league pages, Home | `league_id`, `league_name` |
| `mini_league_managers` | All league pages, Home | `league_id`, `manager_id` |
| `managers` | All pages | `manager_id`, `manager_name` |
| `teams` | Matches, Status, Home, All pages | `team_id`, `team_name`, `short_name` (for badges) |

---

### Required Materialized Views Summary

| Materialized View | Used By | Refresh Frequency |
|-------------------|---------|-------------------|
| `mv_mini_league_standings` | Standings | After gameweek updates |
| `mv_league_transfer_aggregation` | Transfers | After gameweek updates |
| `mv_manager_gameweek_summary` | Various | After gameweek updates |
| `mv_player_gameweek_performance` | DEFCON, Bonus | After gameweek updates |

---

## Performance Optimization Opportunities

### 1. Materialized Views for Expensive Queries

**High Priority**:
- ✅ `mv_mini_league_standings` - Already exists, used by Standings page
- ✅ `mv_league_transfer_aggregation` - Already exists, used by Transfers page
- ⚠️ **NEW**: `mv_player_season_statistics` - For Statistics page season totals
  - Aggregates `player_gameweek_stats` across all gameweeks
  - Reduces expensive SUM/GROUP BY queries
  - Refresh after each gameweek completion

**Medium Priority**:
- ⚠️ **NEW**: `mv_manager_transfer_impacts` - For Transfers page point impacts
  - Pre-calculates transfer point differences
  - Reduces JOIN and calculation overhead
  - Refresh during live gameweeks

- ⚠️ **NEW**: `mv_team_status_summary` - For Status page
  - Pre-calculates player status per manager
  - Reduces complex JOIN queries
  - Refresh during live matches

**Low Priority**:
- Consider materialized views for filtered Statistics views
- Consider materialized view for top captains

---

### 2. Index Optimization

**Existing Indexes** (from schema):
- ✅ `idx_gameweeks_is_current` - Fast current gameweek lookup
- ✅ `idx_pgws_player_gw` - Fast player stats lookup
- ✅ `idx_mgh_manager_gw` - Fast manager history lookup
- ✅ `idx_manager_picks_manager_gw` - Fast picks lookup
- ✅ `idx_fixtures_gameweek` - Fast fixture lookup

**Additional Indexes Needed**:
- ⚠️ `idx_player_gameweek_stats_gameweek_total_points` - For Statistics page sorting
- ⚠️ `idx_manager_picks_captain` - For captain lookups: `(manager_id, gameweek, is_captain)` WHERE `is_captain = true`
- ⚠️ `idx_fixtures_status` - For status determination: `(started, finished, kickoff_time)`
- ⚠️ `idx_players_web_name` - For search: Full-text search index on `web_name`

---

### 3. Caching Strategy

**Static/Semi-Static Data** (Cache for hours/days):
- Team names and logos
- Player names and positions (bootstrap data)
- League metadata
- Historical gameweek data (finished gameweeks)

**Dynamic Data** (Cache for 30-60 seconds):
- Current gameweek standings
- Live match scores and status
- Player points during live matches
- Manager picks and transfers

**Cache Implementation**:
- Use Supabase caching or application-level caching
- Cache materialized views (refresh triggers cache invalidation)
- Cache search results with short TTL

---

### 4. Query Optimization

**Reduce Data Transfer**:
- Use column selection (only fetch needed columns)
- Implement pagination for large result sets
- Use LIMIT for top N queries (top transfers, top captains)

**Reduce Query Complexity**:
- Pre-calculate aggregations in materialized views
- Denormalize frequently joined data (if appropriate)
- Use EXISTS instead of JOINs where possible

**Reduce Query Frequency**:
- Batch multiple queries into single requests
- Use WebSocket or polling for real-time updates (not per-component)
- Cache frequently accessed data

---

### 5. Real-time Update Strategy

**Update Frequency by Component**:

| Component | Update Frequency | Priority |
|-----------|------------------|----------|
| Standings | 30-60 seconds (live) | High |
| Status Page | 30-60 seconds (live) | High |
| Matches | 30-60 seconds (live) | High |
| Transfers | 30-60 seconds (live) | Medium |
| Statistics | After gameweek completion | Low |
| DEFCON | 30-60 seconds (live) | Medium |
| Bonus | 30-60 seconds (live) | Medium |

**Implementation**:
- Polling: Frontend polls API every 30-60 seconds during live gameweeks
- WebSocket: Real-time updates via Supabase Realtime (if enabled)
- Incremental Updates: Only update changed rows/values
- Highlight Changes: Visual indicators for updated data

---

## Missing Data and Gaps

### 1. Team Names, Abbreviations, and Badges

**Issue**: `fixtures` and `players` tables have `team_id` (integer 1-20) but not team names, abbreviations, or badge references.

**Impact**: 
- Matches page cannot display team names
- Status page cannot show team logos for captains
- Home page player table cannot show opponent team names
- Various pages need team information and badge display

**Solution - Lean Approach** (Recommended):

1. **Add Minimal `teams` Table**:
   ```sql
   CREATE TABLE teams (
     team_id INTEGER PRIMARY KEY,  -- FPL team ID (1-20)
     team_name TEXT NOT NULL,      -- Full name: "Arsenal"
     short_name TEXT NOT NULL,     -- Abbreviation: "ARS" (used for badge filename)
     created_at TIMESTAMPTZ DEFAULT NOW(),
     updated_at TIMESTAMPTZ DEFAULT NOW()
   );
   ```
   - **No separate mapping table needed** - `short_name` IS the badge filename
   - Badge path: `/badges/{short_name}.svg` (e.g., `/badges/ARS.svg`)
   - Populate from FPL API bootstrap data (`/api/bootstrap-static/` → `teams` array)
   - Teams update infrequently (only on season start or team changes)

2. **Badge File Structure**:
   ```
   frontend/public/badges/
     ARS.svg
     MCI.svg
     LIV.svg
     ...
   ```
   - File names match `teams.short_name` exactly (case-sensitive or lowercase)
   - Frontend can construct path: `/badges/${team.short_name}.svg`

3. **Query Pattern**:
   ```sql
   -- Get team info with badge path
   SELECT 
     t.team_id,
     t.team_name,
     t.short_name,
     CONCAT('/badges/', t.short_name, '.svg') as badge_path
   FROM teams t
   WHERE t.team_id = :team_id;
   ```

**Benefits of This Approach**:
- ✅ **No mapping table** - `short_name` directly maps to filename
- ✅ **Fast queries** - Single table lookup, no JOINs needed
- ✅ **Simple frontend** - Just concatenate `/badges/{short_name}.svg`
- ✅ **Minimal storage** - Only essential fields
- ✅ **Easy updates** - Update `teams` table when FPL updates bootstrap data

**Alternative Approaches** (Not Recommended):
- ❌ Separate `team_badges` mapping table - Unnecessary complexity
- ❌ Store badge paths in database - File paths should be frontend concern
- ❌ Denormalize team names in all tables - Data duplication

**Recommendation**: ✅ **YES - Create `teams` table now** with `short_name` (abbreviation) attribute to join with badge files.

**Teams Table Structure** (Confirmed):
```sql
CREATE TABLE teams (
  team_id INTEGER PRIMARY KEY,  -- FPL team ID (1-20)
  team_name TEXT NOT NULL,      -- Full name: "Arsenal"
  short_name TEXT NOT NULL,     -- Abbreviation: "ARS" (used for badge filename)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups
CREATE INDEX idx_teams_team_id ON teams(team_id);
```

**Badge File Mapping**:
- Badge folder location: `frontend/public/badges/` (or `frontend/src/assets/badges/`)
- Badge file naming: Match `teams.short_name` exactly (e.g., "ARS.svg", "MCI.svg")
- Case sensitivity: Ensure badge filenames match `short_name` case (typically uppercase: "ARS", "MCI", "LIV")
- Frontend usage: `const badgePath = `/badges/${team.short_name}.svg`;`
- Join pattern: `players.team_id` → `teams.team_id` → `teams.short_name` → badge path
- Fallback: Consider fallback badge if file missing (e.g., generic team icon)

**Why This Approach**:
- ✅ **Lean**: No separate mapping table needed - `short_name` IS the filename
- ✅ **Fast**: Single table lookup, no extra JOINs
- ✅ **Simple**: Frontend just concatenates `/badges/{short_name}.svg`
- ✅ **Maintainable**: Update teams table when FPL updates (infrequent)

---

### 2. Season Statistics Aggregation

**Issue**: Statistics page needs season totals (SUM across all gameweeks), but current schema only has per-gameweek data.

**Impact**: 
- Statistics page requires expensive aggregation query
- Slow load times for season statistics

**Solutions**:
1. **Materialized View** (Recommended):
   ```sql
   CREATE MATERIALIZED VIEW mv_player_season_statistics AS
   SELECT 
     player_id,
     SUM(total_points) as total_points,
     SUM(goals_scored) as goals,
     -- ... other aggregations
   FROM player_gameweek_stats
   GROUP BY player_id;
   ```
2. **Calculate On-Demand**: Accept slower queries with proper indexes
3. **Incremental Updates**: Update season totals after each gameweek

**Recommendation**: Create `mv_player_season_statistics` materialized view.

---

### 3. Transfer Point Impact Calculation

**Issue**: Transfers page shows point impact (Δ PTS), but this requires calculating points difference between transferred players.

**Impact**: 
- Complex query with JOINs and calculations
- May be slow for large leagues

**Solutions**:
1. **Materialized View** (Recommended):
   ```sql
   CREATE MATERIALIZED VIEW mv_manager_transfer_impacts AS
   SELECT 
     mt.manager_id,
     mt.gameweek,
     mt.player_in_id,
     mt.player_out_id,
     COALESCE(pgs_in.total_points, 0) - COALESCE(pgs_out.total_points, 0) as point_impact
   FROM manager_transfers mt
   LEFT JOIN player_gameweek_stats pgs_in ON mt.player_in_id = pgs_in.player_id AND mt.gameweek = pgs_in.gameweek
   LEFT JOIN player_gameweek_stats pgs_out ON mt.player_out_id = pgs_out.player_id AND mt.gameweek = pgs_out.gameweek;
   ```
2. **Calculate On-Demand**: Accept slower queries
3. **Store in `manager_transfers`**: Add `point_impact` field (denormalization)

**Recommendation**: ✅ **IMPLEMENTED** - `mv_manager_transfer_impacts` materialized view created (migration 009).

---

### 4. Player Status Determination

**Issue**: Status page needs to determine if player is "Live", "Played", or "Yet to play", which requires joining `manager_picks`, `player_gameweek_stats`, and `fixtures`.

**Impact**: 
- Complex query with multiple JOINs
- May be slow for large leagues

**Solutions**:
1. **Materialized View** (Recommended):
   ```sql
   CREATE MATERIALIZED VIEW mv_team_status_summary AS
   SELECT 
     mp.manager_id,
     mp.gameweek,
     mp.position,
     mp.is_captain,
     CASE 
       WHEN f.started = true AND f.finished = false THEN 'live'
       WHEN f.finished = true OR f.finished_provisional = true THEN 'played'
       WHEN f.started = false OR f.kickoff_time > NOW() THEN 'yet_to_play'
       ELSE 'unknown'
     END as player_status
   FROM manager_picks mp
   LEFT JOIN player_gameweek_stats pgs ON mp.player_id = pgs.player_id AND mp.gameweek = pgs.gameweek
   LEFT JOIN fixtures f ON pgs.fixture_id = f.fpl_fixture_id;
   ```
2. **Denormalize Status**: Add `player_status` field to `player_gameweek_stats` (less flexible)
3. **Calculate On-Demand**: Accept slower queries with proper indexes

**Recommendation**: Create `mv_team_status_summary` materialized view.

---

### 5. Search Functionality

**Issue**: Search uses ILIKE which may be slow for large datasets.

**Impact**: 
- Slow search queries
- Poor user experience

**Solutions**:
1. **Full-Text Search Index** (Recommended):
   ```sql
   CREATE INDEX idx_players_web_name_fts ON players USING gin(to_tsvector('english', web_name));
   ```
2. **Client-Side Filtering**: For small datasets (< 1000 items)
3. **Search Service**: Use external search service (Elasticsearch, etc.)

**Recommendation**: Use full-text search index for better performance.

---

### 6. Overall Rank Change Calculation

**Issue**: Home page needs overall rank change, which is a **CRITICAL** feature for FPL user experience. Users want to see green/+ (moved up) or red/- (moved down) arrows.

**Impact**: 
- **Vital UX Feature**: Rank change indicators are essential for FPL experience
- Need reliable computation method
- FPL API may eventually provide this (similar to overall rank and gameweek rank), but we need to compute it in the meantime

**Computation Method** (Current - Reliable):
- Compare current gameweek `overall_rank` vs previous gameweek `overall_rank`
- **Important**: In FPL, lower rank number = better (rank 1 is best, rank 10000 is worse)
- Formula: `overall_rank_change = previous_overall_rank - current_overall_rank`
- **Example**: If previous rank = 5000, current rank = 3000 (improved):
  - Change = 5000 - 3000 = +2000 (positive)
  - Positive value = moved up/improved (better rank, lower number) = Green arrow ▲
- **Example**: If previous rank = 3000, current rank = 5000 (worsened):
  - Change = 3000 - 5000 = -2000 (negative)
  - Negative value = moved down/worsened (worse rank, higher number) = Red arrow ▼
- NULL if no previous gameweek data (first gameweek)

**Solutions**:
1. **Calculate in Query** (Current Implementation - Recommended):
   ```sql
   LEFT JOIN manager_gameweek_history prev_mgh 
     ON m.manager_id = prev_mgh.manager_id 
     AND prev_mgh.gameweek = mgh.gameweek - 1
   SELECT 
     prev_mgh.overall_rank - mgh.overall_rank as overall_rank_change,
     CASE 
       WHEN prev_mgh.overall_rank - mgh.overall_rank > 0 THEN 'up'  -- Green arrow ▲ (moved up)
       WHEN prev_mgh.overall_rank - mgh.overall_rank < 0 THEN 'down'  -- Red arrow ▼ (moved down)
       ELSE 'same'
     END as rank_change_direction
   ```
   - ✅ Reliable: Always accurate if previous gameweek data exists
   - ✅ Fast: Single JOIN with indexed fields
   - ✅ Works immediately: No need to wait for FPL API

2. **Store in Table** (Hybrid Approach - Recommended):
   ```sql
   -- Add field to manager_gameweek_history
   ALTER TABLE manager_gameweek_history 
   ADD COLUMN overall_rank_change INTEGER;
   
   -- Compute and store when refreshing data
   -- Formula: previous_rank - current_rank
   -- Positive = improved (green ▲), Negative = worsened (red ▼)
   UPDATE manager_gameweek_history mgh
   SET overall_rank_change = (
     SELECT prev_mgh.overall_rank - mgh.overall_rank
     FROM manager_gameweek_history prev_mgh
     WHERE prev_mgh.manager_id = mgh.manager_id
       AND prev_mgh.gameweek = mgh.gameweek - 1
   )
   WHERE mgh.gameweek = :current_gameweek;
   ```
   - ✅ Store computed value for fast queries
   - ✅ Update when FPL API provides it (if available)
   - ✅ Fallback to computation if FPL API doesn't provide it
   - ✅ Best of both worlds: Fast queries + reliable computation

3. **FPL API Integration** (Future):
   - Monitor FPL API for `overall_rank_change` field (if/when added)
   - Store API value when available (more accurate for edge cases)
   - Fallback to computation if API doesn't provide it

**Recommendation**: 
- **Immediate**: Use query-based calculation (already implemented) - it's reliable and fast
- **Optimization**: Add `overall_rank_change` field to `manager_gameweek_history` table
  ```sql
  -- Migration: Add overall_rank_change field
  ALTER TABLE manager_gameweek_history 
  ADD COLUMN IF NOT EXISTS overall_rank_change INTEGER;
  
  -- Compute and populate for all existing data
  -- Formula: previous_rank - current_rank
  -- Positive = improved (green ▲), Negative = worsened (red ▼)
  UPDATE manager_gameweek_history mgh
  SET overall_rank_change = (
    SELECT prev_mgh.overall_rank - mgh.overall_rank
    FROM manager_gameweek_history prev_mgh
    WHERE prev_mgh.manager_id = mgh.manager_id
      AND prev_mgh.gameweek = mgh.gameweek - 1
  )
  WHERE mgh.overall_rank IS NOT NULL;
  ```
  - Compute and store during data refresh
  - Use stored value for fast queries
  - Update with FPL API value if/when available
- **Critical**: Ensure computation is always available - this is a vital UX feature (green/red arrows)
- **Backend Implementation**: Compute `overall_rank_change` during `refresh_manager_gameweek_history()` function

---

### 7. Gameweek Rank

**Issue**: Home page shows gameweek rank, but this is not stored in current schema.

**Impact**: 
- Need to calculate rank among all managers for current gameweek
- Or use FPL API rank (stale is acceptable)

**FPL API Update Timing**:
- FPL API does update gameweek rank, but timing is unclear
- Likely updates when bonuses are officially added (after provisional period)
- Stale data is acceptable per requirements - updates are infrequent

**Solutions**:
1. **Use FPL API** (Recommended for accuracy):
   - Fetch from `/api/entry/{manager_id}/event/{gameweek}/`
   - Field: `event_total` and `rank` (if available)
   - Store in `manager_gameweek_history.gameweek_rank` when available
   - Accept stale data - refresh when FPL API updates

2. **Calculate On-Demand** (Fallback):
   ```sql
   SELECT 
     manager_id,
     total_points,
     ROW_NUMBER() OVER (ORDER BY total_points DESC) as calculated_gameweek_rank
   FROM manager_gameweek_history
   WHERE gameweek = :gameweek
   ```
   - Only accurate for tracked managers (not all 11M+ managers)
   - Use as fallback if FPL API rank unavailable

3. **Store in Table** (If FPL API provides):
   - Add `gameweek_rank` field to `manager_gameweek_history`
   - Update when FPL API provides rank (after bonuses confirmed)
   - Mark as stale/estimated if not yet available

**Recommendation**: Use FPL API rank when available (updates when bonuses are officially added). Store in `manager_gameweek_history.gameweek_rank`. Accept stale data - refresh periodically. Use calculated rank as fallback for tracked managers only.

---

### 8. Manager Configuration System

**Issue**: Need system to configure which managers to display on Home page (up to 75 managers across 3 leagues).

**Impact**: 
- Need way to mark managers as "configured" or "tracked"
- Need filtering/selection UI

**Solutions**:
1. **Configuration Table** (Recommended):
   ```sql
   CREATE TABLE configured_managers (
     id BIGSERIAL PRIMARY KEY,
     manager_id BIGINT NOT NULL REFERENCES managers(manager_id),
     league_id BIGINT REFERENCES mini_leagues(league_id),
     is_active BOOLEAN DEFAULT true,
     display_order INTEGER,
     created_at TIMESTAMPTZ DEFAULT NOW()
   );
   ```
2. **Use Existing `mini_league_managers`**: All managers in tracked leagues are "configured"
3. **Application-Level Config**: Store in frontend/backend config

**Recommendation**: Use existing `mini_league_managers` table - all managers in tracked leagues are available. Add `configured_managers` table only if need to subset or reorder.

---

### 9. Performance Graph Leader Overlay

**Issue**: Performance graph needs to fetch mini-league leader's historical data for overlay comparison.

**Impact**: 
- Additional query needed for leader's data
- Need to identify leader (from `mv_mini_league_standings`)

**Solutions**:
1. **Query Leader Data** (Recommended):
   ```sql
   -- Get leader's manager_id
   SELECT manager_id FROM mv_mini_league_standings 
   WHERE league_id = :league_id 
   ORDER BY total_points DESC LIMIT 1;
   
   -- Get leader's historical data
   SELECT gameweek, overall_rank, total_points
   FROM manager_gameweek_history
   WHERE manager_id = :leader_manager_id
   ORDER BY gameweek;
   ```
2. **Cache Leader Data**: Cache leader's historical data (updates infrequently)
3. **Materialized View**: Create view with leader comparison pre-calculated

**Recommendation**: Query approach is fine. Cache leader data for better performance.

---

## Implementation Priority

### Phase 1: Critical (Required for MVP)
1. ✅ Verify all existing materialized views support UI components
2. ✅ Add minimal `teams` table (`team_id`, `team_name`, `short_name`) for team names and badge mapping - **COMPLETE**
   - Populate from FPL API bootstrap data - **COMPLETE**
   - Use `short_name` directly as badge filename (no mapping table needed) - **COMPLETE**
3. ⚠️ **CRITICAL**: Add `overall_rank_change` field to `manager_gameweek_history` table
   - Compute during data refresh: `previous_overall_rank - current_overall_rank`
   - Store for fast queries (vital UX feature - green/red arrows)
   - Update with FPL API value if/when available (fallback to computation)
4. ⚠️ Create `mv_player_season_statistics` for Statistics page
5. ⚠️ Add indexes for search and filtering
6. ✅ Home page data fully supported by existing schema (overall rank change calculation in query)
7. ⚠️ Add `gameweek_rank` field to `manager_gameweek_history` (populate from FPL API when available)

### Phase 2: High Priority (Performance Optimization)
1. ✅ Create `mv_manager_transfer_impacts` for Transfers page - **COMPLETE** (migration 009)
2. ⚠️ Create `mv_team_status_summary` for Status page
3. ⚠️ Implement caching strategy
4. ⚠️ Optimize real-time update polling

### Phase 3: Medium Priority (Enhanced Features)
1. Full-text search implementation
2. Additional materialized views for filtered views
3. WebSocket real-time updates (if needed)
4. Advanced filtering and sorting

---

## Summary

### Data Coverage
- ✅ **95%+ Coverage**: Most UI components can be built with existing Supabase schema
- ✅ **Home Page**: Fully supported - all manager stats available in `manager_gameweek_history`
- ⚠️ **Gaps Identified**: Team names/logos, season aggregations, transfer impacts, status calculations
- ✅ **Materialized Views**: Existing views support key pages (Standings, Transfers, Home league rank)

### Performance Readiness
- ✅ **Well-Indexed**: Core tables have proper indexes
- ✅ **Materialized Views**: Key aggregations pre-calculated
- ⚠️ **Optimization Needed**: Statistics page, Status page, Transfer impacts
- ✅ **Query Complexity**: Most queries are Low to Medium complexity

### Next Steps
1. **Create Missing Tables/Views**: Teams table, season statistics view, transfer impacts view
2. **Add Indexes**: Search indexes, status indexes, captain indexes
3. **Implement Caching**: Cache static data, cache materialized views
4. **Optimize Queries**: Use materialized views, reduce JOINs, implement pagination
5. **Iterate with User**: Walk through additional "bentos" and refine documentation

---

---

## Overall Readiness Summary

### Page-by-Page Status

| Page | Overall Status | Ready % | Critical Blockers | Notes |
|------|---------------|---------|-------------------|-------|
| **Home** | ✅ Ready | 100% | None | All components ready |
| **League / Standings** | ✅ Ready | 100% | None | All components ready |
| **League / Transfers** | ✅ Ready | 100% | None | All components ready |
| **League / Status** | ✅ Ready | 100% | None | All components ready |
| **Gameweek / Matches** | ✅ Ready | 100% | None | All components ready |
| **Gameweek / DEFCON** | ✅ Ready | 100% | None | Fully ready |
| **Gameweek / Bonus** | ✅ Ready | 100% | None | Fully ready |
| **Research / Statistics** | ⚠️ Needs Work | 60% | Season aggregation view | Need materialized view for performance |
| **Research / Fixtures** | ✅ Ready | 95% | Fixture difficulty (optional) | All components ready |
| **Research / Other** | ❓ Unknown | ? | TBD | Page not fully explored |

### Critical Dependencies

| Dependency | Status | Impact | Priority |
|------------|--------|--------|----------|
| **`teams` table** | ✅ Created | Team names/badges available on all pages | **Complete** |
| **Season Statistics View** | ⚠️ Missing | Blocks Statistics page performance | **Phase 1 - High** |
| **Transfer Delta Calculation** | ✅ Ready | Fully doable with JOIN | **No blocker** - Works with current schema |
| **Overall Rank Change Field** | ⚠️ Can compute | Works in query, should store | **Phase 1 - Medium** |
| **Gameweek Rank** | ⚠️ Partial | Can use FPL API or compute | **Phase 1 - Low** |

### Overall Assessment

**✅ 95% Ready Overall**

- **Fully Ready Pages**: Home (100%), Standings (100%), Transfers (100%), Status (100%), Matches (100%), DEFCON (100%), Bonus (100%), Fixtures (95%)
- **Needs Work**: Statistics (60%) - requires season aggregation
- **Unknown**: Other page - needs exploration

**Critical Path to MVP**:
1. ✅ `teams` table created and populated - **COMPLETE**
2. ⚠️ Create `mv_player_season_statistics` (unblocks Statistics page)
3. ⚠️ Add `overall_rank_change` field (optimization, but works in query)
4. ✅ Transfer delta points - **Fully doable** with current schema (no blocker)

**After Phase 1**: All pages will be 95%+ ready. Only Statistics page needs season aggregation view.

---

---

## Final Confirmation: Backend Support for Frontend Elements

### ✅ Confirmed: Backend Can Support All Frontend Elements

**Critical Requirements Met**:

1. **✅ Manager Team Snapshots (Before/After Deadline)**
   - `manager_picks` table stores complete team state per gameweek
   - Can compare `manager_picks` between gameweeks to identify transfers
   - `manager_transfers` table provides explicit transfer records
   - **Status**: Fully supported - teams stored before and after deadline

2. **✅ Transfer Delta Points Calculation**
   - Formula: SUM((player_in_points - player_out_points)) for all transfers
   - Data available: `manager_transfers` (player_in_id, player_out_id) + `player_gameweek_stats` (total_points)
   - Player names available: `players.web_name` for rendering
   - **Status**: Fully doable with current schema

3. **✅ Teams Table with Abbreviation**
   - Structure: `team_id`, `team_name`, `short_name` (abbreviation)
   - Badge mapping: `short_name` directly maps to badge filename (`/badges/{short_name}.svg`)
   - Join pattern: `players.team_id` → `teams.team_id` → `teams.short_name` → badge path
   - **Status**: Ready to create - confirmed structure

4. **✅ Opponent Badge Display**
   - Logic: `player_gameweek_stats.team_id` + `fixtures` (home/away) → determine opponent
   - Badge: Join to `teams` table to get opponent's `short_name` for badge path
   - **Status**: Fully doable with teams table

### Backend Schema Support Summary

| Frontend Element | Backend Support | Data Source | Status |
|------------------|-----------------|-------------|--------|
| **Manager Teams (Before Deadline)** | ✅ Supported | `manager_picks` (previous gameweek) | Ready |
| **Manager Teams (After Deadline)** | ✅ Supported | `manager_picks` (current gameweek) | Ready |
| **Transfer Identification** | ✅ Supported | `manager_transfers` OR compare `manager_picks` | Ready |
| **Transfer Delta Points** | ✅ Supported | `manager_transfers` + `player_gameweek_stats` | Ready |
| **Transfer Player Names** | ✅ Supported | `manager_transfers` + `players.web_name` | Ready |
| **Team Badges** | ✅ Supported | `teams.short_name` → `/badges/{short_name}.svg` | Ready - teams table created |
| **Opponent Badges** | ✅ Supported | `fixtures` + `teams.short_name` | Ready - teams table created |
| **Player Team Badges** | ✅ Supported | `players.team_id` + `teams.short_name` | Ready - teams table created |

### Implementation Checklist

**Phase 1 - Critical (Required for MVP)**:
- [x] ✅ Create `teams` table with `team_id`, `team_name`, `short_name` - **COMPLETE**
- [x] ✅ Populate `teams` table from FPL API bootstrap data - **COMPLETE**
- [ ] ✅ Ensure `manager_picks` are stored before and after deadline (already implemented)
- [ ] ✅ Verify `manager_transfers` table captures all transfers
- [ ] ✅ Test transfer delta points calculation query
- [ ] ✅ Test opponent badge lookup query

**Phase 2 - Optimization**:
- [ ] Create `mv_player_season_statistics` for Statistics page
- [ ] Add `overall_rank_change` field to `manager_gameweek_history`
- [ ] Consider materialized view for transfer delta points (if performance needed)

### Conclusion

**✅ YES - We have a good understanding of how our backend can support these frontend elements.**

**All critical requirements are met**:
1. ✅ Manager teams stored before/after deadline (`manager_picks` per gameweek)
2. ✅ Transfer delta points fully calculable (SUM of point differences)
3. ✅ Player names available for rendering (`players.web_name`)
4. ✅ Teams table structure confirmed (with `short_name` for badge mapping)
5. ✅ Opponent badges doable (via fixtures + teams table)

**✅ All critical blockers resolved**: `teams` table created and populated

**Current status**: 100% of frontend elements are supported by backend (except Statistics page which needs season aggregation view).

---

**Last Updated**: 2026-01-26  
**Version**: 1.3  
**Status**: ✅ Backend Support Confirmed - Teams Table Complete - Ready for Implementation
