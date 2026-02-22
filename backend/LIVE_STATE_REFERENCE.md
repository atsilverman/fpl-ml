# Live State and Critical Gates

This document is the single reference for how the app determines live vs non-live gameplay, which API fields we rely on, and the gates for deadline batch, baselines, whitelist, and rank finality. Use it to avoid missing critical transitions or mis-powering the UI.

---

## Data Sources and Persistence

### Gameweek (bootstrap-static → `events`)

Gameweek truth for "current" and "data final" comes from bootstrap-static; we persist to `gameweeks`. **We never write `fpl_ranks_updated` from the API** — we set it only when we detect FPL rank finality (see Rank finality below).

| Field | Source | Persisted | Used for |
|-------|--------|-----------|----------|
| `id`, `name`, `deadline_time`, `release_time` | bootstrap | Yes | Deadline batch, release wait, first-kickoff logging |
| `is_current`, `is_next`, `is_previous` | bootstrap | Yes | State (OUTSIDE_GAMEWEEK), deadline-batch trigger (is_next → is_current), frontend useRefreshState |
| `finished` | bootstrap | Yes | Past GW handling; migration sets `fpl_ranks_updated=true` where `finished=true` |
| `data_checked` | bootstrap | Yes | When true → set `fpl_ranks_updated`, refresh all managers; frontend debug + useGameweekData |
| `fpl_ranks_updated` | **Not in API** | Yes (we set it) | Set when we detect ranks final (data_checked or rank-change poll); frontend rank "stale" indicator |

### Fixtures (GET /fixtures/ + event-live augmentation)

Fixtures are the **single source** for "match live" and "match ended (provisional vs final)". Event-live is used for: (1) player stats and manager GW points in the fast path, (2) augmenting fixture `minutes` (and scores only when API has them). We do **not** use event-live to define `started` / `finished` / `finished_provisional`.

| Field | Source | Persisted | Used for |
|-------|--------|-----------|----------|
| `started`, `finished`, `finished_provisional` | /fixtures/ | Yes | State: LIVE_MATCHES = started or (now >= kickoff_time) && !finished_provisional; BONUS_PENDING = all finished_provisional && !finished; baseline gate |
| `minutes` | /fixtures/ primary; event-live can augment (max) | Yes | Clock display; player refresh gating |
| `kickoff_time` | /fixtures/ | Yes | **Live at kickoff:** we enter LIVE when now >= kickoff_time (exact minute), not when FPL flips started. Also: kickoff window, "last match of day" rank monitor, idle sleep cap. |
| `team_h`, `team_a`, scores | /fixtures/; scores from API only (event-live used only to augment minutes) | Yes | DGW-safe scoreline; manager live-data path |

**Live detection uses current and next gameweek fixtures.** We load fixtures for both `is_current` and `is_next` so that when the first match of the *next* gameweek kicks off (by time), we enter LIVE even before FPL has set that gameweek as `is_current`. When the in-progress fixture is in the next GW, we set `current_gameweek` to that GW for the rest of the cycle (event-live, player refresh).

**Hooks:** `_is_in_kickoff_window`, `_is_likely_live_window`, `get_next_kickoff_for_gameweek`, `get_first_kickoff_for_gameweek` — used to shorten idle sleep and enter live quickly. Idle sleep also considers next gameweek’s first kickoff so we use the short interval when the next GW’s match has started.

---

## State Definitions

- **Live** = at least one fixture (current or **next** gameweek) is in progress: `started === true` **or** `now >= kickoff_time`, and `finished_provisional === false`. We use `kickoff_time` so we enter LIVE at the exact minute kickoff happens; we consider next-GW fixtures so we go live when the first match of the new GW kicks off even before FPL sets `is_current`.
- **Bonus pending** = all fixtures (current GW only) have `finished_provisional === true` and `finished === false` (match(es) ended, FPL not yet confirmed).
- **Final** = fixture `finished === true` (FPL confirmed).

Backend (`_detect_state`) and frontend (`useRefreshState`) use the same order: price_window → live_matches → bonus_pending → transfer_deadline → idle.

---

## Critical Gates

1. **Deadline batch**  
   Run only when the target gameweek is `is_current` **and** no fixture for that gameweek has `started === true`. Running before FPL has flipped → wrong GW or missing picks. Running after any fixture started → risk of overwriting live points with 0.

2. **Baselines**  
   Capture only when deadline has passed **and** no fixture for the gameweek has `started === true` (and idempotent: skip if baselines already exist). Capturing after started → wrong delta baseline.

3. **Whitelist**  
   Build once per league at deadline batch, **after** picks/transfers for the same gameweek in the same batch. Wrong GW or stale picks → wrong whitelist.

4. **fpl_ranks_updated**  
   Set **only** when we detect rank finality: either `gameweeks.data_checked === true` or our rank-change poll sees updated overall_rank/gameweek_rank. Never set from bootstrap; never overwrite from API.

5. **Refuse seed / overwrite**  
   Do not run deadline batch (or seed) for a gameweek if any fixture for that GW has `started === true`.

---

## Config and Cadence

- **KICKOFF_WINDOW_MINUTES**: When now is within this many minutes of any fixture kickoff (current or next GW), use the shorter fast-loop interval so we discover live quickly.
- Fast/slow loop intervals: see `backend/src/config.py`. Kickoff window and next-GW first kickoff drive shorter sleep so we enter LIVE_MATCHES at or right after first kickoff.
- Idle sleep considers next gameweek’s first kickoff: when current GW has no future kickoff, we check if the next GW’s first match has kicked off and if so use the short interval so we detect live on the next cycle.

---

## Related Code

- State detection: `backend/src/refresh/orchestrator.py` — `_detect_state`, `_detect_gameweek_status_change`
- Baseline gate: `backend/src/refresh/baseline_capture.py` — `should_capture_baselines`, `capture_manager_baselines`
- Whitelist: `backend/src/refresh/managers.py` — `build_player_whitelist`; orchestrator calls it after picks/transfers in deadline batch
- Rank finality: `backend/src/refresh/orchestrator.py` — `_check_ranks_final_and_refresh`, `_check_fpl_rank_change_and_refresh`
- Frontend state: `frontend/src/hooks/useRefreshState.js`, `frontend/src/hooks/useLiveGameweekStatus.js`
