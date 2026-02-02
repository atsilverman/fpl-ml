# Update lag monitoring

The **Updates (debug)** bento on the home page shows when data was last updated, for both the **backend** (API → DB → MVs) and the **frontend** (React Query fetch from Supabase).

## What each column means

| Column | Meaning |
|--------|--------|
| **Backend last** | When the backend last **ran** a refresh cycle for that path (fast or slow). Source: `refresh_events.occurred_at`. Fast path is recorded in a `finally` block so it reflects every attempt even when the cycle fails. |
| **Since backend** | Time since that backend cycle ran. **This is the main “true lag” metric** — how long since the backend last did work for this path. |
| **Frontend last** | When the frontend last **successfully fetched** this data (React Query `dataUpdatedAt`). |
| **Since frontend** | Time since that frontend fetch. |

## Paths

- **Fast** — Backend fast loop: gameweeks, fixtures, GW players (when live). Runs every ~15–30s when live, or on the gameweeks interval when idle.
- **Slow** — Backend slow loop: manager points + MVs for live. Runs every `full_refresh_interval_live` (e.g. 60s) when in live/bonus state.

## How to interpret

- **Large “Since backend”** → Backend is the bottleneck (API, DB upserts, or MVs). The backend hasn’t completed a cycle for that path recently.
- **Large “Since frontend”** with **small “Since backend”** → Frontend hasn’t refetched yet; data is in the DB but the UI hasn’t requested it. Check refetch intervals or cache.
- **Both small** → Data is fresh end-to-end.

## Backend implementation

- Table: `refresh_events` (`path` = `'fast'` or `'slow'`, `occurred_at`).
- The orchestrator inserts a row in a `finally` block of `_fast_cycle()` (path `'fast'`) so every attempt is recorded even on failure, and after manager points + MVs in `_run_slow_loop()` (path `'slow'`).
- Migration: `backend/supabase/migrations/030_refresh_events.sql`.

## Frontend implementation

- `useRefreshEvents()` fetches latest `occurred_at` per path from `refresh_events`.
- `useUpdateTimestamps()` merges backend timestamps with React Query `dataUpdatedAt` per source and passes rows to the Updates (debug) bento.
