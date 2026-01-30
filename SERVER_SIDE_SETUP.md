# FPL Server-Side Setup & Requirements

**Created:** 2026-01-24  
**Status:** Planning/Design Phase  
**Last Updated:** 2026-01-24

---

## Document Scope

**This document covers SERVER-SIDE implementation (Digital Ocean droplet):**
- ✅ Digital Ocean droplet refresh service
- ✅ Data synchronization from FPL API to Supabase
- ✅ Backend refresh strategy and error handling
- ✅ Database schema and optimization
- ✅ Server-side API usage and rate limiting
- ✅ Data minimization and egress optimization

**This document does NOT cover:**
- ❌ Frontend UI/UX requirements
- ❌ Frontend component specifications
- ❌ User interface design
- ❌ Frontend state management

**Note:** Frontend requirements (e.g., how frontend queries Supabase, UI components) are mentioned where they impact backend decisions (like Supabase egress), but detailed frontend specs would be in a separate document.

---

## Overview

This document consolidates all server-side requirements, decisions, and specifications for the **FPL backend system** (Digital Ocean droplet) that syncs data from the FPL API to Supabase and serves multiple frontend features.

---

## System Architecture

### Infrastructure Stack
- **Database**: Supabase (PostgreSQL)
- **Server Hosting**: Digital Ocean Droplet
- **Language**: Python 3.x
- **API Source**: FPL Official API (`https://fantasy.premierleague.com/api`)

### Key Constraints
- **Supabase Egress Limit**: 5.5 GB/month (currently exceeded at 16.19 GB)
- **FPL API Rate Limits**: Unknown (assume conservative limits)
- **Goal**: Minimize API calls and Supabase egress while serving all features

---

## Core Requirements

### 1. Data Refresh Strategy

#### 1.1 Unified Refresh Approach ✅ DECIDED

**Strategy:** Fetch all active players in live games, regardless of ownership in configured leagues.

**Rationale:**
- DEFCON tracking needs all active players
- League standings can filter client-side to whitelist (no extra API calls)
- One refresh strategy serves all features
- Simpler code, no duplicate fetches

**Implementation:**
- Fetch all ~200-300 players in active matches
- Use fetched data for all features (DEFCON, standings, analysis, etc.)
- Filter client-side for features that need subsets (e.g., standings uses whitelist)

#### 1.2 Refresh Frequency ✅ DECIDED

| State | Interval | What to Refresh |
|-------|----------|-----------------|
| **Live matches** | 60 seconds | All active players, fixtures, manager points |
| **Bonus pending** | 2 minutes | All active players (matches finished, bonus not confirmed) |
| **Price change window** | 30 seconds | Player prices (5:30-5:36 PM PST, 6 min window) |
| **Idle gameweek** | 10 minutes | Gameweek status, price changes, new transfers |
| **Outside gameweek** | 1 hour | Gameweek status, price changes |
| **Transfer deadline** | 5 minutes | Manager picks, transfers (2 hours before to 1 hour after deadline) |

#### 1.2.1 Price Change Detection Timing ⚠️ CRITICAL

**Problem:** FPL price changes occur daily around **5:30 PM PST** (once per day). To accurately capture and report price changes in the UI, server-side updates must be timed precisely around this moment.

**Impact:**
- Price changes are time-sensitive (affect team value, transfer decisions)
- Users expect timely price change notifications
- Missing price changes creates stale data
- Price changes occur at a specific time (not throughout the day)

**Solution: Targeted Refresh Window (3-5 Minutes)**

**Strategy:**
1. **Targeted window** - Start 30-second refresh at 5:30 PM PST for 3-5 minutes only
2. **Compare prices** - Track price changes by comparing current prices to last known prices
3. **Report changes immediately** - Update database and trigger notifications when changes detected
4. **Minimal window** - Only refresh at high frequency during the exact time price changes occur

**Implementation:**

```python
# Configuration (PST timezone)
PRICE_CHANGE_TIME = "17:30"  # 5:30 PM PST
PRICE_CHANGE_WINDOW_DURATION = 6  # 6 minutes window (5:30-5:36 PM PST)
PRICE_CHANGE_CHECK_INTERVAL = 30  # Check every 30 seconds during window
# Note: No price checks outside window - prices only change once daily at 5:30 PM PST

async def is_price_change_window(current_time: datetime) -> bool:
    """
    Check if current time is within the targeted price change window.
    Price changes occur once daily around 5:30 PM PST.
    Window: 5:30 PM - 5:36 PM PST (6 minutes, 30 second refresh)
    """
    # Convert to PST timezone
    pst_time = current_time.astimezone(timezone(timedelta(hours=-8)))  # PST
    price_change_time = datetime.strptime(PRICE_CHANGE_TIME, "%H:%M").time()
    current_time_only = pst_time.time()
    
    # Window starts at 5:30 PM PST and lasts for 6 minutes (until 5:36 PM PST)
    price_change_datetime = datetime.combine(pst_time.date(), price_change_time)
    window_start = price_change_datetime
    window_end = price_change_datetime + timedelta(minutes=PRICE_CHANGE_WINDOW_DURATION)
    
    current_datetime = datetime.combine(pst_time.date(), current_time_only)
    return window_start <= current_datetime <= window_end

async def check_price_changes():
    """
    Check for price changes, with enhanced frequency during targeted window.
    """
    current_time = datetime.now(timezone.utc)
    in_window = await is_price_change_window(current_time)
    
    # Fetch current prices
    bootstrap_data = await fetch_bootstrap_static()
    current_prices = {player['id']: player['now_cost'] for player in bootstrap_data['elements']}
    
    # Get last known prices from database
    last_prices = await get_last_known_prices()
    
    # Compare and detect changes
    price_changes = []
    for player_id, current_price in current_prices.items():
        last_price = last_prices.get(player_id)
        if last_price and current_price != last_price:
            price_change = {
                'player_id': player_id,
                'old_price': last_price,
                'new_price': current_price,
                'change': current_price - last_price,
                'timestamp': current_time
            }
            price_changes.append(price_change)
    
    # Update database with new prices and changes
    if price_changes:
        await update_player_prices(current_prices)
        await record_price_changes(price_changes)
        logger.info(
            f"Detected {len(price_changes)} price changes",
            extra={
                "price_changes_count": len(price_changes),
                "in_price_window": in_window,
                "time": current_time.isoformat()
            }
        )
        # Trigger notifications if needed
        await notify_price_changes(price_changes)
    
    return price_changes

async def price_change_monitor():
    """
    Monitor price changes with targeted refresh window (5:30-5:36 PM PST).
    Only runs during the price change window - no checks outside window.
    """
    while True:
        current_time = datetime.now(timezone.utc)
        in_window = await is_price_change_window(current_time)
        
        if in_window:
            # Only check prices during the targeted window
            try:
                await check_price_changes()
            except Exception as e:
                logger.error(
                    f"Error checking price changes",
                    extra={"error": str(e), "in_price_window": in_window}
                )
            await asyncio.sleep(PRICE_CHANGE_CHECK_INTERVAL)  # 30 seconds
        else:
            # Outside window: Skip price checks entirely
            # Prices only change once daily at 5:30 PM PST, so no need to check outside window
            # Sleep for 1 hour, then check again if we've entered the window
            await asyncio.sleep(3600)  # Check once per hour to see if we've entered the window
```

**Refresh Strategy During Price Change Window:**

| Time Window | Action | Check Interval |
|-------------|--------|----------------|
| **5:30 PM - 5:36 PM PST** | Targeted price monitoring | 30 seconds |
| **Outside window** | No price checks | Skip (prices only change once daily at 5:30 PM PST) |

**Key Requirements:**
1. ✅ **Targeted window** - 30-second refresh starting at 5:30 PM PST for 3-5 minutes only
2. ✅ **Precise timing** - Price changes occur once daily at specific time (not throughout day)
3. ✅ **Price comparison** - Compare current prices to last known prices to detect changes
4. ✅ **Immediate updates** - Update database and trigger notifications when changes detected
5. ✅ **Minimal API calls** - Only high-frequency refresh during 3-5 minute window
6. ✅ **Logging** - Track price changes, detection timing, window status

**Database Considerations:**
- Store price history in `player_prices` table with timestamps
- Track price change events separately for reporting/notifications
- Use database triggers or materialized views for price change aggregations

**Note:** Price changes occur once per day around 5:30 PM PST. The targeted 3-5 minute window (30-second refresh) ensures we capture changes immediately while minimizing unnecessary API calls. Outside this window, prices don't change, so minimal or no refresh is needed.

#### 1.2.2 24-Hour Refresh Cadence Timeline 📊

**Overview:** This timeline visualizes the refresh cadence throughout a typical 24-hour period, showing when different refresh intervals apply based on gameweek state, match activity, and special events.

**⚠️ Important:** Foundational tables (`gameweeks`, `fixtures`) are **always** refreshed at high frequency (30-60 seconds for `gameweeks`, state-dependent for `fixtures`) regardless of other refresh cadences shown below. These tables drive all refresh decisions and must be kept current.

**Legend:**
- 🔴 **60 seconds** - High-frequency refresh (live matches, price changes)
- 🟠 **2 minutes** - Medium-high frequency (bonus pending)
- 🟡 **5 minutes** - Medium frequency (transfer deadline window)
- 🟢 **10 minutes** - Normal frequency (idle gameweek)
- ⚪ **1 hour** - Low frequency (outside gameweek)

**24-Hour Timeline:**

```
00:00 ────────────────────────────────────────────────────────────────────── 01:00
      ⚪ IDLE PERIOD (1 hour refresh)
      - Gameweek status check
      
01:00 ────────────────────────────────────────────────────────────────────── 02:00
      ⚪ IDLE PERIOD (1 hour refresh)
      
02:00 ────────────────────────────────────────────────────────────────────── 03:00
      ⚪ IDLE PERIOD (1 hour refresh)
      
03:00 ────────────────────────────────────────────────────────────────────── 04:00
      ⚪ IDLE PERIOD (1 hour refresh)
      
04:00 ────────────────────────────────────────────────────────────────────── 05:00
      ⚪ IDLE PERIOD (1 hour refresh)
      
05:00 ────────────────────────────────────────────────────────────────────── 06:00
      ⚪ IDLE PERIOD (1 hour refresh)
      
06:00 ────────────────────────────────────────────────────────────────────── 07:00
      ⚪ IDLE PERIOD (1 hour refresh)
      
07:00 ────────────────────────────────────────────────────────────────────── 08:00
      ⚪ IDLE PERIOD (1 hour refresh)
      
08:00 ────────────────────────────────────────────────────────────────────── 09:00
      ⚪ IDLE PERIOD (1 hour refresh)
      
09:00 ────────────────────────────────────────────────────────────────────── 10:00
      ⚪ IDLE PERIOD (1 hour refresh)
      
10:00 ────────────────────────────────────────────────────────────────────── 11:00
      ⚪ IDLE PERIOD (1 hour refresh)
      
11:00 ────────────────────────────────────────────────────────────────────── 12:00
      ⚪ IDLE PERIOD (1 hour refresh)
      
12:00 ────────────────────────────────────────────────────────────────────── 13:00
      🟢 IDLE GAMEWEEK (10 min refresh) OR 🔴 LIVE MATCHES (60 sec refresh)
      - If matches active: All active players, fixtures, manager points
      - If idle: Gameweek status, new transfers
      
13:00 ────────────────────────────────────────────────────────────────────── 14:00
      🟢 IDLE GAMEWEEK (10 min) OR 🔴 LIVE MATCHES (60 sec)
      - Typical match start times (weekends, some weekdays)
      
14:00 ────────────────────────────────────────────────────────────────────── 15:00
      🟢 IDLE GAMEWEEK (10 min) OR 🔴 LIVE MATCHES (60 sec)
      - Peak match activity period
      
15:00 ────────────────────────────────────────────────────────────────────── 16:00
      🟢 IDLE GAMEWEEK (10 min) OR 🔴 LIVE MATCHES (60 sec)
      - Match activity continues
      
16:00 ────────────────────────────────────────────────────────────────────── 17:00
      🟢 IDLE GAMEWEEK (10 min) OR 🔴 LIVE MATCHES (60 sec)
      - Match activity continues
      
5:30 PM ────────────────────────────────────────────────────────────────────── 5:36 PM
      🔴 PRICE CHANGE WINDOW (30 sec refresh) + 🟢 IDLE GAMEWEEK (10 min) OR 🔴 LIVE MATCHES (60 sec)
      - Targeted price monitoring (30 sec for 6 minutes)
      - Price changes occur at 5:30 PM PST
      - If matches active: Continue 60 sec refresh for matches, add 30 sec for prices
      - If idle: 30 sec refresh for prices only
      
18:00 ────────────────────────────────────────────────────────────────────── 19:00
      🟢 IDLE GAMEWEEK (10 min) OR 🔴 LIVE MATCHES (60 sec)
      - Price change window ends
      - Return to normal refresh cadence
      
19:00 ────────────────────────────────────────────────────────────────────── 20:00
      🟢 IDLE GAMEWEEK (10 min) OR 🔴 LIVE MATCHES (60 sec)
      - Match activity may continue
      
20:00 ────────────────────────────────────────────────────────────────────── 21:00
      🟢 IDLE GAMEWEEK (10 min) OR 🟠 BONUS PENDING (2 min refresh)
      - Matches finishing, bonus points being calculated
      - If bonus pending: 2 min refresh for all active players
      - If bonus confirmed: Return to 10 min refresh
      
21:00 ────────────────────────────────────────────────────────────────────── 22:00
      🟢 IDLE GAMEWEEK (10 min) OR 🟠 BONUS PENDING (2 min refresh)
      - Bonus calculation period
      
22:00 ────────────────────────────────────────────────────────────────────── 23:00
      🟢 IDLE GAMEWEEK (10 min refresh)
      - Bonus typically confirmed by this time
      - Return to normal refresh cadence
      
23:00 ────────────────────────────────────────────────────────────────────── 00:00
      ⚪ OUTSIDE GAMEWEEK (1 hour refresh) OR 🟢 IDLE GAMEWEEK (10 min refresh)
      - If outside gameweek: Minimal refresh (1 hour)
      - If idle gameweek: Normal refresh (10 min)
```

**Special Event Windows:**

**Transfer Deadline Window** (varies by gameweek, typically Friday 18:30 UTC):
```
Deadline - 2 hours ─────────────────────────────────── Deadline ─────────────────────────────────── Deadline + 1 hour
🟡 TRANSFER DEADLINE WINDOW (5 min refresh)
- Manager picks
- Transfers
- Team selections
```

**Post-Deadline Maintenance Window** (immediately after transfer deadline):
```
Deadline ────────────────────────────────────────────────────────────────────── Deadline + 60 min
⚠️ POST-DEADLINE MAINTENANCE (Polling with exponential backoff: 2-5 min intervals)
- FPL API maintenance/update mode
- Poll API every 2-5 minutes until available
- Build gameweek baseline once API returns
- Whitelist, manager picks, transfers
```

**Typical Matchday Schedule** (Weekends):
```
Saturday:
  12:30 - 5:30 PM  🔴 LIVE MATCHES (60 sec refresh)
  5:30 - 5:36 PM   🔴 PRICE CHANGE WINDOW (30 sec) + 🔴 LIVE MATCHES (60 sec)
  5:36 PM - 8:00 PM 🔴 LIVE MATCHES (60 sec refresh)
  8:00 - 10:00 PM  🟠 BONUS PENDING (2 min refresh)
  10:00 PM+        🟢 IDLE GAMEWEEK (10 min refresh)

Sunday:
  2:00 - 5:30 PM  🔴 LIVE MATCHES (60 sec refresh)
  5:30 - 5:36 PM  🔴 PRICE CHANGE WINDOW (30 sec) + 🔴 LIVE MATCHES (60 sec)
  5:36 PM - 8:00 PM 🔴 LIVE MATCHES (60 sec refresh)
  8:00 - 10:00 PM  🟠 BONUS PENDING (2 min refresh)
  10:00 PM+        🟢 IDLE GAMEWEEK (10 min refresh)
```

**Refresh Cadence Summary Table:**

| Time Period | Typical State | Refresh Interval | Primary Data |
|-------------|---------------|------------------|--------------|
| **00:00 - 12:00** | Outside gameweek / Idle | 1 hour / 10 min | Gameweek status, prices |
| **12:00 - 17:00** | Idle gameweek / Live matches | 10 min / 60 sec | Match data (if active) |
| **5:30 - 5:36 PM PST** | Price change window | 30 sec | Prices (6 min window) |
| **18:00 - 20:00** | Idle gameweek / Live matches | 10 min / 60 sec | Match data (if active) |
| **20:00 - 22:00** | Bonus pending | 2 min | Active players (bonus) |
| **22:00 - 00:00** | Idle gameweek | 10 min | Gameweek status |

**Key Considerations:**
1. **Foundational tables always refresh**: `gameweeks` (30-60 sec) and `fixtures` (state-dependent) are refreshed continuously regardless of other refresh cadences
2. **Price change window**: Targeted 3-5 minute window at 5:30 PM PST (30 sec refresh) - minimal overlap with matches
3. **Dynamic state detection**: System must detect current state (live matches, bonus pending, idle) and adjust refresh accordingly
4. **Transfer deadlines**: Occur on specific days/times per gameweek - requires calendar integration
5. **Post-deadline maintenance**: Only applies immediately after transfer deadline, not daily
6. **Timezone awareness**: Price change window is local time, deadlines are typically UTC
7. **Dependency ordering**: Always refresh foundational tables (`gameweeks`, `fixtures`) before dependent tables

**Implementation Notes:**
- Refresh cadence should be dynamically adjusted based on detected state
- Multiple refresh timers may run simultaneously (e.g., price monitoring + match monitoring)
- State transitions should be logged for monitoring and debugging
- Calendar integration needed for transfer deadline detection

#### 1.3 Data Minimization Requirements

**Fixtures:**
- Filter to current gameweek only (client-side)
- Store ~10 fixtures instead of ~700+
- **Reduction**: ~98% less fixture data

**Players:**
- Fetch only active players during matches (~200-300)
- Fetch 0 players during idle periods
- **Reduction**: ~50-67% vs fetching all 600 players

**Whitelist:**
- Build once per gameweek after transfer deadline
- Store in database (`player_whitelist` table)
- Used for client-side filtering (not for API fetch decisions)
- Typical size: ~100-150 players

---

## Feature Requirements

### 2.1 League Standings

**Data Needs:**
- Players owned by tracked managers (whitelist)
- Manager points and ranks
- Rank changes from previous gameweek
- Provisional vs final status

**Data Source:**
- Filter all active players to whitelist (client-side)
- No additional API calls needed

### 2.2 DEFCON Tracking

**Data Needs:**
- All players in active matches
- Defensive contribution stats
- Real-time updates during matches

**Data Source:**
- All active players (primary use case for unified strategy)
- ~200-300 players during matchday

### 2.3 Price Tracking

**Data Needs:**
- All player prices
- Price changes over time
- Timely price change notifications

**Data Source:**
- `bootstrap-static` endpoint (cached for 5 minutes)
- Targeted monitoring during price change window (5:30-5:36 PM PST): 30 seconds
- Normal monitoring outside window: 10 minutes
- See [Price Change Detection Timing](#121-price-change-detection-timing--critical) for detailed strategy

### 2.4 Player Analysis

**Data Needs:**
- Player stats, history, upcoming fixtures

**Data Source:**
- Use all active players data (already fetched)
- Additional historical data as needed (less frequent)

---

## Technical Requirements

### 3.1 Error Handling ✅ DECIDED

**Retry Strategy:**
- 3 retries with exponential backoff: 1s → 2s → 4s
- Add ±25% jitter to avoid thundering herd
- Max delay: 60 seconds

**Retryable Errors:**
- 429 (rate limit), 500, 502, 503, 504
- Network/timeout errors
- Connection errors

**Non-Retryable Errors (Alert Immediately):**
- 400 (bad request), 401 (unauthorized), 403 (forbidden), 404 (not found)

**Partial Failure Handling:**
- Continue with available data if some managers/players fail
- Log failures and retry in next cycle
- Circuit breaker: pause if >50% failure rate

**Logging:**
- Structured JSON format
- Include: timestamp, level, component, gameweek, manager_id, endpoint, error, context

#### 3.1.1 Post-Deadline Maintenance Window ⚠️ CRITICAL

**Problem:** After transfer deadline, FPL API enters a maintenance/update mode for **45-50 minutes**. During this window:
- API returns errors (typically 500, 502, 503, 504)
- FPL website shows "game is updating" message
- **All API endpoints are unavailable**
- Cannot build gameweek baseline (whitelist, manager picks, transfers)

**Impact:**
- Blocks gameweek initialization
- Cannot build player whitelist
- Cannot fetch manager picks/transfers
- **Critical for first refresh after deadline**

**Solution: Graceful Polling Until API Returns**

**Strategy:**
1. **Detect post-deadline window** - Check if within 60 minutes of deadline
2. **Handle maintenance errors gracefully** - Treat 5xx errors as "maintenance mode" (not real errors)
3. **Poll with exponential backoff** - Check API availability every 2-5 minutes
4. **Wait for API to return** - Once API responds successfully, proceed with gameweek baseline build
5. **Build baseline immediately** - Once API is back, build whitelist, fetch manager picks, etc.

**Implementation:**

```python
async def wait_for_api_after_deadline(deadline_time: datetime, current_time: datetime):
    """
    Wait for FPL API to return after maintenance window.
    Polls API with exponential backoff until it becomes available.
    """
    time_since_deadline = (current_time - deadline_time).total_seconds() / 60
    
    # Only wait if we're in the post-deadline window (0-60 minutes)
    if time_since_deadline < 0 or time_since_deadline > 60:
        return True  # API should be available
    
    # Poll with exponential backoff: 2min → 3min → 5min → 5min (max)
    base_delay = 120  # 2 minutes
    max_delay = 300   # 5 minutes
    max_attempts = 20  # Up to ~60 minutes total wait time
    
    for attempt in range(max_attempts):
        try:
            # Try a lightweight endpoint to check API availability
            response = await fetch_bootstrap_static()
            
            # If we get a successful response, API is back online
            logger.info(
                f"FPL API is back online after maintenance",
                extra={
                    "time_since_deadline_min": time_since_deadline,
                    "attempt": attempt + 1
                }
            )
            return True
            
        except requests.HTTPError as e:
            # 5xx errors during maintenance window = expected, keep waiting
            if e.response.status_code in [500, 502, 503, 504]:
                if attempt < max_attempts - 1:
                    delay = min(base_delay + (attempt * 60), max_delay)
                    logger.info(
                        f"FPL API still in maintenance, waiting {delay}s",
                        extra={
                            "time_since_deadline_min": time_since_deadline,
                            "attempt": attempt + 1,
                            "status_code": e.response.status_code
                        }
                    )
                    await asyncio.sleep(delay)
                    continue
                else:
                    # Max attempts reached, but still in maintenance
                    logger.warning(
                        f"FPL API still in maintenance after {max_attempts} attempts",
                        extra={
                            "time_since_deadline_min": time_since_deadline
                        }
                    )
                    raise MaintenanceWindowTimeoutError(
                        f"API still in maintenance after {max_attempts} attempts"
                    )
            else:
                # Other errors (4xx) = actual error, don't retry
                raise
        except Exception as e:
            # Network errors, connection errors = retry
            if attempt < max_attempts - 1:
                delay = min(base_delay + (attempt * 60), max_delay)
                logger.warning(
                    f"Network error checking API, retrying in {delay}s",
                    extra={
                        "time_since_deadline_min": time_since_deadline,
                        "attempt": attempt + 1,
                        "error": str(e)
                    }
                )
                await asyncio.sleep(delay)
                continue
            else:
                raise

async def build_gameweek_baseline_after_deadline(gameweek: int, deadline_time: datetime):
    """
    Build gameweek baseline (whitelist, manager picks) after deadline.
    Waits for API to return from maintenance before proceeding.
    """
    current_time = datetime.now(timezone.utc)
    
    # Wait for API to return from maintenance
    await wait_for_api_after_deadline(deadline_time, current_time)
    
    # Now that API is back, build baseline
    logger.info(
        f"Building gameweek baseline for GW {gameweek}",
        extra={"gameweek": gameweek}
    )
    
    # Build whitelist
    whitelist = await build_player_whitelist(gameweek)
    
    # Fetch manager picks
    await fetch_all_manager_picks(gameweek)
    
    # Fetch transfers
    await fetch_all_manager_transfers(gameweek)
    
    logger.info(
        f"Gameweek baseline complete for GW {gameweek}",
        extra={"gameweek": gameweek, "whitelist_size": len(whitelist)}
    )
```

**Refresh Strategy During Post-Deadline Window:**

| Time Since Deadline | Action | Poll Interval |
|---------------------|--------|---------------|
| **0-60 minutes** | Wait for API to return | 2-5 minutes (exponential backoff) |
| **60+ minutes** | Assume API is available | Normal refresh schedule |

**Key Requirements:**
1. ✅ **Detect maintenance window** - Check if within 60 minutes of deadline
2. ✅ **Handle 5xx errors gracefully** - During maintenance, these are expected (not real errors)
3. ✅ **Poll with backoff** - Check every 2-5 minutes until API returns
4. ✅ **Build baseline immediately** - Once API is back, build whitelist and fetch manager data
5. ✅ **Logging** - Track maintenance window duration, API return time
6. ✅ **Timeout** - After 60 minutes, assume API should be available (or alert if still down)

**Note:** This is different from normal error handling. During the maintenance window, 5xx errors are **expected** and should trigger polling, not alerts. Only after the maintenance window should 5xx errors be treated as real errors.

#### 3.1.2 Player Whitelist Timing Requirements ⚠️ CRITICAL

**Critical Timing Window:** Player whitelist must be built in a specific time window with strict requirements.

**Required Sequence:**
1. ✅ **After Transfer Deadline** - Deadline must have passed (manager picks are locked)
2. ✅ **After API Maintenance Window** - FPL API must be back online (not in maintenance mode)
3. ✅ **Before First Kickoff** - Must complete before first match starts

**Why Each Requirement Matters:**

**1. After Transfer Deadline:**
- Manager picks are locked at deadline
- Picks cannot change after deadline
- Building whitelist before deadline = incomplete/incorrect data

**2. After API Maintenance Window:**
- FPL API is unavailable during maintenance (45-50 minutes after deadline)
- Cannot fetch manager picks during maintenance
- Must wait for API to return before building whitelist

**3. Before First Kickoff:**
- Whitelist is needed to filter players for league standings
- If matches start before whitelist is built, we can't filter active players correctly
- League standings will be incomplete/incorrect

**Timeline Example (GW24 - 5:30 AM PST deadline):**
```
5:30 AM  ── Deadline passes
         │
         ├─ API enters maintenance (45-50 min)
         │
6:15 AM  ── API returns from maintenance
         │
         ├─ Build whitelist (15 min window)
         │  - Fetch all manager picks
         │  - Extract all owned players
         │  - Store in player_whitelist table
         │
6:30 AM  ── First kickoff (matches start)
         │
         └─ Whitelist MUST be complete by this time
```

**Implementation Requirements:**
- Monitor `gameweeks` table for deadline time
- Poll API after deadline until available (exponential backoff)
- Build whitelist immediately once API returns
- Verify whitelist is complete before first kickoff
- Alert if whitelist not built before first match starts

**Failure Impact:**
- ❌ League standings will show all active players (not just owned)
- ❌ Cannot filter player stats for league-specific features
- ❌ Data quality issues for entire gameweek
- ❌ Manual intervention required to rebuild whitelist

**Validation:**
- Check `player_whitelist` table has entries for current gameweek
- Verify whitelist size is reasonable (~100-150 players typical)
- Confirm whitelist was built after deadline but before first kickoff
- Log whitelist build time for monitoring

### 3.2 Rate Limiting ✅ DECIDED

**Limits:**
- Max 30 requests/minute (0.5 req/sec average)
- Max 1 request/second with jitter
- Conservative approach (FPL limits unknown)

**Caching:**
- `bootstrap-static`: 5 minutes (gameweek) / 1 hour (off)
- `fixtures`: 30 seconds (live matches and when finished/bonus pending) / 10 minutes (idle)
- `gameweeks`: **30-60 seconds** (foundational table, drives all refresh decisions)

**Request Queuing:**
- Use asyncio queue for ordered requests
- Separate queues per endpoint type for parallelization

### 3.3 Supabase Egress Minimization ✅ CRITICAL

**Problem:** 16.19 GB/month usage (294% over 5.5 GB limit)

**Requirements:**
1. **Always filter at database level** - Use WHERE clauses, never fetch full tables
2. **Select only needed columns** - Not SELECT *
3. **Use materialized views** - Pre-aggregated, filtered data
4. **Aggregate in database** - Not in application
5. **Implement caching** - Reduce uncached queries
6. **Use direct DB connections** - Avoid REST API overhead when possible

**Frontend Query Impact (Note for Backend):**
- Every frontend query counts as egress (affects backend database design)
- Backend must provide materialized views for frontend to use
- Backend must ensure queries are filterable (WHERE clauses possible)
- Backend must design schema to support column selection

**Target:** Reduce egress from 16 GB/month to <5.5 GB/month (~88-94% reduction)

---

## Database Requirements

### 4.1 Schema

See `SUPABASE_DATABASE_SCHEMA_DESIGN.md` for complete schema.

**Key Tables:**
- `gameweeks` - Gameweek lifecycle tracking
- `players` - Player master data
- `player_gameweek_stats` - Player performance per gameweek
- `player_prices` - Price history
- `managers` - Manager master data
- `manager_gameweek_history` - Manager points and ranks
- `manager_transfers` - Transfer history with prices
- `manager_picks` - Team selections
- `fixtures` - Match fixtures
- `mini_leagues` - Tracked leagues
- `mini_league_managers` - League membership
- `player_whitelist` - Players owned by tracked managers (per gameweek)

**Materialized Views:**
- `mv_mini_league_standings` - Pre-calculated standings
- `mv_manager_gameweek_summary` - Manager GW summary
- `mv_player_gameweek_performance` - Player performance summary

### 4.2 Data Dependencies and Refresh Priorities ⚠️ CRITICAL

**Problem:** Some tables are foundational and drive refresh decisions for other tables. These must be refreshed more frequently to ensure accurate state detection and refresh cadence.

**Foundational Tables (High Priority):**

**1. `gameweeks` Table** - **MOST CRITICAL**
- **Refresh Frequency:** Every 30-60 seconds (always, regardless of state)
- **Why:** Drives ALL refresh decisions
  - Determines current gameweek number
  - Indicates if we're in a gameweek or outside
  - Provides transfer deadline times
  - Indicates match start/end times
  - Determines if matches are live
- **Impact:** If stale, entire refresh system uses wrong cadence
- **Dependencies:** All other tables depend on this

**2. `fixtures` Table** - **HIGH PRIORITY**
- **Refresh Frequency:** 
  - **30 seconds during live matches AND when matches finished (bonus pending)**
  - 10 minutes during idle gameweek
- **Why:** Determines match state
  - Which matches are live
  - Which players are active
  - Match scores and status (`team_h_score`, `team_a_score`)
  - When matches finish (`finished`, `finished_provisional`)
  - Bonus calculation status (`finished_provisional: true` = bonus pending)
- **Impact:** Drives player refresh decisions (which players to fetch)
- **Dependencies:** `player_gameweek_stats` depends on this

**Critical Fields from Fixtures:**
- `started` (boolean) - **CRITICAL**: Detects when match goes live
- `finished` (boolean) - **CRITICAL**: Detects when match is completely done
- `finished_provisional` (boolean) - **CRITICAL**: Detects bonus pending state
- `kickoff_time` (datetime) - **CRITICAL**: Know when matches are scheduled
- `event` (integer) - **CRITICAL**: Filter to current gameweek
- `team_h_score`, `team_a_score` (integer) - **CRITICAL**: Match scorelines
- `minutes` (integer) - Current minute of match

**Refresh Frequency Strategy:**

**30 Seconds During Live Matches AND When Finished (Bonus Pending):**
- **When to use 30s refresh:**
  - While matches are live (`started: true`, `finished: false`)
  - While matches are finished but bonus pending (`finished_provisional: true`, `finished: false`)
- **When to stop 30s refresh:**
  - Once `finished: true` (bonus confirmed, match completely done)
  - Return to 10 min idle refresh
- **Why:** Single frequency covers all match states
  - Detect when matches start (`started: true`)
  - Detect when matches finish (`finished_provisional: true`)
  - Get accurate scorelines (`team_h_score`, `team_a_score`)
  - Detect when bonus is confirmed (`finished: true`)
- **Impact:** 
  - Know immediately when games finish or are provisionally over
  - Accurate scorelines for UI
  - Quick detection of bonus confirmation
- **API Impact:** 
  - Fixtures endpoint is lightweight (just match metadata, ~10-20 KB per call)
  - 30s refresh = 120 calls/hour = 2 calls/minute
  - During 3-hour match window = ~360 calls (acceptable)
  - **No significant impact on API rates** - fixtures endpoint is small and efficient
- **Egress Impact:**
  - Fixtures data is small (~10-20 KB per refresh)
  - 30s refresh during matches = minimal egress
  - **No significant impact on Supabase egress** - data size is small

**Refresh State Logic:**
```
Match State                    | Fixtures Refresh | Player Stats Refresh | Trigger
────────────────────────────────────────────────────────────────────────────────────
No matches scheduled soon      | 10 min (idle)   | None                 | Default idle
Within 5 min of kickoff         | 30 sec          | None                 | gameweeks detects upcoming kickoff
started: true, finished: false | 30 sec          | 60 sec (active)      | fixtures detects started: true
  (includes halftime - match still live, just paused)
finished_provisional: true      | 30 sec          | 2 min (all active)  | fixtures detects finished_provisional
finished: true, more matches today | 30 sec | None | fixtures detects finished, but more matches scheduled
finished: true, all matches done | 10 min (idle) | None | fixtures detects finished, no more matches today
```

**Transition Logic:**
1. **Idle → Pre-Match:** `gameweeks` table (30-60s refresh) detects `kickoff_time` within 5 minutes → switch fixtures to 30s
2. **Pre-Match → Live:** `fixtures` table (30s refresh) detects `started: true` → begin player stats refresh
3. **Live → Finished:** `fixtures` table (30s refresh) detects `finished_provisional: true` → continue 30s, switch player stats to 2 min
4. **Finished → Gap Between Matches:** `fixtures` table (30s refresh) detects `finished: true` BUT checks if more matches scheduled today → continue 30s fixtures (to detect next match start), stop player stats (no active players)
5. **Gap → Next Match:** `fixtures` table (30s refresh) detects next match `started: true` → resume player stats refresh
6. **All Matches Done → Idle:** `fixtures` table (30s refresh) detects all matches `finished: true` and no more scheduled today → return to 10 min idle

**Key Point:** We rely on `gameweeks` table (refreshed every 30-60s) to detect upcoming kickoff times and trigger pre-match refresh, preventing 10-minute delay when matches start.

**Handling Gaps Between Matches on Same Day:**
- **Problem:** Matches on same day have gaps (e.g., 7:00 AM match finishes, 9:30 AM match hasn't started)
- **Solution:** Continue 30s fixtures refresh during gaps to detect when next match starts
- **Logic:** Check if more matches scheduled today (via `fixtures` filtered by `event` = current gameweek)
  - If more matches today: Continue 30s fixtures, stop player stats (no active players)
  - If all matches done today: Return to 10 min idle (or check for matches tomorrow)

**Handling Halftime:**
- **Not an issue:** During halftime, match is still `started: true, finished: false`
- **Action:** Continue 30s fixtures + 60s player stats (match is still live, just paused)
- **No special handling needed:** Halftime is part of live match state

**10 Minutes During Idle Periods:**
- **When:** No matches scheduled soon (more than 5 minutes before first kickoff)
- **Why:** Matches are scheduled (not random), so we can use `kickoff_time` to prepare
- **Risk:** If we only check fixtures every 10 min, we could miss match start by up to 10 minutes
- **Solution:** Use `gameweeks` table (refreshed every 30-60s) to detect upcoming kickoff times within 5 minutes

**Pre-Match Transition (5 Minutes Before First Kickoff):**
- **Trigger:** `gameweeks` table detects upcoming `kickoff_time` within 5 minutes
- **Action:** Increase fixtures refresh from 10 min → 30 sec
- **Why:** Kickoff times are usually spot on, so 5 min window is sufficient to catch match start immediately
- **Logic:** 
  ```
  gameweeks table (30-60s refresh) detects:
  - Next kickoff_time is within 5 minutes
  - → Switch fixtures refresh from 10 min → 30 sec
  - → Continue 30 sec until match starts
  ```

**Recommendation:**
- ✅ **30 seconds during live matches AND when finished (bonus pending)**: Single frequency simplifies logic, covers all needs, minimal API/egress impact
- ✅ **10 minutes idle**: Acceptable when no matches scheduled soon (more than 5 min before kickoff)
- ✅ **30 seconds pre-match**: Switch to 30s refresh 5 minutes before first kickoff (triggered by `gameweeks` table)
- ✅ **No separate "2 minutes when finished" frequency needed**: 30s covers it

**Refresh Priority Hierarchy:**

```
┌─────────────────────────────────────────────────────────────┐
│ TIER 1: FOUNDATIONAL (Always refresh first, most frequently)│
├─────────────────────────────────────────────────────────────┤
│ • gameweeks        → Every 30-60 seconds                    │
│ • fixtures         → 30 sec (live + finished/bonus pending) / 10 min (idle) │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ TIER 2: STATE-DEPENDENT (Refresh based on Tier 1 state)    │
├─────────────────────────────────────────────────────────────┤
│ • player_gameweek_stats → Only if fixtures show live matches│
│ • player_prices         → 30 sec during targeted window (5:30-5:36 PM PST) │
│ • manager_picks         → Only at gameweek start/deadline   │
│ • manager_transfers     → Only near/after deadline          │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ TIER 3: DERIVED (Calculated from Tier 1 & 2)                │
├─────────────────────────────────────────────────────────────┤
│ • manager_gameweek_history → Calculated from player stats   │
│ • player_whitelist         → Built from manager_picks       │
│ • Materialized views       → Refreshed after data updates   │
└─────────────────────────────────────────────────────────────┘
```

**Refresh Decision Flow:**

```python
async def refresh_cycle():
    """
    Refresh cycle with proper dependency ordering.
    """
    # TIER 1: Always refresh foundational tables first
    gameweek_data = await refresh_gameweeks()  # Every 30-60 sec
    current_gw = gameweek_data['current_gameweek']
    is_live = gameweek_data['is_live']
    deadline_time = gameweek_data['deadline_time']
    
    # Refresh fixtures to determine match state
    fixtures = await refresh_fixtures()  # Frequency based on state
    active_matches = get_active_matches(fixtures)
    
    # TIER 2: Refresh based on foundational state
    if active_matches:
        # Live matches detected - refresh active players
        await refresh_player_gameweek_stats(active_matches)
    elif is_bonus_pending(fixtures):
        # Bonus pending - refresh all active players
        await refresh_player_gameweek_stats(get_finished_players(fixtures))
    
    # Check if in price change window
    if is_price_change_window():
        await refresh_player_prices()  # 30 sec during targeted window (5:30-5:36 PM PST)
    
    # Check if near transfer deadline
    if is_near_deadline(deadline_time):
        await refresh_manager_picks(current_gw)
        await refresh_manager_transfers()
    
    # TIER 3: Calculate derived data
    await calculate_manager_gameweek_history(current_gw)
    await refresh_materialized_views()
```

**Key Principles:**

1. **`gameweeks` is always refreshed first** - Every refresh cycle starts here
2. **Refresh frequency is state-dependent** - Based on `gameweeks` and `fixtures` state
3. **Cascade updates** - Tier 2 tables only refresh if Tier 1 indicates they should
4. **Minimize unnecessary refreshes** - Don't refresh player stats if no matches active
5. **Priority order matters** - Always refresh foundational tables before dependent tables

**Refresh Frequency by Table:**

| Table | Base Frequency | Conditions | Notes |
|-------|------------------|------------|------|
| `gameweeks` | **30-60 seconds** | Always | Drives all decisions |
| `fixtures` | 30 sec / 10 min | Live matches + Finished (bonus pending) / Idle | Determines match state, scorelines, bonus status |
| `player_gameweek_stats` | 60 sec / 2 min | Live matches / Bonus pending | Only if matches active |
| `player_prices` | 30 sec / None | Price window (5:30-5:36 PM PST) / All other times | 6 min window once daily, no refresh outside window |
| `manager_picks` | 5 min | Near deadline | Only around deadlines |
| `manager_transfers` | 5 min | Near deadline | Only around deadlines |
| `manager_gameweek_history` | Calculated | After player stats | Derived data |
| `player_whitelist` | Once per gameweek | After deadline | Built from picks |

**Implementation Notes:**

- `gameweeks` table should be checked at the start of EVERY refresh cycle
- Cache `gameweeks` data in memory for quick state checks
- Use `gameweeks` state to determine which refresh cadence to use
- Only refresh dependent tables if foundational tables indicate they're needed
- Log state transitions for monitoring and debugging

### 4.3 Data Refresh Order

**Execution Order (within each refresh cycle):**

1. **Update `gameweeks`** (check current/previous/next status) - **ALWAYS FIRST**
2. **Update `fixtures`** (match status, scores) - **ALWAYS SECOND**
3. **Determine refresh state** (live matches, bonus pending, idle, price window, deadline)
4. **Conditional refreshes based on state:**
   - If live matches: Update `player_gameweek_stats` (all active players)
   - If bonus pending: Update `player_gameweek_stats` (all active players)
   - If price window (5:30-5:36 PM PST): Update `player_prices` (30 sec for 6 min)
   - If near deadline: Update `manager_picks` and `manager_transfers`
5. **Calculate derived data:**
   - Calculate `manager_gameweek_history` (manager points, ranks)
   - Build `player_whitelist` (if gameweek just started)
6. **Refresh materialized views** (after all data updates)

---

## API Requirements

### 5.1 FPL API Endpoints

**Primary Endpoints:**
- `GET /bootstrap-static/` - Static data (players, teams, gameweeks)
- `GET /fixtures/` - All fixtures (filter client-side to current gameweek)
- `GET /event/{gameweek}/live` - Live player stats (avoid - use element-summary instead)
- `GET /element-summary/{player_id}/` - Individual player data (use for active players)
- `GET /entry/{manager_id}/` - Manager entry info
- `GET /entry/{manager_id}/event/{gameweek}/picks/` - Manager picks
- `GET /entry/{manager_id}/history/` - Manager history
- `GET /entry/{manager_id}/transfers/` - Manager transfers

**Filtering:**
- FPL API does NOT support server-side filtering
- Must filter client-side or use selective endpoint calls

### 5.2 Data Fetching Strategy

**During Live Matches:**
1. Fetch `fixtures` (filter to current gameweek)
2. Identify all active players in matches
3. Fetch `element-summary/{id}` for each active player (~200-300 calls)
4. Update player stats in database
5. Calculate manager points (only tracked managers)
6. Filter client-side for league standings (whitelist)

**During Idle Periods:**
1. Check gameweek status
2. Check for price changes (bootstrap-static, cached)
3. Check for new transfers (only tracked managers)
4. No player fetches (no active matches)

---

## Operational Requirements

### 6.1 Monitoring

**Metrics to Track:**
- Refresh success rate (per endpoint)
- Average refresh latency
- API error rate (by status code)
- Database write latency
- Queue depth (if using queues)
- Data staleness (time since last successful refresh)
- Supabase egress usage (daily)

**Alerting:**
- Immediate alerts: 401, 403, persistent failures after retries
- Warning alerts: Rate limiting (429), high error rate (>10%), data staleness (>15 min)
- Info logging: All retries, partial failures, refresh cycle completion

### 6.2 Process Management

**Deployment:**
- Use systemd service for main refresh daemon
- Use systemd timer for scheduled jobs
- Deploy via git pull + systemctl restart
- Auto-restart on crash (Restart=always)

**Environment:**
- Store secrets in environment variables
- Required: SUPABASE_URL, SUPABASE_KEY, FPL_API_BASE_URL
- Separate configs for dev/staging/prod

### 6.3 Backup & Recovery

- Supabase handles backups (check plan limits)
- Manual backups for critical data
- Recovery Point Objective (RPO): TBD
- Recovery Time Objective (RTO): TBD

---

## Implementation Phases

### Phase 1: Basic Refresh Service
- [ ] Set up Digital Ocean droplet
- [ ] Configure Supabase connection
- [ ] Implement basic refresh loop
- [ ] Handle gameweeks and fixtures
- [ ] Basic error handling

### Phase 2: Player Data Sync
- [ ] Implement unified refresh (all active players)
- [ ] Implement player_gameweek_stats refresh
- [ ] Implement player_prices refresh
- [ ] Handle provisional bonus calculation

### Phase 3: Manager Data Sync
- [ ] Implement manager_gameweek_history refresh
- [ ] Implement manager_picks refresh
- [ ] Implement manager_transfers refresh
- [ ] Build player whitelist (once per gameweek)
- [ ] Calculate mini league ranks

### Phase 4: Optimization & Monitoring
- [ ] Add monitoring and alerting
- [ ] Optimize refresh frequency
- [ ] Add caching
- [ ] Performance tuning
- [ ] Egress monitoring and optimization

---

## Open Questions

- [ ] What size Digital Ocean droplet?
- [ ] Single server or multi-server?
- [ ] Do we need staging environment?
- [ ] What's the budget for hosting?
- [ ] Supabase tier (free vs paid)?
- [ ] Do we need API authentication for our endpoints?
- [ ] Should we implement webhooks for real-time updates?

---

## Related Documents

- [Supabase Database Schema](./SUPABASE_DATABASE_SCHEMA_DESIGN.md) - Complete database schema
- [FPL API Reference](./FPL_API_COMPLETE_REFERENCE.md) - Complete FPL API documentation
- [FPL Data Dictionary](./FPL_DATA_DICTIONARY.md) - Data field definitions

---

*This document should be updated as requirements are finalized and implementation progresses.*
