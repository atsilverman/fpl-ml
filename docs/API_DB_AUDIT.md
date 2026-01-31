# FPL API vs Database Audit

**Purpose:** Verify we fetch and store FPL API data correctly. This doc maps API endpoints → DB tables/columns and notes gaps.

---

## 1. Gameweeks

| Source | API | DB |
|--------|-----|-----|
| **Endpoint** | `GET /bootstrap-static/` → `events[]` | `gameweeks` |
| **When** | Every refresh cycle (`_refresh_gameweeks`) | Upsert per event |
| **Mapping** | | |
| `events[].id` | → | `id` (PK) |
| `events[].name` | → | `name` |
| `events[].deadline_time` | → | `deadline_time` |
| `events[].is_current` | → | `is_current` |
| `events[].is_previous` | → | `is_previous` |
| `events[].is_next` | → | `is_next` |
| `events[].finished` | → | `finished` |
| `events[].data_checked` | → | `data_checked` |
| `events[].highest_score` | → | `highest_score` |
| `events[].average_entry_score` | → | `average_entry_score` |

**Status:** ✅ Correct. Refreshed every cycle.

---

## 2. Fixtures

| Source | API | DB |
|--------|-----|-----|
| **Endpoint** | `GET /fixtures/` | `fixtures` |
| **When** | Every refresh cycle (`_refresh_fixtures`) | Upsert per fixture (filtered to current gameweek) |
| **Mapping** | | |
| `fixtures[].id` | → | `fpl_fixture_id` (PK) |
| `fixtures[].event` | → | `gameweek` |
| `fixtures[].team_h` | → | `home_team_id` |
| `fixtures[].team_a` | → | `away_team_id` |
| `fixtures[].team_h_score` | → | `home_score` |
| `fixtures[].team_a_score` | → | `away_score` |
| `fixtures[].started` | → | `started` |
| `fixtures[].finished` | → | `finished` |
| `fixtures[].finished_provisional` | → | `finished_provisional` |
| `fixtures[].minutes` | → | `minutes` |
| `fixtures[].kickoff_time` | → | `kickoff_time` |
| (from gameweeks) | → | `deadline_time` |

**Status:** ✅ Correct. API `event` = gameweek; `team_h`/`team_a` = home/away team IDs.

---

## 3. Teams

| Source | API | DB |
|--------|-----|-----|
| **Endpoint** | `GET /bootstrap-static/` → `teams[]` | `teams` |
| **When** | **Not in refresh cycle.** Populated by `scripts/populate_test_data.py` only. | |
| **Mapping** | | |
| `teams[].id` | → | `team_id` (PK) |
| `teams[].name` | → | `team_name` |
| `teams[].short_name` | → | `short_name` |

**Gap:** Refresh cycle never calls `upsert_team`. Teams must be populated once (e.g. `populate_test_data.py` or a one-off bootstrap sync). If you run only `refresh_data.py` on a fresh DB, `teams` will be empty and any join on teams will fail.

**Recommendation:** Either document that teams/players must be populated first, or add an optional bootstrap sync step (e.g. sync teams + players from bootstrap at start of refresh when DB is empty or on a schedule).

---

## 4. Players

| Source | API | DB |
|--------|-----|-----|
| **Endpoint** | `GET /bootstrap-static/` → `elements[]` | `players` |
| **When** | **Not in refresh cycle.** Populated by `scripts/populate_test_data.py` only. | |
| **Mapping** | | |
| `elements[].id` | → | `fpl_player_id` (PK) |
| `elements[].first_name` | → | `first_name` |
| `elements[].second_name` | → | `second_name` |
| `elements[].web_name` | → | `web_name` |
| `elements[].team` | → | `team_id` |
| `elements[].element_type` | → | `position` |

**Gap:** Same as teams — refresh cycle never calls `upsert_player`. Players must be populated once. Manager picks and player_gameweek_stats reference `players`; without players, inserts/updates can fail on FK or joins.

---

## 5. Player gameweek stats

| Source | API | DB |
|--------|-----|-----|
| **Endpoint** | `GET /event/{gw}/live` (preferred) or `GET /element-summary/{id}/` | `player_gameweek_stats` |
| **When** | **Only when state is LIVE_MATCHES or BONUS_PENDING** (`_refresh_players`). Not run in IDLE. | Upsert per player |
| **Mapping (live)** | | |
| `elements[].id` | → | `player_id` |
| (gameweek) | → | `gameweek` |
| (from existing or fixtures) | → | `fixture_id`, `opponent_team_id`, `was_home`, `kickoff_time` |
| `elements[].stats.minutes` | → | `minutes`, `started` |
| `elements[].stats.total_points` | → | `total_points` |
| `elements[].stats.bonus` | → | `bonus`, `bonus_status` |
| `elements[].stats.bps` | → | `bps` |
| `elements[].stats.defensive_contribution` (or calculated) | → | `defensive_contribution` |
| (fixture) | → | `match_finished`, `match_finished_provisional` |
| + goals, assists, saves, etc. | → | same-named columns |

**Gap:** When all matches are finished and state becomes **IDLE**, we stop refreshing player_gameweek_stats. So `match_finished` / `match_finished_provisional` in the DB are never updated again from the API (fixtures *are* refreshed, but we don’t re-write player rows). Result: DB can still have `match_finished_provisional = true` even after gameweek `data_checked = true`. **Frontend fix:** DEFCON page uses `gameweeks.data_checked` to treat finished matches as final (green check) when `data_checked` is true, so UI is correct. Optional backend improvement: run a one-time full refresh of player_gameweek_stats for the current gameweek when transitioning to IDLE with `data_checked` true, so DB matches FPL final state.

---

## 6. Manager picks / transfers / history

| Source | API | DB |
|--------|-----|-----|
| **Endpoints** | `GET /entry/{id}/event/{gw}/picks/`, `.../transfers/`, `.../history/` | `manager_picks`, `manager_transfers`, `manager_gameweek_history` |
| **When** | TRANSFER_DEADLINE (after status change) for picks/transfers; LIVE_MATCHES/BONUS_PENDING/IDLE for manager points | Upsert per row |

**Status:** ✅ Correct. Picks/transfers refreshed post-deadline; manager points recalculated during/after live.

---

## 7. FPL Global (total managers)

| Source | API | DB |
|--------|-----|-----|
| **Endpoint** | `GET /bootstrap-static/` → `total_players` | `fpl_global` |
| **When** | Every refresh in `_refresh_gameweeks` | Upsert `id: 'current_season'`, `total_managers` |

**Status:** ✅ Correct.

---

## 8. Bug fix applied

- **get_gameweeks(id=...):** Orchestrator was calling `get_gameweeks(id=self.current_gameweek, limit=1)` but `get_gameweeks()` did not accept `id`. Fixed by adding `gameweek_id` (and `id` filter) to `get_gameweeks()` and updating orchestrator calls to `get_gameweeks(gameweek_id=self.current_gameweek, limit=1)`.

---

## 9. Summary

| Table | Refreshed in cycle? | Source | Notes |
|-------|---------------------|--------|-------|
| gameweeks | ✅ Yes | bootstrap events | |
| fixtures | ✅ Yes | get_fixtures | Current GW only |
| teams | ❌ No | bootstrap teams | Use populate script first |
| players | ❌ No | bootstrap elements | Use populate script first |
| player_gameweek_stats | ✅ When live/bonus only | live or element-summary + fixtures | Not refreshed in IDLE; frontend uses data_checked for final check marks |
| manager_picks / manager_transfers | ✅ Post-deadline | entry API | |
| manager_gameweek_history | ✅ When live/bonus | calculated + entry history | |
| fpl_global | ✅ Yes | bootstrap total_players | |

**Recommendations:**

1. **Initial setup:** Run `populate_test_data.py` (or equivalent) to seed `teams` and `players` before relying on `refresh_data.py`.
2. **Optional:** Add a bootstrap sync step (teams + players) to the refresh cycle when needed (e.g. once per day or when empty).
3. **Optional:** When gameweek becomes IDLE and `data_checked` is true, run a one-off refresh of `player_gameweek_stats` for that gameweek so DB `match_finished_provisional` matches FPL.
