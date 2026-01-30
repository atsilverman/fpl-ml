# Supabase Database Schema Design for FPL Backend

## Complete Database Walkthrough

### Summary Statistics
- **Total Tables**: 13
- **Total Materialized Views**: 6
- **Total Functions**: 7
- **Total Foreign Key Constraints**: 6 (all team_id references)

### Tables Overview

1. **teams** - Team master data (MUST BE CREATED FIRST)
2. **gameweeks** - Gameweek lifecycle tracking
3. **players** - Player master data
4. **player_gameweek_stats** - Player performance per gameweek
5. **player_prices** - Player price history
6. **managers** - Manager master data
7. **manager_gameweek_history** - Manager points and ranks per gameweek
8. **manager_transfers** - Transfer history with prices
9. **manager_picks** - Manager team selections
10. **fixtures** - Match fixtures
11. **mini_leagues** - Tracked leagues
12. **mini_league_managers** - League membership
13. **player_whitelist** - Query optimization for league features

### Materialized Views Overview

1. **mv_mini_league_standings** - Pre-calculated league standings
2. **mv_manager_gameweek_summary** - Manager gameweek summary with transfer stats
3. **mv_player_gameweek_performance** - Player performance summary
4. **mv_league_transfer_aggregation** - League-level transfer statistics
5. **mv_player_owned_leaderboard** - Player-owned leaderboard (cumulative points)
6. **mv_manager_transfer_impacts** - Pre-calculated transfer point impacts

### Functions Overview

1. **refresh_mini_league_standings()** - Refresh mini league standings view
2. **refresh_manager_gameweek_summary()** - Refresh manager gameweek summary view
3. **refresh_player_gameweek_performance()** - Refresh player performance view
4. **refresh_league_transfer_aggregation()** - Refresh league transfer aggregation view
5. **refresh_player_owned_leaderboard()** - Refresh player owned leaderboard view
6. **refresh_all_materialized_views()** - Refresh all materialized views at once
7. **calculate_ownership_periods(gameweeks INTEGER[])** - Helper function for ownership periods

---

## Overview

This document outlines the critical database tables and materialized views needed for a robust FPL backend that supports:

**⚠️ CRITICAL**: See [BASELINE_DATA_PATTERN.md](./BASELINE_DATA_PATTERN.md) for the essential baseline preservation pattern required for delta calculations (rank changes, point changes).
- Real-time manager points and gameweek progression
- Mini-league standings with rank changes
- DEFCON tracking (defensive contribution bonuses)
- Bonus point tracking (provisional and final)
- Transfer price analysis (net positive/negative)
- Gameweek lifecycle monitoring
- Efficient data refreshes without duplication

## Design Principles

1. **Single Source of Truth**: Store raw FPL API data once, calculate derived values
2. **Provisional vs Final**: Track data status explicitly (provisional/final)
3. **Gameweek Lifecycle**: Monitor gameweek start/end and match status
4. **No Duplication**: Avoid storing calculated values that can be derived
5. **Efficient Queries**: Use materialized views for expensive aggregations
6. **Historical Preservation**: Store gameweek-by-gameweek snapshots

## Critical Tables

### 1. `teams` (Team Master Data)

**Purpose**: Store team information (MUST BE CREATED FIRST - referenced by players and other tables)

**Complete Attributes**:
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `team_id` | INTEGER | PRIMARY KEY | FPL team ID (1-20) |
| `team_name` | TEXT | NOT NULL | Full team name (e.g., "Arsenal") |
| `short_name` | TEXT | NOT NULL | Abbreviation (e.g., "ARS") - used as badge filename |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Record creation timestamp |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() | Record update timestamp |

**Critical Fields**:
- `team_id`: FPL team ID (1-20), primary key
- `team_name`: Full team name (e.g., "Arsenal")
- `short_name`: Abbreviation (e.g., "ARS") - used directly as badge filename
- Badge path: `/badges/{short_name}.svg` (e.g., `/badges/ARS.svg`)

**Indexes**:
- `idx_teams_team_id` on `(team_id)`

**Foreign Key References**:
- Referenced by: `players.team_id`, `player_gameweek_stats.team_id`, `player_gameweek_stats.opponent_team_id`, `managers.favourite_team_id`, `fixtures.home_team_id`, `fixtures.away_team_id`

---

### 2. `gameweeks` (Gameweek Lifecycle)

**Purpose**: Track gameweek status, deadlines, and lifecycle events

**Complete Attributes**:
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PRIMARY KEY | FPL gameweek ID (1-38) |
| `name` | TEXT | NOT NULL | "Gameweek 23" |
| `deadline_time` | TIMESTAMPTZ | NOT NULL | Transfer deadline |
| `is_current` | BOOLEAN | DEFAULT FALSE | Is current gameweek |
| `is_previous` | BOOLEAN | DEFAULT FALSE | Is previous gameweek |
| `is_next` | BOOLEAN | DEFAULT FALSE | Is next gameweek |
| `finished` | BOOLEAN | DEFAULT FALSE | Gameweek finished |
| `data_checked` | BOOLEAN | DEFAULT FALSE | All data finalized |
| `highest_score` | INTEGER | | Highest GW score |
| `average_entry_score` | DECIMAL(5,2) | | Average entry score |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Record creation timestamp |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() | Record update timestamp |

**Critical Fields**:
- `deadline_time`: Monitor for transfer deadline events
- `data_checked`: Indicates when ranks/bonus are final
- `finished`: Gameweek completion status

**Indexes**:
- `idx_gameweeks_is_current` on `(is_current)` WHERE `is_current = true`
- `idx_gameweeks_finished` on `(finished)`

---

### 3. `players` (Player Master Data)

**Purpose**: Store player static information (names, teams, positions)

**Complete Attributes**:
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `fpl_player_id` | INTEGER | PRIMARY KEY | FPL API player ID |
| `first_name` | TEXT | | Player first name |
| `second_name` | TEXT | | Player second name |
| `web_name` | TEXT | NOT NULL | Player web name (display name) |
| `team_id` | INTEGER | NOT NULL, FK → teams(team_id) | FPL team ID (1-20) |
| `position` | INTEGER | NOT NULL | 1=GK, 2=DEF, 3=MID, 4=FWD |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Record creation timestamp |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() | Record update timestamp |

**Indexes**:
- `idx_players_team_id` on `(team_id)`
- `idx_players_position` on `(position)`

**Foreign Key Constraints**:
- `team_id` references `teams(team_id)` (added in migration 007)

---

### 4. `player_gameweek_stats` (Player Performance Data)

**Purpose**: Store player stats per gameweek (single source of truth for player points)

**Complete Attributes** (40 columns total):

**Primary Keys & References**:
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | BIGSERIAL | PRIMARY KEY | Auto-incrementing ID |
| `player_id` | INTEGER | NOT NULL, FK → players(fpl_player_id) | Player ID |
| `gameweek` | INTEGER | NOT NULL, FK → gameweeks(id) | Gameweek number |
| **UNIQUE** | | `(player_id, gameweek)` | One record per player per gameweek |

**Match Context**:
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `fixture_id` | INTEGER | | FPL fixture ID |
| `team_id` | INTEGER | NOT NULL, FK → teams(team_id) | Player's team ID |
| `opponent_team_id` | INTEGER | FK → teams(team_id) | Opponent team ID |
| `was_home` | BOOLEAN | | Was home match |
| `kickoff_time` | TIMESTAMPTZ | | Match kickoff time |

**Match Status**:
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `minutes` | INTEGER | DEFAULT 0 | Minutes played |
| `started` | BOOLEAN | DEFAULT FALSE | Started match |

**Points (CRITICAL: Handles provisional bonus)**:
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `total_points` | INTEGER | DEFAULT 0 | Base points (excludes bonus if provisional) |
| `bonus` | INTEGER | DEFAULT 0 | Confirmed bonus (0 if provisional) |
| `bps` | INTEGER | DEFAULT 0 | BPS score (for provisional bonus calculation) |
| `bonus_status` | TEXT | DEFAULT 'provisional' | 'provisional' \| 'confirmed' |

**Attacking Stats**:
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `goals_scored` | INTEGER | DEFAULT 0 | Goals scored |
| `assists` | INTEGER | DEFAULT 0 | Assists |
| `own_goals` | INTEGER | DEFAULT 0 | Own goals |
| `penalties_missed` | INTEGER | DEFAULT 0 | Penalties missed |

**Defending Stats**:
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `tackles` | INTEGER | DEFAULT 0 | Tackles |
| `clearances_blocks_interceptions` | INTEGER | DEFAULT 0 | Clearances/blocks/interceptions |
| `recoveries` | INTEGER | DEFAULT 0 | Recoveries |
| `defensive_contribution` | INTEGER | DEFAULT 0 | DEFCON (defensive contribution) |

**Goalkeeping Stats**:
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `saves` | INTEGER | DEFAULT 0 | Saves |
| `clean_sheets` | INTEGER | DEFAULT 0 | Clean sheets |
| `goals_conceded` | INTEGER | DEFAULT 0 | Goals conceded |
| `penalties_saved` | INTEGER | DEFAULT 0 | Penalties saved |

**Cards**:
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `yellow_cards` | INTEGER | DEFAULT 0 | Yellow cards |
| `red_cards` | INTEGER | DEFAULT 0 | Red cards |

**Expected Stats**:
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `expected_goals` | DECIMAL(5,2) | DEFAULT 0 | Expected goals (xG) |
| `expected_assists` | DECIMAL(5,2) | DEFAULT 0 | Expected assists (xA) |
| `expected_goal_involvements` | DECIMAL(5,2) | DEFAULT 0 | Expected goal involvements (xGI) |
| `expected_goals_conceded` | DECIMAL(5,2) | DEFAULT 0 | Expected goals conceded (xGC) |

**ICT (Influence, Creativity, Threat)**:
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `influence` | DECIMAL(5,2) | DEFAULT 0 | Influence score |
| `creativity` | DECIMAL(5,2) | DEFAULT 0 | Creativity score |
| `threat` | DECIMAL(5,2) | DEFAULT 0 | Threat score |
| `ict_index` | DECIMAL(5,2) | DEFAULT 0 | ICT index |

**Match Result**:
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `team_h_score` | INTEGER | | Home team score |
| `team_a_score` | INTEGER | | Away team score |
| `match_finished` | BOOLEAN | DEFAULT FALSE | Match finished |
| `match_finished_provisional` | BOOLEAN | DEFAULT FALSE | Match finished (provisional) |

**Metadata**:
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Record creation timestamp |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() | Record update timestamp |

**Critical Fields**:
- `total_points`: Base points (excludes bonus if `bonus_status = 'provisional'`)
- `bonus`: Confirmed bonus (0 if provisional)
- `bps`: Used to calculate provisional bonus
- `bonus_status`: Tracks provisional vs confirmed state
- `match_finished` / `match_finished_provisional`: For auto-sub timing

**Indexes**:
- `idx_pgws_player_gw` on `(player_id, gameweek)`
- `idx_pgws_gameweek` on `(gameweek)`
- `idx_pgws_team_gw` on `(team_id, gameweek)`
- `idx_pgws_bonus_status` on `(gameweek, bonus_status)` WHERE `bonus_status = 'provisional'`

**Foreign Key Constraints**:
- `team_id` references `teams(team_id)` (added in migration 007)
- `opponent_team_id` references `teams(team_id)` (added in migration 007)

---

### 5. `player_prices` (Player Price History)

**Purpose**: Track player prices at specific points in time (for transfer analysis)

```sql
CREATE TABLE player_prices (
  id BIGSERIAL PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(fpl_player_id),
  gameweek INTEGER NOT NULL REFERENCES gameweeks(id),
  price_tenths INTEGER NOT NULL,  -- Price in tenths (e.g., 60 = 6.0m)
  price_change_tenths INTEGER DEFAULT 0,  -- Change from previous GW
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recorded_date DATE NOT NULL DEFAULT CURRENT_DATE,
  
  UNIQUE(player_id, gameweek, recorded_date)
);
```

**Indexes**:
- `idx_player_prices_player_gw` on `(player_id, gameweek)`
- `idx_player_prices_recorded_at` on `(recorded_at)`

---

### 6. `managers` (Manager Master Data)

**Purpose**: Store manager information for tracked leagues

```sql
CREATE TABLE managers (
  manager_id BIGINT PRIMARY KEY,  -- FPL manager ID
  manager_name TEXT NOT NULL,
  favourite_team_id INTEGER,
  joined_time TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Foreign Key Constraints**:
- `favourite_team_id` references `teams(team_id)` (added in migration 007)

---

### 7. `manager_gameweek_history` (Manager Points & Totals)

**Purpose**: Store manager gameweek-by-gameweek history (single source of truth)

**Complete Attributes** (20 columns total):

**Primary Keys & References**:
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | BIGSERIAL | PRIMARY KEY | Auto-incrementing ID |
| `manager_id` | BIGINT | NOT NULL, FK → managers(manager_id) | Manager ID |
| `gameweek` | INTEGER | NOT NULL, FK → gameweeks(id) | Gameweek number |
| **UNIQUE** | | `(manager_id, gameweek)` | One record per manager per gameweek |

**Points**:
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `gameweek_points` | INTEGER | NOT NULL, DEFAULT 0 | Calculated GW points (after transfer costs) |
| `transfer_cost` | INTEGER | DEFAULT 0 | Points deducted for transfers (hits) |
| `total_points` | INTEGER | NOT NULL | Cumulative total (at end of GW) |

**Team Value**:
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `team_value_tenths` | INTEGER | | Team value at deadline (in tenths) |
| `bank_tenths` | INTEGER | | Bank value at deadline (in tenths) |

**Ranks**:
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `overall_rank` | INTEGER | | Overall rank |
| `mini_league_rank` | INTEGER | | Rank in tracked league (calculated) |
| `mini_league_rank_change` | INTEGER | | Change from previous GW |
| `overall_rank_change` | INTEGER | | Overall rank change (calculated from baseline) |

**Baseline Columns (CRITICAL: Preserved during live matches)**:
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `baseline_total_points` | INTEGER | | Baseline total points captured at deadline |
| `previous_mini_league_rank` | INTEGER | | Previous GW mini league rank (baseline) |
| `previous_overall_rank` | INTEGER | | Previous GW overall rank (baseline) |

**Transfers**:
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `transfers_made` | INTEGER | DEFAULT 0 | Number of transfers made |
| `active_chip` | TEXT | | 'wildcard', 'freehit', 'bboost', '3xc', null |

**Status**:
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `is_provisional` | BOOLEAN | DEFAULT TRUE | Points are provisional |
| `data_status` | TEXT | DEFAULT 'provisional' | 'provisional' \| 'final' |

**Metadata**:
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Record creation timestamp |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() | Record update timestamp |

**Critical Fields**:
- `total_points`: Cumulative season total (preserved baseline during live matches)
  - **During live matches**: Calculated as `previous_total + our_calculated_gameweek_points` (real-time accuracy)
  - **When gameweek finishes**: Updated to FPL API authoritative value (one-time update)
  - **Baseline preservation**: Once stored, not overwritten during live matches (critical for stability)
  - **Initial population**: Uses FPL API `total_points` as baseline post-deadline
- `baseline_total_points`: Baseline total points captured at gameweek deadline (post-deadline, pre-live). Preserved throughout live matches. Only updated when gameweek finishes (FPL API authoritative value). Used as foundation for cumulative total_points calculation during live matches.
- `previous_mini_league_rank`: Previous gameweek mini league rank captured at deadline. Used to calculate `mini_league_rank_change`. Preserved throughout live matches. Never overwritten during live updates.
- `previous_overall_rank`: Previous gameweek overall rank captured at deadline. Used to calculate `overall_rank_change`. Preserved throughout live matches. Never overwritten during live updates.
- `overall_rank_change`: Overall rank change calculated from baseline: `previous_overall_rank - current overall_rank`. Positive = moved up (better rank, lower number), Negative = moved down (worse rank, higher number).
- `gameweek_points`: Points scored this gameweek (after subtracting transfer costs, real-time calculated)
- `transfer_cost`: Points deducted for transfers (hits)
- `transfers_made`: Number of transfers made this gameweek
- `is_provisional`: Whether points include provisional bonus
- `mini_league_rank`: Calculated rank within tracked league

**Transfer Cost Logic (Critical for Standings):**
- **Free Transfers**: 1 free transfer per gameweek (can accumulate up to 2 maximum)
- **Hits**: Each transfer beyond free transfers costs -4 points
- **Wildcard/Free Hit**: All transfers are free (no hits)
- **Calculation**: `gameweek_points = raw_points - transfer_cost`
- **Standings Impact**: Transfer costs directly affect gameweek points, which affects total points and rankings
- **API Source**: `event_transfers_cost` from `/api/entry/{manager_id}/event/{gameweek}/picks/` → `entry_history.event_transfers_cost`

**Indexes**:
- `idx_mgh_manager_gw` on `(manager_id, gameweek)`
- `idx_mgh_gameweek` on `(gameweek)`
- `idx_mgh_total_points` on `(gameweek, total_points DESC)` -- For ranking
- `idx_mgh_provisional` on `(gameweek, is_provisional)` WHERE `is_provisional = true`
- `idx_mgh_baseline_total` on `(gameweek, baseline_total_points)` WHERE `baseline_total_points IS NOT NULL`

---

### 8. `manager_transfers` (Transfer History with Prices)

**Purpose**: Track manager transfers with prices for net price difference analysis

**Complete Attributes** (13 columns total):

**Primary Keys & References**:
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | BIGSERIAL | PRIMARY KEY | Auto-incrementing ID |
| `manager_id` | BIGINT | NOT NULL, FK → managers(manager_id) | Manager ID |
| `gameweek` | INTEGER | NOT NULL, FK → gameweeks(id) | Gameweek number |
| **UNIQUE** | | `(manager_id, gameweek, player_in_id, player_out_id)` | One record per transfer |

**Transfer Details**:
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `player_in_id` | INTEGER | NOT NULL, FK → players(fpl_player_id) | Player transferred IN |
| `player_out_id` | INTEGER | NOT NULL, FK → players(fpl_player_id) | Player transferred OUT |
| `transfer_time` | TIMESTAMPTZ | NOT NULL | Transfer timestamp |

**Prices at Time of Transfer (CRITICAL for net difference)**:
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `price_in_tenths` | INTEGER | NOT NULL | Price of player bought (in tenths) |
| `price_out_tenths` | INTEGER | NOT NULL | Price of player sold (in tenths) |
| `net_price_change_tenths` | INTEGER | NOT NULL | price_in - price_out (positive = profit) |

**Baseline Columns (CRITICAL: Preserved during live matches)**:
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `player_in_points_baseline` | INTEGER | | Baseline points for player_in at deadline |
| `player_out_points_baseline` | INTEGER | | Baseline points for player_out at deadline |
| `point_impact_baseline` | INTEGER | | Baseline transfer point impact: player_in_points_baseline - player_out_points_baseline |

**Metadata**:
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Record creation timestamp |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() | Record update timestamp |

**Critical Fields**:
- `price_in_tenths`: Price of player transferred IN at time of transfer
- `price_out_tenths`: Price of player transferred OUT at time of transfer
- `net_price_change_tenths`: Calculated difference (positive = net gain, negative = net loss)
- `player_in_points_baseline`: Baseline points for player_in captured at deadline (or 0 if not yet played). Preserved throughout live matches. Used to calculate transfer delta points.
- `player_out_points_baseline`: Baseline points for player_out captured at deadline (or 0 if not yet played). Preserved throughout live matches. Used to calculate transfer delta points.
- `point_impact_baseline`: Baseline transfer point impact: `player_in_points_baseline - player_out_points_baseline`. Preserved throughout live matches. Used to show transfer delta points at deadline.

**Indexes**:
- `idx_manager_transfers_manager_gw` on `(manager_id, gameweek)`
- `idx_manager_transfers_gameweek` on `(gameweek)`
- `idx_manager_transfers_net_change` on `(gameweek, net_price_change_tenths DESC)`

**Usage Example**:
```sql
-- Get net transfer value for a manager in a gameweek
SELECT 
  manager_id,
  gameweek,
  SUM(net_price_change_tenths) as total_net_change_tenths,
  COUNT(*) as transfers_count
FROM manager_transfers
WHERE manager_id = 12345 AND gameweek = 23
GROUP BY manager_id, gameweek;
```

---

### 9. `manager_picks` (Manager Team Selections)

**Purpose**: Store manager picks per gameweek (for auto-sub analysis and team display)

```sql
CREATE TABLE manager_picks (
  id BIGSERIAL PRIMARY KEY,
  manager_id BIGINT NOT NULL REFERENCES managers(manager_id),
  gameweek INTEGER NOT NULL REFERENCES gameweeks(id),
  
  -- Pick Details
  player_id INTEGER NOT NULL REFERENCES players(fpl_player_id),
  position INTEGER NOT NULL,  -- 1-11 = starting XI, 12-15 = bench
  is_captain BOOLEAN DEFAULT FALSE,
  is_vice_captain BOOLEAN DEFAULT FALSE,
  multiplier INTEGER DEFAULT 1,  -- 1, 2 (captain), or 3 (triple captain)
  
  -- Auto-Sub Status (if applicable)
  was_auto_subbed_out BOOLEAN DEFAULT FALSE,
  was_auto_subbed_in BOOLEAN DEFAULT FALSE,
  auto_sub_replaced_player_id INTEGER,  -- If subbed in, which player they replaced
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(manager_id, gameweek, position)
);
```

**Indexes**:
- `idx_manager_picks_manager_gw` on `(manager_id, gameweek)`
- `idx_manager_picks_player_gw` on `(player_id, gameweek)`

---

### 10. `fixtures` (Match Fixtures)

**Purpose**: Store fixture information and match status

```sql
CREATE TABLE fixtures (
  fpl_fixture_id INTEGER PRIMARY KEY,  -- FPL fixture ID
  gameweek INTEGER NOT NULL REFERENCES gameweeks(id),
  
  -- Teams
  home_team_id INTEGER NOT NULL,
  away_team_id INTEGER NOT NULL,
  
  -- Scores
  home_score INTEGER,
  away_score INTEGER,
  
  -- Status
  started BOOLEAN DEFAULT FALSE,
  finished BOOLEAN DEFAULT FALSE,
  finished_provisional BOOLEAN DEFAULT FALSE,
  minutes INTEGER DEFAULT 0,
  
  -- Timing
  kickoff_time TIMESTAMPTZ NOT NULL,
  deadline_time TIMESTAMPTZ,  -- Gameweek deadline
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Indexes**:
- `idx_fixtures_gameweek` on `(gameweek)`
- `idx_fixtures_finished` on `(finished, finished_provisional)`
- `idx_fixtures_teams` on `(home_team_id, away_team_id)`

**Foreign Key Constraints**:
- `home_team_id` references `teams(team_id)` (added in migration 007)
- `away_team_id` references `teams(team_id)` (added in migration 007)

---

### 11. `mini_leagues` (Tracked Leagues)

**Purpose**: Store tracked mini-league information

```sql
CREATE TABLE mini_leagues (
  league_id BIGINT PRIMARY KEY,  -- FPL league ID
  league_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

### 12. `mini_league_managers` (League Membership)

**Purpose**: Track which managers belong to which leagues

```sql
CREATE TABLE mini_league_managers (
  league_id BIGINT NOT NULL REFERENCES mini_leagues(league_id),
  manager_id BIGINT NOT NULL REFERENCES managers(manager_id),
  joined_time TIMESTAMPTZ,
  PRIMARY KEY (league_id, manager_id)
);
```

**Indexes**:
- `idx_mlm_league` on `(league_id)`
- `idx_mlm_manager` on `(manager_id)`

---

### 13. `player_whitelist` (Query Optimization for League Features)

**Purpose**: Store list of players owned by managers in tracked leagues. Used for **database query optimization** (not API call reduction). Since we refresh all active players for research features, the whitelist helps filter league-specific queries efficiently.

```sql
CREATE TABLE player_whitelist (
  id BIGSERIAL PRIMARY KEY,
  league_id BIGINT NOT NULL REFERENCES mini_leagues(league_id),
  gameweek INTEGER NOT NULL REFERENCES gameweeks(id),
  player_id INTEGER NOT NULL REFERENCES players(fpl_player_id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(league_id, gameweek, player_id)
);
```

**Critical Fields**:
- `league_id`: Tracked league ID
- `gameweek`: Gameweek number
- `player_id`: Player ID (must be owned by at least one manager in league)

**Indexes**:
- `idx_player_whitelist_league_gw` on `(league_id, gameweek)`
- `idx_player_whitelist_player` on `(player_id)`

**Usage**:
- **Query Optimization**: Filter league standings queries to only owned players
- **Built after deadline**: When manager picks are locked
- **Not used for API calls**: We refresh all active players anyway (for research features)

**Why Whitelist if We Refresh All Players?**
- **API Calls**: We refresh all active players (needed for research/defcon features)
- **Database Queries**: Whitelist filters queries for league-specific features
- **Performance**: Faster queries when filtering league standings by whitelist vs scanning all players

**Example Query Optimization**:
```sql
-- Without whitelist: Scan all players
SELECT * FROM player_gameweek_stats 
WHERE gameweek = 23 
ORDER BY total_points DESC;  -- Slow: scans all ~800 players

-- With whitelist: Filter to owned players only
SELECT pgs.* FROM player_gameweek_stats pgs
JOIN player_whitelist pw ON pgs.player_id = pw.player_id
WHERE pw.league_id = 12345 AND pw.gameweek = 23
ORDER BY pgs.total_points DESC;  -- Fast: only ~100-150 players
```

**Building the Whitelist**:
```sql
-- Get all unique players owned by managers in a league for a gameweek
SELECT DISTINCT mp.player_id
FROM mini_league_managers mlm
JOIN manager_picks mp ON mlm.manager_id = mp.manager_id
WHERE mlm.league_id = ? AND mp.gameweek = ?;
```

**Note**: The whitelist is built for query optimization, not API reduction. Since we need all player data for research features, we refresh all active players regardless of whitelist.

---

## Foreign Key Constraints

All `team_id` references across the database have foreign key constraints to ensure data integrity (added in migration 007):

1. **`players.team_id`** → `teams(team_id)`
2. **`player_gameweek_stats.team_id`** → `teams(team_id)`
3. **`player_gameweek_stats.opponent_team_id`** → `teams(team_id)`
4. **`managers.favourite_team_id`** → `teams(team_id)`
5. **`fixtures.home_team_id`** → `teams(team_id)`
6. **`fixtures.away_team_id`** → `teams(team_id)`

These constraints ensure referential integrity and prevent orphaned records when teams are referenced.

---

## Materialized Views (For Performance)

### 1. `mv_mini_league_standings` (Real-Time Standings)

**Purpose**: Pre-calculated standings for fast UI loading

```sql
CREATE MATERIALIZED VIEW mv_mini_league_standings AS
SELECT 
  ml.league_id,
  m.manager_id,
  m.manager_name,
  mgh.gameweek,
  mgh.gameweek_points,
  mgh.total_points,
  mgh.mini_league_rank,
  mgh.mini_league_rank_change,
  mgh.is_provisional,
  mgh.data_status,
  -- Calculate rank from total_points
  ROW_NUMBER() OVER (
    PARTITION BY ml.league_id, mgh.gameweek 
    ORDER BY mgh.total_points DESC, m.manager_id ASC
  ) as calculated_rank
FROM mini_leagues ml
JOIN mini_league_managers mlm ON ml.league_id = mlm.league_id
JOIN managers m ON mlm.manager_id = m.manager_id
JOIN manager_gameweek_history mgh ON m.manager_id = mgh.manager_id
WHERE mgh.gameweek = (SELECT id FROM gameweeks WHERE is_current = true);

CREATE UNIQUE INDEX idx_mv_standings_unique ON mv_mini_league_standings(league_id, manager_id, gameweek);
```

**Refresh Strategy**: Refresh when gameweek points update or gameweek changes

---

### 2. `mv_manager_gameweek_summary` (Manager GW Summary)

**Purpose**: Aggregated manager data per gameweek (points, transfers, chips)

```sql
CREATE MATERIALIZED VIEW mv_manager_gameweek_summary AS
SELECT 
  mgh.manager_id,
  mgh.gameweek,
  mgh.gameweek_points,
  mgh.total_points,
  mgh.transfer_cost,
  mgh.transfers_made,
  mgh.active_chip,
  mgh.is_provisional,
  -- Transfer value analysis
  COALESCE(SUM(mt.net_price_change_tenths), 0) as total_net_transfer_value_tenths,
  COUNT(mt.id) as transfer_count
FROM manager_gameweek_history mgh
LEFT JOIN manager_transfers mt ON mgh.manager_id = mt.manager_id AND mgh.gameweek = mt.gameweek
GROUP BY mgh.manager_id, mgh.gameweek, mgh.gameweek_points, mgh.total_points, 
         mgh.transfer_cost, mgh.transfers_made, mgh.active_chip, mgh.is_provisional;

CREATE UNIQUE INDEX idx_mv_mgw_summary_unique ON mv_manager_gameweek_summary(manager_id, gameweek);
```

---

### 3. `mv_player_gameweek_performance` (Player Performance Summary)

**Purpose**: Aggregated player stats with provisional bonus calculation

**Attributes**:
- `player_id` - Player ID
- `gameweek` - Gameweek number
- `total_points` - Total points scored
- `effective_bonus` - Bonus points (confirmed) or NULL (if provisional)
- `bonus_status` - 'provisional' | 'confirmed'
- `defcon` - Defensive contribution (DEFCON)
- `minutes` - Minutes played
- `goals_scored` - Goals scored
- `assists` - Assists
- `clean_sheets` - Clean sheets
- `saves` - Saves (for goalkeepers)

```sql
CREATE MATERIALIZED VIEW mv_player_gameweek_performance AS
SELECT 
  pgs.player_id,
  pgs.gameweek,
  pgs.total_points,
  CASE 
    WHEN pgs.bonus_status = 'confirmed' THEN pgs.bonus
    WHEN pgs.bonus_status = 'provisional' THEN NULL  -- Calculate in application layer
    ELSE NULL
  END as effective_bonus,
  pgs.bonus_status,
  pgs.defensive_contribution as defcon,
  pgs.minutes,
  pgs.goals_scored,
  pgs.assists,
  pgs.clean_sheets,
  pgs.saves
FROM player_gameweek_stats pgs;

CREATE UNIQUE INDEX idx_mv_pgp_unique ON mv_player_gameweek_performance(player_id, gameweek);
```

**Note**: Provisional bonus calculation is complex (requires BPS ranking within fixture) - calculated in application layer

**Indexes**:
- `idx_mv_pgp_unique` on `(player_id, gameweek)` - Unique constraint for concurrent refresh

---

### 4. `mv_league_transfer_aggregation` (League-Level Transfer Stats)

**Purpose**: Pre-calculated league-level transfer statistics for fast UI loading (most common transfers in/out)

```sql
CREATE MATERIALIZED VIEW mv_league_transfer_aggregation AS
SELECT 
  ml.league_id,
  ml.league_name,
  mt.gameweek,
  
  -- Transfers IN (most common players brought in)
  mt.player_in_id as player_id,
  p_in.web_name as player_name,
  p_in.position as player_position,
  'in' as transfer_direction,
  COUNT(DISTINCT mt.manager_id) as manager_count,  -- How many managers transferred this player in
  COUNT(*) as transfer_count,  -- Total number of transfers (if same manager did multiple)
  AVG(mt.price_in_tenths) as avg_price_tenths,
  AVG(mt.net_price_change_tenths) as avg_net_price_change_tenths
  
FROM mini_leagues ml
JOIN mini_league_managers mlm ON ml.league_id = mlm.league_id
JOIN manager_transfers mt ON mlm.manager_id = mt.manager_id
JOIN players p_in ON mt.player_in_id = p_in.fpl_player_id
GROUP BY ml.league_id, ml.league_name, mt.gameweek, mt.player_in_id, p_in.web_name, p_in.position

UNION ALL

SELECT 
  ml.league_id,
  ml.league_name,
  mt.gameweek,
  
  -- Transfers OUT (most common players sold)
  mt.player_out_id as player_id,
  p_out.web_name as player_name,
  p_out.position as player_position,
  'out' as transfer_direction,
  COUNT(DISTINCT mt.manager_id) as manager_count,
  COUNT(*) as transfer_count,
  AVG(mt.price_out_tenths) as avg_price_tenths,
  AVG(mt.net_price_change_tenths) as avg_net_price_change_tenths
  
FROM mini_leagues ml
JOIN mini_league_managers mlm ON ml.league_id = mlm.league_id
JOIN manager_transfers mt ON mlm.manager_id = mt.manager_id
JOIN players p_out ON mt.player_out_id = p_out.fpl_player_id
GROUP BY ml.league_id, ml.league_name, mt.gameweek, mt.player_out_id, p_out.web_name, p_out.position;

CREATE INDEX idx_mv_league_transfers_league_gw ON mv_league_transfer_aggregation(league_id, gameweek);
CREATE INDEX idx_mv_league_transfers_direction ON mv_league_transfer_aggregation(league_id, gameweek, transfer_direction, manager_count DESC);
CREATE UNIQUE INDEX idx_mv_league_transfers_unique ON mv_league_transfer_aggregation(league_id, gameweek, player_id, transfer_direction);
```

**Indexes**:
- `idx_mv_league_transfers_league_gw` on `(league_id, gameweek)` - Fast league/gameweek lookups
- `idx_mv_league_transfers_direction` on `(league_id, gameweek, transfer_direction, manager_count DESC)` - Sorted by popularity
- `idx_mv_league_transfers_unique` on `(league_id, gameweek, player_id, transfer_direction)` - Unique constraint for concurrent refresh

**Usage Examples**:

```sql
-- Get most common transfers IN for a league in a gameweek
SELECT 
  player_name,
  player_position,
  manager_count,
  transfer_count,
  ROUND(avg_price_tenths / 10.0, 1) as avg_price
FROM mv_league_transfer_aggregation
WHERE league_id = 814685 
  AND gameweek = 23 
  AND transfer_direction = 'in'
ORDER BY manager_count DESC, transfer_count DESC
LIMIT 10;

-- Get most common transfers OUT for a league in a gameweek
SELECT 
  player_name,
  player_position,
  manager_count,
  transfer_count,
  ROUND(avg_price_tenths / 10.0, 1) as avg_price
FROM mv_league_transfer_aggregation
WHERE league_id = 814685 
  AND gameweek = 23 
  AND transfer_direction = 'out'
ORDER BY manager_count DESC, transfer_count DESC
LIMIT 10;
```

**Refresh Strategy**: Refresh after deadline passes and manager picks are updated for the new gameweek

---

### 5. `mv_player_owned_leaderboard` (Player-Owned Leaderboard)

**Purpose**: Computes cumulative points from starting positions only (no redundant storage). Uses existing `manager_picks` and `player_gameweek_stats` tables.

**Attributes**:
- `manager_id` - Manager ID
- `manager_name` - Manager name
- `player_id` - Player ID (effective player after auto-subs)
- `player_name` - Player web name
- `player_position` - Player position (1=GK, 2=DEF, 3=MID, 4=FWD)
- `total_points` - Cumulative points from starting XI only
- `gameweeks_owned` - Number of gameweeks owned
- `gameweeks_array` - Array of gameweeks owned
- `ownership_periods` - Formatted ownership periods (e.g., "1-3, 5-7")
- `average_points_per_gw` - Average points per gameweek
- `captain_weeks` - Number of gameweeks as captain
- `first_owned_gw` - First gameweek owned
- `last_owned_gw` - Last gameweek owned

**Features**:
- Only includes players in starting XI (position <= 11)
- Excludes bench points (position > 11)
- Applies captain multipliers (x2 or x3)
- Handles auto-subs (substitute points count)
- Accumulates points across multiple ownership periods
- Shows ownership periods (e.g., "1-3, 5-7")

**Base View**: `v_player_owned_leaderboard` (regular view, can be queried directly for real-time data)

```sql
CREATE MATERIALIZED VIEW mv_player_owned_leaderboard AS
SELECT * FROM v_player_owned_leaderboard;

CREATE UNIQUE INDEX idx_mv_pol_unique ON mv_player_owned_leaderboard(manager_id, player_id);
CREATE INDEX idx_mv_pol_manager_points ON mv_player_owned_leaderboard(manager_id, total_points DESC);
CREATE INDEX idx_mv_pol_manager_position ON mv_player_owned_leaderboard(manager_id, player_position, total_points DESC);
```

**Helper Function**: `calculate_ownership_periods(gameweeks INTEGER[])`
- Converts array of gameweeks to formatted ownership periods
- Example: `[1,2,3,5,6,7]` → `"1-3, 5-7"`
- Handles continuous and non-continuous ownership periods
- Returns TEXT

**Indexes**:
- `idx_mv_pol_unique` on `(manager_id, player_id)` - Unique constraint for concurrent refresh
- `idx_mv_pol_manager_points` on `(manager_id, total_points DESC)` - Sorted by points
- `idx_mv_pol_manager_position` on `(manager_id, player_position, total_points DESC)` - Sorted by position and points

**Refresh Strategy**: Refresh as needed (optional - can use `v_player_owned_leaderboard` view directly for real-time data)

---

### 6. `mv_manager_transfer_impacts` (Manager Transfer Point Impacts)

**Purpose**: Pre-calculates point impacts for transfers to optimize Transfers page queries. Reduces JOIN overhead from `manager_transfers` + `player_gameweek_stats` (2x).

```sql
CREATE MATERIALIZED VIEW mv_manager_transfer_impacts AS
SELECT 
  mt.id as transfer_id,
  mt.manager_id,
  mt.gameweek,
  mt.player_in_id,
  mt.player_out_id,
  mt.transfer_time,
  -- Player names (for display)
  p_in.web_name as player_in_name,
  p_out.web_name as player_out_name,
  -- Point impacts (pre-calculated)
  COALESCE(pgs_in.total_points, 0) as player_in_points,
  COALESCE(pgs_out.total_points, 0) as player_out_points,
  COALESCE(pgs_in.total_points, 0) - COALESCE(pgs_out.total_points, 0) as point_impact,
  -- Price information
  mt.price_in_tenths,
  mt.price_out_tenths,
  mt.net_price_change_tenths
FROM manager_transfers mt
LEFT JOIN players p_in ON mt.player_in_id = p_in.fpl_player_id
LEFT JOIN players p_out ON mt.player_out_id = p_out.fpl_player_id
LEFT JOIN player_gameweek_stats pgs_in ON mt.player_in_id = pgs_in.player_id 
  AND mt.gameweek = pgs_in.gameweek
LEFT JOIN player_gameweek_stats pgs_out ON mt.player_out_id = pgs_out.player_id 
  AND mt.gameweek = pgs_out.gameweek;

CREATE UNIQUE INDEX idx_mv_transfer_impacts_unique ON mv_manager_transfer_impacts(transfer_id);
CREATE INDEX idx_mv_transfer_impacts_manager_gw ON mv_manager_transfer_impacts(manager_id, gameweek);
CREATE INDEX idx_mv_transfer_impacts_gameweek ON mv_manager_transfer_impacts(gameweek);
CREATE INDEX idx_mv_transfer_impacts_point_impact ON mv_manager_transfer_impacts(gameweek, point_impact DESC);
```

**Usage Example**:
```sql
-- Get manager transfers with point impacts for a league
SELECT 
  mgh.mini_league_rank,
  m.manager_name,
  mgh.mini_league_rank_change,
  mti.player_in_name,
  mti.player_out_name,
  mti.point_impact,
  SUM(mti.point_impact) OVER (PARTITION BY mti.manager_id) as total_delta_points
FROM mv_manager_transfer_impacts mti
JOIN manager_gameweek_history mgh ON mti.manager_id = mgh.manager_id 
  AND mti.gameweek = mgh.gameweek
JOIN managers m ON mti.manager_id = m.manager_id
WHERE mti.gameweek = :gameweek
  AND mti.manager_id IN (
    SELECT manager_id FROM mini_league_managers WHERE league_id = :league_id
  )
ORDER BY mgh.mini_league_rank;
```

**Attributes**:
- `transfer_id` - Transfer ID (from manager_transfers.id)
- `manager_id` - Manager ID
- `gameweek` - Gameweek number
- `player_in_id` - Player transferred IN
- `player_out_id` - Player transferred OUT
- `transfer_time` - Transfer timestamp
- `player_in_name` - Player IN name (for display)
- `player_out_name` - Player OUT name (for display)
- `player_in_points` - Points scored by player IN
- `player_out_points` - Points scored by player OUT
- `point_impact` - Point impact: player_in_points - player_out_points
- `price_in_tenths` - Price of player IN
- `price_out_tenths` - Price of player OUT
- `net_price_change_tenths` - Net price change

**Indexes**:
- `idx_mv_transfer_impacts_unique` on `(transfer_id)` - Unique constraint for concurrent refresh
- `idx_mv_transfer_impacts_manager_gw` on `(manager_id, gameweek)` - Fast manager/gameweek lookups
- `idx_mv_transfer_impacts_gameweek` on `(gameweek)` - Fast gameweek lookups
- `idx_mv_transfer_impacts_point_impact` on `(gameweek, point_impact DESC)` - Sorted by point impact

**Refresh Strategy**: Refresh every 30-60 seconds during live gameweeks as player points update

---

## Database Functions

### Refresh Functions

All refresh functions use `REFRESH MATERIALIZED VIEW CONCURRENTLY` to avoid locking tables during refresh.

#### 1. `refresh_mini_league_standings()`
- **Purpose**: Refresh mini league standings materialized view
- **Returns**: void
- **Usage**: `SELECT refresh_mini_league_standings();`

#### 2. `refresh_manager_gameweek_summary()`
- **Purpose**: Refresh manager gameweek summary materialized view
- **Returns**: void
- **Usage**: `SELECT refresh_manager_gameweek_summary();`

#### 3. `refresh_player_gameweek_performance()`
- **Purpose**: Refresh player gameweek performance materialized view
- **Returns**: void
- **Usage**: `SELECT refresh_player_gameweek_performance();`

#### 4. `refresh_league_transfer_aggregation()`
- **Purpose**: Refresh league transfer aggregation materialized view
- **Returns**: void
- **Usage**: `SELECT refresh_league_transfer_aggregation();`

#### 5. `refresh_player_owned_leaderboard()`
- **Purpose**: Refresh player owned leaderboard materialized view
- **Returns**: void
- **Usage**: `SELECT refresh_player_owned_leaderboard();`

#### 6. `refresh_all_materialized_views()`
- **Purpose**: Refresh all materialized views in sequence
- **Returns**: void
- **Usage**: `SELECT refresh_all_materialized_views();`
- **Order**: Calls all individual refresh functions in sequence

### Helper Functions

#### 7. `calculate_ownership_periods(gameweeks INTEGER[])`
- **Purpose**: Convert array of gameweeks to formatted ownership periods string
- **Parameters**: `gameweeks` - Array of gameweek numbers
- **Returns**: TEXT
- **Example**: `calculate_ownership_periods(ARRAY[1,2,3,5,6,7])` → `"1-3, 5-7"`
- **Usage**: Used by `v_player_owned_leaderboard` view
- **Function Type**: IMMUTABLE (can be used in indexes)

---

## Transfer Detection & Comparison Methods

### Method 1: Using `manager_transfers` Table (Recommended)

**When to use**: After deadline passes, transfers are already stored in `manager_transfers` table

```sql
-- Get all transfers for a manager in a gameweek (with player names and prices)
SELECT 
  m.manager_name,
  p_in.web_name as player_in,
  p_out.web_name as player_out,
  ROUND(mt.price_in_tenths / 10.0, 1) as price_in,
  ROUND(mt.price_out_tenths / 10.0, 1) as price_out,
  ROUND(mt.net_price_change_tenths / 10.0, 1) as net_price_change,
  mt.transfer_time
FROM manager_transfers mt
JOIN managers m ON mt.manager_id = m.manager_id
JOIN players p_in ON mt.player_in_id = p_in.fpl_player_id
JOIN players p_out ON mt.player_out_id = p_out.fpl_player_id
WHERE mt.manager_id = 12345 AND mt.gameweek = 23
ORDER BY mt.transfer_time;
```

### Method 2: Comparing `manager_picks` Between Gameweeks

**When to use**: To detect transfers by comparing team selections (useful if `manager_transfers` is not yet populated)

```sql
-- Detect transfers by comparing picks between gameweeks
WITH previous_picks AS (
  SELECT DISTINCT manager_id, player_id
  FROM manager_picks
  WHERE gameweek = 22  -- Previous gameweek
),
current_picks AS (
  SELECT DISTINCT manager_id, player_id
  FROM manager_picks
  WHERE gameweek = 23  -- Current gameweek
)
SELECT 
  m.manager_name,
  p_in.web_name as player_in,
  p_out.web_name as player_out
FROM (
  -- Players in current GW but not in previous GW (transferred IN)
  SELECT cp.manager_id, cp.player_id as player_in_id
  FROM current_picks cp
  LEFT JOIN previous_picks pp ON cp.manager_id = pp.manager_id AND cp.player_id = pp.player_id
  WHERE pp.player_id IS NULL
) transfers_in
JOIN (
  -- Players in previous GW but not in current GW (transferred OUT)
  SELECT pp.manager_id, pp.player_id as player_out_id
  FROM previous_picks pp
  LEFT JOIN current_picks cp ON pp.manager_id = cp.manager_id AND pp.player_id = cp.player_id
  WHERE cp.player_id IS NULL
) transfers_out ON transfers_in.manager_id = transfers_out.manager_id
JOIN managers m ON transfers_in.manager_id = m.manager_id
JOIN players p_in ON transfers_in.player_in_id = p_in.fpl_player_id
JOIN players p_out ON transfers_out.player_out_id = p_out.fpl_player_id
WHERE m.manager_id = 12345;
```

**Note**: This method works but doesn't capture prices. Use `manager_transfers` table when available.

### Method 3: League-Level Transfer Summary

**Purpose**: Show transfer activity across all managers in a league at a glance

```sql
-- Get transfer summary for a league in a gameweek
SELECT 
  m.manager_name,
  COUNT(mt.id) as transfers_made,
  COALESCE(SUM(mt.net_price_change_tenths), 0) as total_net_price_change_tenths,
  mgh.transfer_cost as points_deducted
FROM mini_leagues ml
JOIN mini_league_managers mlm ON ml.league_id = mlm.league_id
JOIN managers m ON mlm.manager_id = m.manager_id
LEFT JOIN manager_transfers mt ON m.manager_id = mt.manager_id AND mt.gameweek = 23
LEFT JOIN manager_gameweek_history mgh ON m.manager_id = mgh.manager_id AND mgh.gameweek = 23
WHERE ml.league_id = 814685
GROUP BY m.manager_id, m.manager_name, mgh.transfer_cost
ORDER BY transfers_made DESC, m.manager_name;
```

### Method 4: Manager Team Comparison (Before/After Deadline)

**Purpose**: Show full team comparison between gameweeks

```sql
-- Compare manager's team between two gameweeks
WITH previous_team AS (
  SELECT 
    mp.manager_id,
    mp.player_id,
    mp.position,
    p.web_name,
    p.position as player_position
  FROM manager_picks mp
  JOIN players p ON mp.player_id = p.fpl_player_id
  WHERE mp.gameweek = 22 AND mp.manager_id = 12345
),
current_team AS (
  SELECT 
    mp.manager_id,
    mp.player_id,
    mp.position,
    p.web_name,
    p.position as player_position
  FROM manager_picks mp
  JOIN players p ON mp.player_id = p.fpl_player_id
  WHERE mp.gameweek = 23 AND mp.manager_id = 12345
)
SELECT 
  COALESCE(pt.web_name, ct.web_name) as player_name,
  COALESCE(pt.player_position, ct.player_position) as position,
  CASE 
    WHEN pt.player_id IS NULL THEN 'IN'  -- New player (transferred in)
    WHEN ct.player_id IS NULL THEN 'OUT'  -- Removed player (transferred out)
    ELSE 'KEPT'  -- Player kept
  END as status,
  pt.position as previous_position,
  ct.position as current_position
FROM previous_team pt
FULL OUTER JOIN current_team ct ON pt.player_id = ct.player_id
ORDER BY 
  CASE status WHEN 'OUT' THEN 1 WHEN 'IN' THEN 2 ELSE 3 END,
  COALESCE(ct.position, pt.position);
```

---

## Data Refresh Strategy

### Refresh Triggers

1. **Gameweek Lifecycle Events**:
   - Transfer deadline passed → **⚠️ CRITICAL: Capture baselines** (total_points, previous ranks)
   - First match started → Start live updates (preserve baselines)
   - All matches finished → Calculate final standings, update baselines to FPL API authoritative values
   - `data_checked = true` → Mark all data as final

**⚠️ BASELINE CAPTURE WINDOW**: Post-deadline, pre-live matches
- This is the critical window to capture baseline data
- Baselines must persist through live gameweek play
- Required for accurate delta calculations (rank changes, point changes)
- See [BASELINE_DATA_PATTERN.md](./BASELINE_DATA_PATTERN.md) for details

2. **Match Status Changes**:
   - Match finished → Update player stats, check auto-subs
   - Match `finished_provisional = true` → Update provisional bonus

3. **Time-Based**:
   - Every 30 seconds during live matches
   - Every 5 minutes during gameweek (idle)
   - Once per hour outside gameweek

### Refresh Order

1. Update `gameweeks` table (check current/previous/next status)
2. **⚠️ If post-deadline, pre-live: Capture baselines** (total_points, previous ranks)
3. Update `fixtures` (match status, scores)
4. Update `player_gameweek_stats` (player points, stats)
5. Update `player_prices` (if price changed)
6. Calculate `manager_gameweek_history` (manager points, ranks) - **preserve baselines during live**
7. Update `manager_transfers` (if new transfers detected)
8. Refresh materialized views

**Baseline Preservation During Live Updates:**
- ✅ Update `gameweek_points` (real-time calculated)
- ✅ Recalculate `mini_league_rank` (from current totals)
- ✅ Calculate `rank_change` (from baseline)
- ❌ **DO NOT** overwrite `total_points` baseline
- ❌ **DO NOT** overwrite previous gameweek ranks (they're baselines)

---

## Critical Considerations

### 1. Provisional vs Final Data

- **Player Points**: Store `total_points` (base) + `bonus` (confirmed) + `bps` (for provisional calculation)
- **Manager Points**: Store `is_provisional` flag, calculate with provisional bonus when needed
- **Status Tracking**: Use `bonus_status` and `data_status` fields
- **Total Points Baseline**: Preserved during live matches, only updated when gameweek finishes (FPL API authoritative)

### 2. Transfer Price Tracking

- **Capture Prices at Transfer Time**: Store `price_in_tenths` and `price_out_tenths` when transfer is made
- **Calculate Net Difference**: `net_price_change_tenths = price_in - price_out`
- **Display Logic**: Show net positive (green) or net negative (red) in UI

### 3. Transfer Costs & Gameweek Points Calculation

**⚠️ CRITICAL**: Transfer costs (hits) directly affect gameweek points and standings.

**Calculation Formula:**
```
gameweek_points = raw_points - transfer_cost
```

**Total Points Logic (Critical - Baseline Preservation):**

1. **During Live Matches** (`finished = false`):
   ```
   total_points = previous_total_points + our_calculated_gameweek_points
   ```
   - Uses our calculated `gameweek_points` for real-time accuracy
   - Baseline is preserved once set (not overwritten during live updates)
   - Ensures stable cumulative totals during live matches

2. **When Gameweek Finishes** (`finished = true`):
   ```
   total_points = FPL_API_total_points  (one-time authoritative update)
   ```
   - Updates to FPL API authoritative value (includes all official adjustments)
   - Only overwrites existing baseline when gameweek transitions to finished

3. **Initial Population** (no previous gameweek data):
   - Post-deadline: Use FPL API `total_points` as baseline
   - Adjust for our calculated `gameweek_points` if different from FPL API

**Where:**
- `raw_points` = Sum of player points (with multipliers, auto-subs, bench boost)
- `transfer_cost` = Points deducted for transfers (from `event_transfers_cost` API field)
- `gameweek_points` = Final points for the gameweek (used in standings, real-time calculated)
- `previous_total_points` = `total_points` from previous gameweek (cumulative baseline)
- `our_calculated_gameweek_points` = Real-time calculated points (includes provisional bonus/DEFCON)

**⚠️ CRITICAL**: Baseline `total_points` must be preserved during live matches. Only update when:
- Gameweek finishes (FPL API authoritative value)
- New gameweek starts (establish new baseline)
- `total_points` = Cumulative total (used for ranking)

**Free Transfer Rules (Official FPL):**
1. **Free Transfers**: 1 free transfer per gameweek
2. **Accumulation**: Can accumulate up to 2 free transfers maximum
3. **Hits**: Each transfer beyond free transfers costs -4 points
4. **Wildcard/Free Hit**: All transfers are free (no hits)

**Transfer Cost Examples:**
- 0 transfers = 0 cost
- 1 transfer = 0 cost (1 free used)
- 2 transfers with 2 free available = 0 cost (2 free used)
- 2 transfers with 1 free available = -4 cost (1 free + 1 hit)
- 3 transfers with 2 free available = -4 cost (2 free + 1 hit)
- 3 transfers with 1 free available = -8 cost (1 free + 2 hits)

**API Source:**
- `event_transfers_cost` from `/api/entry/{manager_id}/event/{gameweek}/picks/` → `entry_history.event_transfers_cost`
- The API calculates this correctly, accounting for:
  - Free transfers accumulated from previous gameweeks
  - Wildcard/Free Hit chip usage
  - Correct hit calculation

**Standings Impact:**
- Transfer costs are **deducted from gameweek points**
- Gameweek points affect **total points**
- Total points determine **rankings** in mini leagues
- Example: Manager with 50 raw points and -4 transfer cost = 46 gameweek points

### 4. Rank Calculation

- **Mini-League Ranks**: Calculate from `total_points` in `manager_gameweek_history`
- **Rank Changes**: Store `mini_league_rank_change` = previous_rank - current_rank
- **Real-Time**: Recalculate ranks when points update during live matches

### 4. Auto-Substitution Logic

- **Timing**: Only apply when player's match is `finished = true` or `finished_provisional = true`
- **Store Status**: Track `was_auto_subbed_out` / `was_auto_subbed_in` in `manager_picks`
- **Formation Rules**: Validate in application layer (not stored in DB)

### 5. Gameweek Lifecycle Monitoring

- **Current Gameweek**: `gameweeks.is_current = true`
- **Deadline Tracking**: Monitor `deadline_time` for transfer deadline events
- **Data Finalization**: `data_checked = true` indicates all data is final

---

## Migration from Existing System

### Data to Preserve

1. Historical manager points (if available)
2. DEFCON tracking data
3. Player stats history
4. League memberships

### Cleanup Needed

1. Remove duplicate tables
2. Consolidate materialized views
3. Remove redundant refresh triggers
4. Simplify RLS policies

---

## Next Steps

1. Create migration scripts for each table
2. Set up refresh triggers and functions
3. Create materialized view refresh schedule
4. Implement data sync service (Python backend)
5. Test with current gameweek data
6. Validate provisional vs final calculations
7. Test transfer price tracking
8. Performance test materialized views

---

---

## Quick Reference: Complete Database Summary

### Tables Summary

| # | Table Name | Columns | Primary Purpose | Key Relationships |
|---|------------|---------|------------------|-------------------|
| 1 | `teams` | 5 | Team master data | Referenced by players, fixtures, managers |
| 2 | `gameweeks` | 11 | Gameweek lifecycle | Referenced by all gameweek-specific tables |
| 3 | `players` | 7 | Player master data | Referenced by stats, picks, transfers |
| 4 | `player_gameweek_stats` | 40 | Player performance per GW | Links players + gameweeks |
| 5 | `player_prices` | 6 | Price history | Links players + gameweeks |
| 6 | `managers` | 5 | Manager master data | Referenced by history, picks, transfers |
| 7 | `manager_gameweek_history` | 20 | Manager points & ranks | Links managers + gameweeks |
| 8 | `manager_transfers` | 13 | Transfer history with prices | Links managers + players + gameweeks |
| 9 | `manager_picks` | 10 | Team selections | Links managers + players + gameweeks |
| 10 | `fixtures` | 10 | Match fixtures | Links teams + gameweeks |
| 11 | `mini_leagues` | 4 | Tracked leagues | Referenced by mini_league_managers |
| 12 | `mini_league_managers` | 3 | League membership | Links leagues + managers |
| 13 | `player_whitelist` | 4 | Query optimization | Links leagues + players + gameweeks |

**Total Tables**: 13  
**Total Columns Across All Tables**: ~144

### Materialized Views Summary

| # | View Name | Purpose | Refresh Frequency |
|---|-----------|---------|-------------------|
| 1 | `mv_mini_league_standings` | Pre-calculated league standings | When points update or GW changes |
| 2 | `mv_manager_gameweek_summary` | Manager GW summary with transfer stats | When manager data updates |
| 3 | `mv_player_gameweek_performance` | Player performance summary | When player stats update |
| 4 | `mv_league_transfer_aggregation` | League-level transfer statistics | After deadline when picks updated |
| 5 | `mv_player_owned_leaderboard` | Player-owned leaderboard (cumulative) | As needed (optional) |
| 6 | `mv_manager_transfer_impacts` | Pre-calculated transfer point impacts | Every 30-60s during live GWs |

**Total Materialized Views**: 6

### Functions Summary

| # | Function Name | Purpose | Returns |
|---|---------------|---------|---------|
| 1 | `refresh_mini_league_standings()` | Refresh mini league standings MV | void |
| 2 | `refresh_manager_gameweek_summary()` | Refresh manager GW summary MV | void |
| 3 | `refresh_player_gameweek_performance()` | Refresh player performance MV | void |
| 4 | `refresh_league_transfer_aggregation()` | Refresh league transfer aggregation MV | void |
| 5 | `refresh_player_owned_leaderboard()` | Refresh player owned leaderboard MV | void |
| 6 | `refresh_all_materialized_views()` | Refresh all MVs in sequence | void |
| 7 | `calculate_ownership_periods(INTEGER[])` | Format ownership periods string | TEXT |

**Total Functions**: 7

### Foreign Key Constraints Summary

All `team_id` references have foreign key constraints (added in migration 007):

1. `players.team_id` → `teams(team_id)`
2. `player_gameweek_stats.team_id` → `teams(team_id)`
3. `player_gameweek_stats.opponent_team_id` → `teams(team_id)`
4. `managers.favourite_team_id` → `teams(team_id)`
5. `fixtures.home_team_id` → `teams(team_id)`
6. `fixtures.away_team_id` → `teams(team_id)`

**Total Foreign Key Constraints**: 6

### Index Summary

**Table Indexes**: ~30+ indexes across all tables for performance optimization  
**Materialized View Indexes**: 10+ unique indexes for concurrent refresh support

### Migration Files

1. **001_create_tables.sql** - Creates all 13 core tables
2. **002_create_materialized_views.sql** - Creates 4 materialized views (initial set)
3. **003_create_refresh_functions.sql** - Creates 5 refresh functions (initial set)
4. **004_create_player_owned_leaderboard_view.sql** - Creates player-owned leaderboard view + MV + function
5. **005_create_transfer_impacts_view.sql** - Creates transfer impacts materialized view
6. **006_add_baseline_columns.sql** - Adds baseline preservation columns
7. **007_add_team_foreign_keys.sql** - Adds foreign key constraints for team references

**Total Migration Files**: 7

---

## References

- FPL API endpoints documented in `FPL_API_COMPLETE_REFERENCE.md`
- Calculation logic documented in `FPL_API_COMPLETE_REFERENCE.md` (Manager Points & Mini League Standings Calculation section)
- Auto-substitution rules from official FPL documentation
- Baseline preservation pattern: `BASELINE_DATA_PATTERN.md`