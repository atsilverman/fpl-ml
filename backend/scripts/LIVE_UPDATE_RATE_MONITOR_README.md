# FPL Live Update Rate Monitor

## Purpose

Measures how frequently the FPL API updates `event-live` data during a live match by tracking **minutes played** changes. Minutes tick every game minute, so the observed update cadence approximates FPL's refresh rate. Use the results to tune `FAST_LOOP_INTERVAL_LIVE` for production.

## Usage

**During a live match** (Premier League games typically Sat–Mon):

```bash
cd backend

# Auto-detect current gameweek, 5s poll, 20min max
python3 scripts/monitor_fpl_live_update_rate.py

# Specific gameweek, 5s poll, 15min max
python3 scripts/monitor_fpl_live_update_rate.py 32 5 15

# Auto-detect GW (0), 3s poll for tighter data, 10min
python3 scripts/monitor_fpl_live_update_rate.py 0 3 10
```

**Arguments** (all optional):

1. `gameweek` – FPL gameweek ID. Use `0` to auto-detect from bootstrap. Default: auto.
2. `poll_interval_seconds` – Seconds between API polls. Default: 5. Use 3 for tighter measurement.
3. `max_duration_minutes` – Stop after N minutes. Default: 20.

**Stop early**: Press `Ctrl+C` to save results and exit.

## Output

- **Console**: Each minutes change (e.g. `Salah 44→45 +62s`) and a summary.
- **Files** in `backend/timeline/live_update_rate/`:
  - `live_update_rate_gw32_YYYYMMDD_HHMMSS.json` – Full timeline.
  - `live_update_rate_gw32_YYYYMMDD_HHMMSS.txt` – Human-readable summary.

## Interpreting Results

- **Median interval** – Typical time between FPL minutes updates.
- **P95 interval** – Most updates happen within this window.
- **Recommended FAST_LOOP_INTERVAL_LIVE** – Suggested backend poll interval.

**Example**: If median ≈ 60s and P95 ≈ 90s, a 10–15s backend loop is sufficient. If median ≈ 15s, consider 5–8s.

## Notes

- Run during an **in-progress** match (after kickoff, before full-time).
- If no changes are observed: match may not have started, or may have finished.
- Polling every 3–5s stays within FPL's unofficial rate limits (~30 req/min).
