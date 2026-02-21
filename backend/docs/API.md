# Backend API (Stats + Fixtures from MVs)

When the frontend has `VITE_API_BASE_URL` set (e.g. `http://localhost:8000` or your droplet URL), the **Statistics** and **Matches** pages load from a single backend response instead of multiple client→Supabase round-trips. This reduces latency on slow connections (e.g. mobile/cell).

## Run the API

From the repo root:

```bash
cd backend
pip install -r requirements.txt
# Ensure .env has SUPABASE_URL and SUPABASE_SERVICE_KEY (or SUPABASE_KEY)
python scripts/run_api.py
```

Or with port override:

```bash
API_PORT=8001 python scripts/run_api.py
```

- **Stats**: `GET /api/v1/stats?gw_filter=all|last6|last12&location=all|home|away` — reads from research MVs + players, returns one JSON.
- **Fixtures**: `GET /api/v1/fixtures?gameweek=N` — reads from `mv_master_player_fixture_stats` (or falls back to fixtures+teams), returns fixtures with team names and `playerStatsByFixture` for expand details.

## Requirements

- Migrations applied (including `063_mv_master_player_fixture_stats.sql`).
- `refresh_all_materialized_views()` run periodically (e.g. by the refresh service) so the master MV and research MVs are up to date.

## Frontend

Set in `.env` (or Vercel env):

```
VITE_API_BASE_URL=https://your-api-host.com
```

Leave unset to keep using direct Supabase from the client.
