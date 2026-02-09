# Player current price and overall ownership – audit and refresh strategy

## What the UI needs

- **Current price**: Shown in the player detail modal. Source: `player_prices` for the selected gameweek (then latest row), then fallback `players.cost_tenths`.
- **Overall ownership**: Shown as "Ownership (Overall)" in the player detail modal. This is **team selected by** from FPL (percentage of teams that have the player). Source: `players.selected_by_percent` from FPL bootstrap-static `elements[].selected_by_percent`.

Both are **API data** from bootstrap-static and are kept in sync together.

## How we keep these populated

### Single source: bootstrap-static

- **`sync_players_ownership_from_bootstrap(bootstrap)`** runs on every fast refresh cycle whenever `bootstrap` is available (no `current_gameweek` required). It:
  - Upserts every player from `bootstrap.elements` into `players`.
  - Sets **`selected_by_percent`** from `elements[].selected_by_percent` (overall ownership).
  - Sets **`cost_tenths`** from `elements[].now_cost` (current price in tenths).

So both overall ownership and current price are maintained from the same API data on every cycle. When FPL updates prices or ownership, the next refresh cycle updates the DB.

### player_prices table (optional, for gameweek-specific price history)

- **`sync_player_prices_from_bootstrap(bootstrap, gameweek)`** runs when we also have `current_gameweek`. It upserts one row per player in `player_prices` for that gameweek and updates `players.cost_tenths` again (redundant with the sync above but keeps `player_prices` populated for charts/history).

### Backfill (one-time)

If existing DBs have missing price/ownership (e.g. B. Fernandes, Semenyo), run once:

```bash
cd backend && python scripts/backfill_player_price_and_ownership.py
```

This fetches bootstrap-static and runs the same sync, then optionally fills `player_prices` for the current gameweek if it exists in the DB.

## Will this be maintained when player price data changes?

Yes. The orchestrator runs the fast cycle on an interval. Each fast cycle:

1. Fetches bootstrap (gameweeks, elements, etc.).
2. Calls **`sync_players_ownership_from_bootstrap(bootstrap)`** so every player gets the latest `selected_by_percent` and `cost_tenths` from the API.
3. If `current_gameweek` is set, calls **`sync_player_prices_from_bootstrap(bootstrap, current_gameweek)`** so `player_prices` and `players.cost_tenths` stay in sync for the current GW.

So when FPL changes a player’s price or ownership, the next refresh cycle updates our DB.

## Frontend

- **`usePlayerDetail`** fetches `players` with `selected_by_percent` and `cost_tenths`, and resolves current price: `player_prices` for gameweek → latest `player_prices` → `players.cost_tenths`.

## If data is still missing

- Run the backfill script once.
- Ensure the refresh orchestrator is running (fast cycle) so future changes are maintained.
- If a specific player is still null, check that FPL bootstrap-static includes `now_cost` / `selected_by_percent` for that element (they should for all active players).
