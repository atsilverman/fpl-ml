# Per-Matchday Rank Baseline – Plan (Implemented)

## Summary

- **Table:** `manager_gameweek_matchday_baselines` (migration 065) – one row per (manager_id, gameweek, matchday_sequence) with overall_rank_baseline, gameweek_rank_baseline, matchday_date, first_kickoff_at, captured_at.
- **Matchday:** Distinct UTC date with at least one fixture; sequence 1, 2, … by first kickoff in the GW.
- **Capture:** Before first kickoff of each matchday (config: `matchday_baseline_minutes_before` / `matchday_baseline_minutes_stop_before`). GW start run also writes matchday_sequence=1.
- **Orchestrator:** Slow loop calls `get_next_matchday_for_capture` and `capture_matchday_baselines` when not in live.
- **Frontend (Phase 3):** Fetch current matchday baseline and show stale when rank equals that baseline (optional follow-up).

See migration `065_manager_gameweek_matchday_baselines.sql`, `baseline_capture.py`, `supabase_client.py`, and orchestrator slow loop.
