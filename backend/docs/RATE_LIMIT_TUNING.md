# Rate limit tuning and scaling

This document describes how to find safe FPL API request rates and tune production so refreshes stay fast as you add managers and leagues.

## Stress test

The rate-limit stress test runs configurable workloads (players via element-summary, managers via `_refresh_manager_points`) with different throttle and batching strategies. It records request count, 429 count, duration, and requests/min to a CSV and logs everything to a timestamped file.

### What it does

- **Players workload:** Calls the element-summary API for many player IDs (no live endpoint), so each request is one API call. Uses `element_summary_batch_size` per strategy.
- **Managers workload:** Runs the same manager points refresh as production (batched by `MANAGER_POINTS_BATCH_SIZE` and `MANAGER_POINTS_BATCH_SLEEP_SECONDS`).
- **Strategies:** A grid of conservative to aggressive settings (e.g. 30–120 req/min, batch sizes 10–40, sleep 0–0.5s). Each strategy is run multiple times (or for a sustained period) and metrics are recorded per run.

### How to run

From the `backend` directory:

```bash
# Players workload only, 3 runs per strategy (default)
python scripts/rate_limit_stress_test.py --workload players --runs-per-strategy 3

# Both workloads, 5 runs per strategy, custom log dir
python scripts/rate_limit_stress_test.py --workload both --log-dir logs --runs-per-strategy 5

# Managers only, sustained for 10 minutes (one aggregated row per strategy)
python scripts/rate_limit_stress_test.py --workload managers --sustained-minutes 10

# Specific gameweek and cap player count
python scripts/rate_limit_stress_test.py --workload players --gw 25 --max-players 300
```

### Where results go

- **Log file:** `{--log-dir}/stress_YYYYMMDD_HHMMSS.log` — full logs including every 429 and retry.
- **CSV:** `{--log-dir}/stress_test_results.csv` — one row per (strategy, workload, run) with `strategy_id`, `workload`, `run_id`, `duration_sec`, `total_requests`, `429_count`, `requests_per_minute`, `max_1min_rate` (when not using sustained mode).
- **Summary:** `{--log-dir}/stress_test_summary.txt` — per-strategy averages and a “recommended production” line (highest req/min with 0 429s).

### How to interpret results

1. **Log file:** Search for “Rate limited” or 429 to see when and at what rate limits occurred.
2. **CSV:** Sort by `requests_per_minute` descending; among rows with `429_count == 0`, the highest req/min strategy is the best candidate for production.
3. **Summary:** Use the “Recommended production” line as the starting point for `.env` and batch settings.

Run the script multiple times (e.g. 3–5 full sweeps) or use `--sustained-minutes` to test sustained load before locking in production values.

## Production recommendation (fill in after first runs)

After running the stress test, document your chosen values here and in `.env`:

- **MAX_REQUESTS_PER_MINUTE:** (e.g. 60)
- **MIN_REQUEST_INTERVAL:** (e.g. 0.5)
- **MANAGER_POINTS_BATCH_SIZE:** (e.g. 20)
- **MANAGER_POINTS_BATCH_SLEEP_SECONDS:** (e.g. 0.25)
- **DEADLINE_BATCH_SIZE** / **DEADLINE_BATCH_SLEEP_SECONDS:** if you tuned deadline batch separately

Re-run the stress test if FPL behavior changes (e.g. after a season or API update).

## Scaling formulas

Use the sustainable rate **R** (requests per minute) from the stress test to plan capacity.

### Deadline batch

- Each manager costs **2** API calls (picks + transfers).
- At **R** requests/min, **M** managers need **2×M** requests, i.e. **2×M / R** minutes.
- To finish within **T** minutes (e.g. 15), max managers: **M_max ≈ R × T / 2**.

Example: R = 60, T = 15 → M_max ≈ 450 managers.

### Live cycle

- Each active manager costs **1** request per full refresh (manager gameweek history).
- The full refresh (manager points + MVs) should complete within `full_refresh_interval_live` (e.g. 60s).
- So effective max active managers per cycle is roughly **R** (with headroom for gameweeks/fixtures/players).
- Use the stress-test R and your target interval to set batch size and sleep so one cycle fits in the interval.

These formulas assume the same rate R for both deadline and live; if you observe different limits for different endpoints, tune separately and use the tighter limit for planning.
