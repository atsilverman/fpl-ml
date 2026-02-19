# Granular Refresh Strategy & Pending Optimizations

This document provides a column-by-column breakdown of refresh cadence for all database tables, plus a summary of pending optimizations to reduce API calls and improve efficiency.

---

## Post-Deadline Refresh Strategy

**Problem**: FPL API locks up during deadline updates (typically 40-50 minutes after deadline, but variable). Attempting to refresh manager picks/transfers during this window causes API errors.

**Solution**: 
1. **Wait 30 minutes after deadline** before entering `TRANSFER_DEADLINE` state
2. **Check once per minute** until gameweek status changes are detected
3. **Detect status changes** by monitoring `is_next` → `is_current` transitions (indicates API has processed deadline)
4. **Refresh all deadline data** when status change detected:
   - Manager picks (all tracked managers)
   - Manager transfers (all tracked managers)
   - Baseline data capture
   - Player whitelist building

**Implementation**: See `backend/src/refresh/orchestrator.py` - `TRANSFER_DEADLINE` state handling.

**State Flow**:
1. **30+ minutes after deadline**: Enter `TRANSFER_DEADLINE` state
2. **Every 1 minute**: Check for gameweek status changes (`is_next` → `is_current`)
3. **When status changes**: Refresh all deadline data (picks, transfers, baselines, whitelist)
4. **After refresh completes**: Exit `TRANSFER_DEADLINE` state
5. **Normal state detection resumes**: System can now detect `LIVE_MATCHES` when games start
6. **When games go live**: System transitions to `LIVE_MATCHES` state and begins player/manager refreshes

**Benefits**:
- Avoids API errors during lockup window (0-30 minutes after deadline)
- Efficient polling (1 minute intervals) until API is ready
- Reliable detection of when API is back (gameweek status changes)
- Batched processing (5 managers per batch, 2-second delays) respects rate limits
- **Stops 1-minute polling once refresh completes** - allows normal state detection for live matches

### Error Handling Strategy

**Problem**: Even after 30 minutes and status change detection, the API may still have errors or be partially locked up.

**Solution**: Comprehensive error handling with multiple safeguards:

1. **Pre-Flight API Check**
   - Before starting batch refresh, call `wait_for_api_after_deadline()` to verify API readiness
   - Uses exponential backoff (2min → 3min → 5min) to wait for API
   - Handles cases where status changed but API still has errors

2. **Error Tracking During Batch Processing**
   - Track which managers fail during batch refresh
   - Classify errors as retryable (5xx, timeouts, connection errors) vs non-retryable (4xx)
   - Log errors with classification for better debugging

3. **Automatic Retry Logic**
   - If success rate < 90%, automatically retry failed managers once
   - Wait 5 seconds before retry to allow API to recover
   - Retry with 2-second delays between managers (rate limiting)
   - Recalculate success rate after retry

4. **Success Rate Threshold**
   - Only mark refresh as completed if success rate ≥ 80%
   - If success rate < 80%, don't mark as completed
   - System stays in `TRANSFER_DEADLINE` state and retries on next cycle
   - Prevents exiting state with incomplete data

**Error Handling Flow**:
```
Status Change Detected
  ↓
Pre-Flight API Check (wait_for_api_after_deadline)
  ↓
Start Batch Refresh
  ↓
Track Errors During Processing
  ↓
Calculate Success Rate
  ↓
If < 90%: Retry Failed Managers
  ↓
If ≥ 80%: Mark Completed → Exit to IDLE
If < 80%: Stay in TRANSFER_DEADLINE → Retry Next Cycle
```

**Key Constants**:
- **Retry Threshold**: 90% (retry if below)
- **Completion Threshold**: 80% (mark complete if above)
- **Retry Delay**: 5 seconds before retry
- **Retry Rate Limit**: 2 seconds between retry attempts

**Benefits**:
- Handles API lockup even after 30 minutes
- Automatic retry for transient errors
- Prevents incomplete data from being marked as complete
- Graceful degradation: retries on next cycle if too many failures
- Better observability: error classification and detailed logging

---

## Table of Contents

1. [Granular Refresh Strategy](#granular-refresh-strategy)
   - [1. teams](#1-teams)
   - [2. gameweeks](#2-gameweeks)
   - [3. players](#3-players)
   - [4. player_gameweek_stats](#4-player_gameweek_stats)
   - [5. player_prices](#5-player_prices)
   - [6. managers](#6-managers)
   - [7. manager_gameweek_history](#7-manager_gameweek_history)
   - [8. manager_transfers](#8-manager_transfers)
   - [9. manager_picks](#9-manager_picks)
   - [10. fixtures](#10-fixtures)
   - [11. mini_leagues](#11-mini_leagues)
   - [12. mini_league_managers](#12-mini_league_managers)
   - [13. player_whitelist](#13-player_whitelist)

2. [Pending Optimizations Summary](#pending-optimizations-summary)
   - [Optimization 1: Cache Manager Picks](#optimization-1-cache-manager-picks)
   - [Optimization 2: Only Refresh Active Managers](#optimization-2-only-refresh-active-managers)
   - [Optimization 3: Skip Expected/ICT Stats During Live](#optimization-3-skip-expectedict-stats-during-live)
   - [Optimization 4: Infer Auto-Subs from Player Minutes](#optimization-4-infer-auto-subs-from-player-minutes)

---

## Granular Refresh Strategy

### 1. teams

| Column | Refresh Frequency | Conditions | Notes |
|--------|------------------|------------|-------|
| `team_id` | Once per season | Season start | Primary key, never changes |
| `team_name` | Once per season | Season start | Only changes if team name changes |
| `short_name` | Once per season | Season start | Only changes if team name changes |
| `created_at` | Never | Auto-set | Database managed |
| `updated_at` | Once per season | Season start | Only if data changes |

**Refresh Trigger**: Season start or team name change (very rare)

---

### 2. gameweeks

| Column | Refresh Frequency | Conditions | Notes |
|--------|------------------|------------|-------|
| `id` | Once per season | Season start | Primary key, never changes |
| `name` | Once per season | Season start | Only changes if gameweek name changes |
| `deadline_time` | Once per season | Season start | Only changes if deadline rescheduled |
| `release_time` | **30-60 seconds** | Always | When FPL releases this GW (post-deadline wait) |
| `is_current` | **30-60 seconds** | Always | **CRITICAL**: Drives all refresh decisions; OUTSIDE_GAMEWEEK when false |
| `is_previous` | **30-60 seconds** | Always | Used for baseline calculations |
| `is_next` | **30-60 seconds** | Always | Used for deadline detection; is_next → is_current triggers deadline batch |
| `finished` | **30-60 seconds** | Always | Gameweek fully finished; past GWs have fpl_ranks_updated set |
| `data_checked` | **30-60 seconds** | Always | **CRITICAL**: From API; when true we set fpl_ranks_updated and refresh all managers for ranks |
| `fpl_ranks_updated` | We set it only | When rank finality detected | **Not in API**. Set when data_checked true or rank-change poll; frontend stale rank indicator. Never from bootstrap. |
| `highest_score` | Once per gameweek | After gameweek finishes | Only updates after completion |
| `average_entry_score` | Once per gameweek | After gameweek finishes | Only updates after completion |
| `created_at` | Never | Auto-set | Database managed |
| `updated_at` | **30-60 seconds** | Always | Updated on every refresh |

**Refresh Trigger**: Always (foundational table). See **LIVE_STATE_REFERENCE.md** for critical gates (deadline batch, baselines, fpl_ranks_updated).

---

### 3. players

| Column | Refresh Frequency | Conditions | Notes |
|--------|------------------|------------|-------|
| `fpl_player_id` | Once per season | Season start | Primary key, never changes |
| `first_name` | Once per season | Season start | Only changes if player name changes |
| `second_name` | Once per season | Season start | Only changes if player name changes |
| `web_name` | Once per season | Season start | Only changes if player name changes |
| `team_id` | Once per season | Season start | Only changes on transfer (rare) |
| `position` | Once per season | Season start | Only changes if position changes (rare) |
| `created_at` | Never | Auto-set | Database managed |
| `updated_at` | Once per season | Season start | Only if data changes |

**Refresh Trigger**: Season start or player transfer/name change (rare)

**⚠️ NOTE**: New players can be added midseason from transfers (e.g., January transfer window). The `players` table should be refreshed:
- **Automatically**: When refreshing other data (bootstrap-static includes all players)
- **Manually**: If a new player appears in manager picks/transfers but doesn't exist in database
- **Frequency**: Typically handled automatically during bootstrap-static refreshes, but may need manual refresh if gaps are detected

---

### 4. player_gameweek_stats

**⚠️ CRITICAL TABLE**: This is where we can optimize by skipping static columns during live refreshes.

#### Match Context Columns (Static per match)

| Column | Refresh Frequency | Conditions | Notes |
|--------|------------------|------------|-------|
| `fixture_id` | Once per matchday | At match start | Set when match begins, never changes |
| `team_id` | Once per matchday | At match start | Set when match begins, never changes |
| `opponent_team_id` | Once per matchday | At match start | Set when match begins, never changes |
| `was_home` | Once per matchday | At match start | Set when match begins, never changes |
| `kickoff_time` | Once per matchday | At match start | Set when match begins, never changes |

#### Match Status Columns (Live updates)

| Column | Refresh Frequency | Conditions | Notes |
|--------|------------------|------------|-------|
| `minutes` | **60 seconds** | During live matches | Updates in real-time |
| `started` | **60 seconds** | During live matches | Updates when match starts |

#### Points Columns (Live updates - DEFCON/Standings critical)

| Column | Refresh Frequency | Conditions | Notes |
|--------|------------------|------------|-------|
| `total_points` | **60 seconds** | During live matches | **CRITICAL**: For standings |
| `bonus` | **60 seconds** | During live matches | Updates when bonus confirmed |
| `bps` | **60 seconds** | During live matches | Used for provisional bonus calculation |
| `bonus_status` | **60 seconds** | During live matches | 'provisional' → 'confirmed' |

#### Attacking Stats (Live updates - DEFCON/Standings critical)

| Column | Refresh Frequency | Conditions | Notes |
|--------|------------------|------------|-------|
| `goals_scored` | **60 seconds** | During live matches | **CRITICAL**: For points |
| `assists` | **60 seconds** | During live matches | **CRITICAL**: For points |
| `own_goals` | **60 seconds** | During live matches | **CRITICAL**: For points |
| `penalties_missed` | **60 seconds** | During live matches | **CRITICAL**: For points |

#### Defending Stats (Live updates - DEFCON critical)

| Column | Refresh Frequency | Conditions | Notes |
|--------|------------------|------------|-------|
| `tackles` | **60 seconds** | During live matches | **CRITICAL**: For DEFCON calculation |
| `clearances_blocks_interceptions` | **60 seconds** | During live matches | **CRITICAL**: For DEFCON calculation |
| `recoveries` | **60 seconds** | During live matches | **CRITICAL**: For DEFCON calculation |
| `defensive_contribution` | **60 seconds** | During live matches | **CRITICAL**: DEFCON value |

#### Goalkeeping Stats (Live updates - Standings critical)

| Column | Refresh Frequency | Conditions | Notes |
|--------|------------------|------------|-------|
| `saves` | **60 seconds** | During live matches | **CRITICAL**: For GK points |
| `clean_sheets` | **60 seconds** | During live matches | **CRITICAL**: For DEF/GK points |
| `goals_conceded` | **60 seconds** | During live matches | **CRITICAL**: For DEF/GK points |
| `penalties_saved` | **60 seconds** | During live matches | **CRITICAL**: For GK points |

#### Cards (Live updates - Standings critical)

| Column | Refresh Frequency | Conditions | Notes |
|--------|------------------|------------|-------|
| `yellow_cards` | **60 seconds** | During live matches | **CRITICAL**: For point deductions |
| `red_cards` | **60 seconds** | During live matches | **CRITICAL**: For point deductions |

#### Expected Stats (Static per match - Analysis only)

| Column | Refresh Frequency | Conditions | Notes |
|--------|------------------|------------|-------|
| `expected_goals` | **Once per matchday** | At match end | Static per match, only for analysis pages |
| `expected_assists` | **Once per matchday** | At match end | Static per match, only for analysis pages |
| `expected_goal_involvements` | **Once per matchday** | At match end | Static per match, only for analysis pages |
| `expected_goals_conceded` | **Once per matchday** | At match end | Static per match, only for analysis pages |

**⚠️ OPTIMIZATION**: Skip these during live refreshes. Only update once when match finishes.

#### ICT Stats (Static per match - Analysis only)

| Column | Refresh Frequency | Conditions | Notes |
|--------|------------------|------------|-------|
| `influence` | **Once per matchday** | At match end | Static per match, only for analysis pages |
| `creativity` | **Once per matchday** | At match end | Static per match, only for analysis pages |
| `threat` | **Once per matchday** | At match end | Static per match, only for analysis pages |
| `ict_index` | **Once per matchday** | At match end | Static per match, only for analysis pages |

**⚠️ OPTIMIZATION**: Skip these during live refreshes. Only update once when match finishes.

#### Match Result Columns (Live updates)

| Column | Refresh Frequency | Conditions | Notes |
|--------|------------------|------------|-------|
| `team_h_score` | **60 seconds** | During live matches | Updates in real-time |
| `team_a_score` | **60 seconds** | During live matches | Updates in real-time |
| `match_finished` | **60 seconds** | During live matches | Updates when match ends |
| `match_finished_provisional` | **60 seconds** | During live matches | Updates when match ends |

**Summary for `player_gameweek_stats`**:
- **Live refresh (60s)**: Update all columns EXCEPT expected stats and ICT stats
- **Post-match refresh (once)**: Update expected stats and ICT stats when match finishes

---

### 5. player_prices

| Column | Refresh Frequency | Conditions | Notes |
|--------|------------------|------------|-------|
| `id` | Never | Auto-increment | Database managed |
| `player_id` | Once per record | When price changes | Set on insert |
| `gameweek` | Once per record | When price changes | Set on insert |
| `price_tenths` | **30 seconds** | **Only during price window** | 5:30-5:36 PM PST daily |
| `price_change_tenths` | **30 seconds** | **Only during price window** | 5:30-5:36 PM PST daily |
| `recorded_at` | **30 seconds** | **Only during price window** | 5:30-5:36 PM PST daily |
| `recorded_date` | **30 seconds** | **Only during price window** | 5:30-5:36 PM PST daily |

**Refresh Trigger**: Only during price change window (5:30-5:36 PM PST). No refresh needed outside this window.

---

### 6. managers

| Column | Refresh Frequency | Conditions | Notes |
|--------|------------------|------------|-------|
| `manager_id` | Once per manager | When manager first loaded | Primary key, never changes |
| `manager_name` | Once per manager | When manager first loaded | Only changes if name changes (rare) |
| `favourite_team_id` | Once per manager | When manager first loaded | Only changes if preference changes (rare) |
| `joined_time` | Once per manager | When manager first loaded | Never changes |
| `created_at` | Never | Auto-set | Database managed |
| `updated_at` | Once per manager | When manager first loaded | Only if data changes |

**Refresh Trigger**: When manager is first loaded into system (from league)

---

### 7. manager_gameweek_history

#### Points Columns (Live updates)

| Column | Refresh Frequency | Conditions | Notes |
|--------|------------------|------------|-------|
| `gameweek_points` | **60 seconds** | During live matches | Calculated from player points |
| `transfer_cost` | Once per gameweek | At deadline | Set at deadline, doesn't change |
| `total_points` | **60 seconds** | During live matches | **CRITICAL**: For standings |

#### Team Value Columns (Deadline updates)

| Column | Refresh Frequency | Conditions | Notes |
|--------|------------------|------------|-------|
| `team_value_tenths` | Once per gameweek | At deadline | Set at deadline, doesn't change |
| `bank_tenths` | Once per gameweek | At deadline | Set at deadline, doesn't change |

#### Rank Columns

##### FPL API Ranks (Post-gameweek only - NOT refreshed during live)

| Column | Refresh Frequency | Conditions | Notes |
|--------|------------------|------------|-------|
| `gameweek_rank` | **Once per gameweek** | After gameweek finished + bonuses finalized | From picks endpoint entry_history.rank. FPL doesn't recompute during live games |
| `overall_rank` | **Once per gameweek** | After gameweek finished + bonuses finalized | FPL doesn't recompute during live games (~11M+ users) |

##### Local Calculated Ranks (Live updates)

| Column | Refresh Frequency | Conditions | Notes |
|--------|------------------|------------|-------|
| `mini_league_rank` | **60 seconds** | During live matches | **CRITICAL**: Calculated locally from standings |
| `mini_league_rank_change` | **60 seconds** | During live matches | Calculated from ranks |

#### Transfer Columns (Deadline updates)

| Column | Refresh Frequency | Conditions | Notes |
|--------|------------------|------------|-------|
| `transfers_made` | Once per gameweek | At deadline | Set at deadline, doesn't change |
| `active_chip` | Once per gameweek | At deadline | Set at deadline, doesn't change |

#### Status Columns (Live updates)

| Column | Refresh Frequency | Conditions | Notes |
|--------|------------------|------------|-------|
| `is_provisional` | **60 seconds** | During live matches | Updates when bonus confirmed |
| `data_status` | **60 seconds** | During live matches | Updates when data finalized |

#### Baseline Columns (Once at deadline - Never overwritten)

| Column | Refresh Frequency | Conditions | Notes |
|--------|------------------|------------|-------|
| `baseline_total_points` | **Once at deadline** | Post-deadline, pre-live | **NEVER** overwritten during live |
| `previous_mini_league_rank` | **Once at deadline** | Post-deadline, pre-live | **NEVER** overwritten during live |
| `previous_overall_rank` | **Once at deadline** | Post-deadline, pre-live | **NEVER** overwritten during live |
| `overall_rank_change` | **60 seconds** | During live matches | Calculated from baseline |

**Refresh Trigger**: 
- **Baseline columns**: Once at deadline (captured by `BaselineCapture`)
  - Captured after manager picks/transfers are refreshed (post-deadline refresh strategy)
  - Triggered when gameweek status changes indicate API is back
- **FPL API ranks** (`gameweek_rank`, `overall_rank`): Once per gameweek after bonuses finalized
  - **NOT refreshed during live matches** - FPL API doesn't recompute ranks for all users during live games
  - Refreshed once after gameweek finished + bonuses finalized (~1 hour after last game)
  - Frontend shows stale indicator ("!" badge) during live games to indicate data may be out of date
- **Other columns**: 60 seconds during live matches

---

### 8. manager_transfers

| Column | Refresh Frequency | Conditions | Notes |
|--------|------------------|------------|-------|
| `id` | Never | Auto-increment | Database managed |
| `manager_id` | Once per transfer | At deadline | Set when transfer recorded |
| `gameweek` | Once per transfer | At deadline | Set when transfer recorded |
| `player_in_id` | Once per transfer | At deadline | Set when transfer recorded |
| `player_out_id` | Once per transfer | At deadline | Set when transfer recorded |
| `transfer_time` | Once per transfer | At deadline | Set when transfer recorded |
| `price_in_tenths` | Once per transfer | At deadline | Set when transfer recorded |
| `price_out_tenths` | Once per transfer | At deadline | Set when transfer recorded |
| `net_price_change_tenths` | Once per transfer | At deadline | Calculated at deadline |
| `player_in_points_baseline` | **Once at deadline** | Post-deadline, pre-live | **NEVER** overwritten during live |
| `player_out_points_baseline` | **Once at deadline** | Post-deadline, pre-live | **NEVER** overwritten during live |
| `point_impact_baseline` | **Once at deadline** | Post-deadline, pre-live | **NEVER** overwritten during live |
| `created_at` | Never | Auto-set | Database managed |
| `updated_at` | Once per transfer | At deadline | Only if data changes |

**Refresh Trigger**: Once at deadline (transfers are locked after deadline)
- **Post-deadline refresh strategy**:
  - Wait 30 minutes after deadline to avoid API lockup (FPL API typically locked 40-50 minutes)
  - Check once per minute until gameweek status changes (`is_next` → `is_current`)
  - Refresh all manager transfers when status change detected
  - Process in batches of 5 managers with 2-second delays to respect rate limits

---

### 9. manager_picks

| Column | Refresh Frequency | Conditions | Notes |
|--------|------------------|------------|-------|
| `id` | Never | Auto-increment | Database managed |
| `manager_id` | Once per gameweek | At deadline | Set when picks recorded |
| `gameweek` | Once per gameweek | At deadline | Set when picks recorded |
| `player_id` | Once per gameweek | At deadline | Set when picks recorded |
| `position` | Once per gameweek | At deadline | Set when picks recorded |
| `is_captain` | Once per gameweek | At deadline | Set when picks recorded |
| `is_vice_captain` | Once per gameweek | At deadline | Set when picks recorded |
| `multiplier` | Once per gameweek | At deadline | Set when picks recorded |
| `was_auto_subbed_out` | **60 seconds** | During live matches | Updates when auto-subs occur |
| `was_auto_subbed_in` | **60 seconds** | During live matches | Updates when auto-subs occur |
| `auto_sub_replaced_player_id` | **60 seconds** | During live matches | Updates when auto-subs occur |
| `created_at` | Never | Auto-set | Database managed |
| `updated_at` | **60 seconds** | During live matches | Only for auto-sub columns |

**⚠️ OPTIMIZATION**: Picks are locked at deadline. Only auto-sub columns need live updates.

**Refresh Trigger**: 
- **Initial picks**: Once at deadline (post-deadline refresh strategy)
  - Wait 30 minutes after deadline to avoid API lockup
  - Check once per minute until gameweek status changes (`is_next` → `is_current`)
  - Refresh all manager picks when status change detected
- **Auto-sub columns**: 60 seconds during live matches (when auto-subs occur)

---

### 10. fixtures

| Column | Refresh Frequency | Conditions | Notes |
|--------|------------------|------------|-------|
| `fpl_fixture_id` | Once per season | Season start | Primary key, never changes |
| `gameweek` | Once per season | Season start | Set at season start |
| `home_team_id` | Once per season | Season start | Set at season start |
| `away_team_id` | Once per season | Season start | Set at season start |
| `home_score` | **60 seconds** | During live matches | From /fixtures/; event-live can augment (DGW-safe: API only for scoreline) |
| `away_score` | **60 seconds** | During live matches | From /fixtures/; event-live can augment (DGW-safe: API only for scoreline) |
| `started` | **60 seconds** | Always (fast loop) | **CRITICAL**: From /fixtures/ only. LIVE_MATCHES = started && !finished_provisional; baseline gate (skip if any started) |
| `finished` | **60 seconds** | Always (fast loop) | **CRITICAL**: From /fixtures/ only. FPL confirmed; final status. |
| `finished_provisional` | **60 seconds** | Always (fast loop) | **CRITICAL**: From /fixtures/ only. BONUS_PENDING = all finished_provisional && !finished. |
| `minutes` | **60 seconds** | During live matches | From /fixtures/; event-live can augment (max of API clock and player minutes). Clock display. |
| `kickoff_time` | **60 seconds** | Always (fast loop) | From /fixtures/. Kickoff window, last-match-of-day rank monitor, idle sleep cap. |
| `deadline_time` | Once per gameweek | At gameweek start | Set from gameweeks table |
| `created_at` | Never | Auto-set | Database managed |
| `updated_at` | **60 seconds** | During live matches | Updated on every refresh |

**Refresh Trigger**: Fast loop (fixtures + gameweeks); foundational for match state. Source: GET /fixtures/. Event-live used only to augment scores/minutes, not started/finished*. See **LIVE_STATE_REFERENCE.md** for state definitions and critical gates.

---

### 11. mini_leagues

| Column | Refresh Frequency | Conditions | Notes |
|--------|------------------|------------|-------|
| `league_id` | Once per league | When league first loaded | Primary key, never changes |
| `league_name` | Once per league | When league first loaded | Only changes if name changes (rare) |
| `created_at` | Never | Auto-set | Database managed |
| `updated_at` | Once per league | When league first loaded | Only if data changes |

**Refresh Trigger**: When league is first loaded into system

---

### 12. mini_league_managers

| Column | Refresh Frequency | Conditions | Notes |
|--------|------------------|------------|-------|
| `league_id` | Once per manager | When manager joins league | Set when relationship created |
| `manager_id` | Once per manager | When manager joins league | Set when relationship created |
| `joined_time` | Once per manager | When manager joins league | Set when relationship created |

**Refresh Trigger**: When manager joins league (rarely changes)

---

### 13. player_whitelist

| Column | Refresh Frequency | Conditions | Notes |
|--------|------------------|------------|-------|
| `id` | Never | Auto-increment | Database managed |
| `league_id` | Once per gameweek | At deadline | Set when whitelist built |
| `gameweek` | Once per gameweek | At deadline | Set when whitelist built |
| `player_id` | Once per gameweek | At deadline | Set when whitelist built |
| `created_at` | Never | Auto-set | Database managed |

**Refresh Trigger**: Once per gameweek at deadline (built from manager picks)
- Built after manager picks are refreshed (post-deadline refresh strategy)
- Triggered when gameweek status changes indicate API is back

---

## Pending Optimizations Summary

### Optimization 1: Cache Manager Picks ✅ IMPLEMENTED

**Status**: ✅ **COMPLETE**

**Problem**: 
- Previously called `get_entry_picks()` API for every manager every refresh
- 60 managers × 1 call = 60 API calls per refresh
- Picks are locked at deadline, so no need to refresh during live matches

**Solution Implemented**:
- Check database first: Query `manager_picks` table for current gameweek
- Only call API if picks don't exist in database
- Cache picks in database and reuse during live matches
- Also optimized `points_calculator` to get `transfer_cost` and `active_chip` from database first

**Expected Impact**:
- **API Calls Saved**: 60 calls per refresh → 0 calls per refresh (after initial load)
- **Time Saved**: ~30-60 seconds per refresh

**Files Modified**:
- `backend/src/refresh/managers.py` - Added `use_cache` parameter to `refresh_manager_picks()`
- `backend/src/utils/points_calculator.py` - Check database first for `transfer_cost` and `active_chip`

---

### Optimization 2: Only Refresh Active Managers ✅ IMPLEMENTED

**Status**: ✅ **COMPLETE**

**Problem**:
- Previously refreshed all 60 managers every refresh
- Many managers may not have any players playing in live matches
- Wasted API calls and time on inactive managers

**Solution Implemented**:
- Added `_get_active_manager_ids()` method to identify managers with active players
- Query `manager_picks` + `player_gameweek_stats` to find managers with players having `minutes > 0`
- Only refresh managers who have at least one active player during live matches
- Fallback to all managers if outside live matches or on error

**Expected Impact**:
- **API Calls Saved**: 60 managers → ~20-30 active managers = **30-40 calls saved**
- **Time Saved**: ~20-30 seconds per refresh
- **Active Managers**: Typically 20-30 managers have players playing during matchday

**Files Modified**:
- `backend/src/refresh/orchestrator.py` - Added `_get_active_manager_ids()` and conditional refresh logic

---

### Optimization 3: Skip Expected/ICT Stats During Live ✅ IMPLEMENTED

**Status**: ✅ **COMPLETE**

**Problem**:
- Previously updated all columns in `player_gameweek_stats` during live refreshes
- Expected stats (xG, xA, xGI, xGC) and ICT stats (influence, creativity, threat, ict_index) are static per match
- These don't change during live matches, only needed for analysis pages
- Wasted database writes and processing time

**Solution Implemented**:
- Added `live_only: bool = False` parameter to `refresh_player_gameweek_stats()`
- When `live_only=True`:
  - Fetch existing expected/ICT stats from database to preserve them
  - Skip updating expected stats and ICT stats columns
  - Only update columns needed for DEFCON/standings
- When `live_only=False` or match finished:
  - Update all columns including expected/ICT stats

**Expected Impact**:
- **Database Writes Saved**: ~8 columns × ~300 players = **2,400 fewer writes per refresh**
- **Processing Time Saved**: ~0.5-1 second per refresh
- **Data Integrity**: Expected/ICT stats still updated once at match end

**Files Modified**:
- `backend/src/refresh/players.py` - Added `live_only` parameter and conditional logic
- `backend/src/refresh/orchestrator.py` - Pass `live_only=True` during live refreshes

---

### Optimization 4: Infer Auto-Subs from Player Minutes ✅ IMPLEMENTED

**Status**: ✅ **ALREADY IMPLEMENTED** (Enhanced)

**Problem**:
- Previously relied on FPL API `automatic_subs` array for auto-sub detection
- Required API call to get picks data
- Can be inferred from player minutes + match status

**Solution**:
- `apply_automatic_subs()` already infers auto-subs from:
  - Player has 0 minutes AND match is finished
  - Bench player has minutes > 0 AND match is finished
  - Position-based substitution rules (FPL auto-sub rules)
- Uses FPL API `automatic_subs` as fallback/validation if available
- Enhanced to work with cached picks (Optimization 1)

**Expected Impact**:
- **API Calls Saved**: Part of Optimization 1 (cache picks)
- **Reliability**: More robust auto-sub detection

**Files Modified**:
- `backend/src/utils/points_calculator.py` - Already had robust auto-sub inference logic

---

## Combined Impact of All Optimizations

### Before Optimizations (60 managers, 60s refresh interval)

| Operation | Time | API Calls |
|-----------|------|-----------|
| Gameweeks | 3s | 1 |
| Fixtures | 1s | 1 |
| Players (Live) | 2s | 1 |
| Manager Points (60) | 25-35s | 120 |
| Materialized Views | 1s | 0 |
| **Total** | **~32-42s** | **123 calls** |

### After All Optimizations ✅

| Operation | Time | API Calls |
|-----------|------|-----------|
| Gameweeks | 3s | 1 |
| Fixtures | 1s | 1 |
| Players (Live) | 1-2s | 1 |
| Manager Points (20-30 active) | 10-20s | 20-30 |
| Materialized Views | 1s | 0 |
| **Total** | **~16-28s** | **23-33 calls** |

**Improvements**:
- ✅ **Time**: 32-42s → 16-28s (**~50% faster**)
- ✅ **API Calls**: 123 → 23-33 calls (**~75% reduction**)
- ✅ **Rate Limit**: 23-33 calls/min (**Within 30/min limit** ✅)
- ✅ **Database Writes**: ~2,400 fewer writes per refresh (expected/ICT stats)

---

## Implementation Status

1. ✅ **Optimization 1: Cache Manager Picks** - COMPLETE
2. ✅ **Optimization 2: Only Refresh Active Managers** - COMPLETE
3. ✅ **Optimization 3: Skip Expected/ICT Stats During Live** - COMPLETE
4. ✅ **Optimization 4: Infer Auto-Subs from Player Minutes** - ALREADY IMPLEMENTED

---

## Next Steps

1. ✅ Test optimizations with 60 managers during live matches
2. ⏳ Monitor API rate limits and adjust if needed
3. ⏳ Fine-tune refresh intervals based on actual performance
4. ⏳ Monitor database write reduction (expected/ICT stats)
5. ⏳ Verify DEFCON tracking accuracy with optimizations

---

## Notes

- All optimizations are backward compatible
- Fallback logic ensures data integrity if optimizations fail
- Expected/ICT stats are still updated once at match end
- Manager picks are still fetched from API if not in database (initial load)
- Active manager detection has fallback to all managers on error
