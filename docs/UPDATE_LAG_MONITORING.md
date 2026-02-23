# Update lag monitoring

The **Updates (debug)** section in the Debug modal shows when data was last updated, for both the **backend** (orchestrator phases → DB → MVs) and the **frontend** (React Query fetch from Supabase). It helps identify slow or weak phases of the orchestrator.

## What each column means

| Column | Meaning |
|--------|--------|
| **Path** | Fast or Slow — which loop last ran this phase. |
| **Source** | Phase name: Gameweeks, Fixtures, GW Players, Live standings, Manager points, **MVs (UI reads these)**. |
| **Since backend** | Time since that phase last completed. From `refresh_duration_log.occurred_at` when available; otherwise from `refresh_events` per path. **MVs row** = "Since MV" (when materialized views were last refreshed). |
| **Duration** | Last run duration in seconds for that phase (from `refresh_duration_log.duration_ms`). Use this to spot slow phases. |
| **Since frontend** | Time since the frontend last successfully fetched the related data (React Query `dataUpdatedAt`). |

When phase data is available, the table shows **per-phase** rows (gameweeks, fixtures, gw_players, live_standings, manager_points, mvs) so you can see which component is lagging. Otherwise it falls back to path-level only (Fast/Slow).

## Paths

- **Fast** — Backend fast loop: gameweeks, fixtures, GW players (when live), live standings + MVs (when live). Runs every ~10s when live, or on the gameweeks interval when idle.
- **Slow** — Backend slow loop: manager points + MVs. Runs every `full_refresh_interval_live` (e.g. 60s) when in live/bonus state.

## How to interpret

- **Large "Since backend"** for a phase → That phase is the bottleneck (API, DB, or MV refresh).
- **Large "Duration"** for a phase → That phase is slow; optimize or add logging.
- **MVs row** → When the data the UI actually reads from MVs (standings, GW points, etc.) was last refreshed. If "Since backend" for MVs is large, the UI is stale until the next MV refresh.
- **Large "Since frontend"** with **small "Since backend"** → Frontend hasn't refetched yet; data is in the DB but the UI hasn't requested it.
- **Both small** → Data is fresh end-to-end.

## Backend implementation

- **refresh_events** (`path` = `'fast'` or `'slow'`, `occurred_at`): orchestrator writes at **start** of fast cycle (heartbeat) and at **end**; writes once per slow cycle after manager points + MVs.
- **refresh_duration_log** (source, path, state, duration_ms, occurred_at): each phase logs when it **completes**. Sources: gameweeks, fixtures, gw_players, live_standings, manager_points, mvs. MVs are logged in both fast loop (during live) and slow loop.
- Migrations: `030_refresh_events.sql`, `052_refresh_duration_log.sql`, `055_refresh_duration_log_live_standings.sql`, `067_allow_anon_read_refresh_duration_log.sql`.

## Frontend implementation

- `useRefreshEvents(options)` — fetches latest `occurred_at` per path from `refresh_events`. When Debug modal is open, pass `{ refetchInterval: 5000 }` for tighter polling.
- `useRefreshPhaseTimestamps(options)` — fetches latest row per source from `refresh_duration_log` for per-phase "Since backend" and Duration. Polls every 10s normally, 5s when Debug open.
- `useUpdateTimestamps({ isDebugOpen })` — when `isDebugOpen` is true, uses shorter refetch intervals and merges phase data into the table; adds MVs row and Duration column.
- Debug modal passes `isDebugOpen: isOpen` so the Updates section shows phase-level data and refreshes every 5s while open.

## Duration and snapshot logging (plotting)

To analyse refresh lag over time:

1. **Backend** logs each phase duration to `refresh_duration_log` (source, path, state, duration_ms).
2. **Frontend** logs periodic snapshots to `refresh_snapshot_log` when the Debug modal is open (every 15s): per source, `since_backend_sec` and `since_frontend_sec`.
3. **Export**: `python3 backend/scripts/export_refresh_log.py -o refresh_log.json`
4. **View**: Open `refresh_log_viewer.html` in a browser, click "Load JSON", select the exported file.

**Logged data:**
- **Backend duration** (`refresh_duration_log`): How long each phase took (gameweeks, fixtures, gw_players, live_standings, manager_points, mvs) — every run.
- **Frontend duration** (`refresh_frontend_duration_log`): How long each Supabase fetch took per source — every successful fetch.
- **Snapshot** (`refresh_snapshot_log`): Staleness (since backend/frontend) — only when Debug modal is open, every 15s.

Migrations: `052_refresh_duration_log.sql`, `053_refresh_frontend_duration_log.sql`.
