# Server logs and debugging

Where to find logs and how to interpret them so you can see why the post-deadline refresh did or didn’t work.

---

## Where logs go (SSH / server)

The refresh service logs to **stdout** only by default (`backend/src/utils/logger.py` → `StreamHandler(sys.stdout)`). There is no log file unless you add one.

So “SSH logs” are whatever is capturing that process’s stdout:

| How the service runs | Where to look |
|----------------------|----------------|
| **systemd** (e.g. `fpl-refresh.service`) | `journalctl -u fpl-refresh -f` or `journalctl -u fpl-refresh --since "2026-02-21"` |
| **Docker** | `docker logs <container>` or your host’s Docker log driver (e.g. json-file, journald) |
| **PM2 / screen / nohup** | Whatever file or terminal you redirected stdout to (e.g. `nohup python main.py > refresh.log 2>&1` → `refresh.log`) |
| **Manual in terminal** | That terminal’s scrollback (lost when you close the session unless you use `script` or a log file) |

So you are **not** past the point of knowing what happened **if** you still have that stdout (e.g. journald keeps it for a while, or you had a file redirect). If the process was never run under something that captures stdout, or logs were rotated away, then you can’t see the old run; from now on you can add a file log (see below).

---

## Making logs persist (optional)

To also write logs to a file so you can inspect them later (e.g. over SSH):

1. In `backend/src/main.py`, change the `main()` call to pass a log file into `setup_logging`:

   ```python
   # In main(), after setup_logging() is called with no args, you could do:
   from pathlib import Path
   from utils.logger import setup_logging
   log_dir = Path(__file__).resolve().parent.parent / "logs"
   setup_logging(log_file=log_dir / "refresh.log")
   ```

   Or add an env var, e.g. `LOG_FILE=/var/log/fpl-refresh/refresh.log`, and pass that into `setup_logging(log_file=os.getenv("LOG_FILE"))`.

2. Ensure the directory exists and the process can write to it (e.g. create `/var/log/fpl-refresh` and set permissions).

Then you can inspect past runs with e.g. `grep -E "Deadline batch|Bootstrap check|failure_reason" /var/log/fpl-refresh/refresh.log`.

---

## What to search for (deadline batch)

These messages tell you whether the post-deadline refresh ran and why it might have failed.

| Log message / DB | Meaning |
|------------------|--------|
| `Post-deadline refresh: running for GW that just passed (all configured managers and leagues) after API release check` | Batch started for this gameweek; manager_count / league_count show scope. |
| `Bootstrap check failed, retrying once in 30s` | FPL API unreachable on first try; we retry once. |
| `Bootstrap check failed again, skipping batch this cycle` | API still down after retry; batch skipped this cycle (will retry next cycle or on mismatch recovery). |
| `Deadline batch completed` | Batch finished successfully for that gameweek. |
| `Deadline batch failed (success rate < 80%)` | Too many manager picks/transfers calls failed (check for `Manager picks/transfers failed` with `manager_id` and `error`). |
| `No managers for deadline refresh` | No rows in `mini_league_managers`; add leagues/managers or use `REQUIRED_MANAGER_IDS`. |
| `Deadline batch mismatch: current GW has no successful batch, entering TRANSFER_DEADLINE to refresh` | Mismatch recovery: we’re re-running the batch for the current gameweek because there’s no successful run in DB. |

In the database, `deadline_batch_runs` stores each run and `phase_breakdown->failure_reason` (e.g. `bootstrap_failed`, `success_rate_below_80`, `no_managers`). The Debug panel reads this so you can see the last failure reason even if you don’t have server logs.

---

## Can we still know why it didn’t work?

- **If you have stdout from the run** (journald, Docker logs, or a file you redirected to): search for the messages above; you can see whether the batch ran, and if it failed, whether it was bootstrap, success rate, or no managers.
- **If you don’t have those logs**: you can’t see the exact error from that run. You still have:
  - **DB:** `deadline_batch_runs` (and the Debug panel) for last run’s `success` and `failure_reason`.
  - **From now on:** enable a log file (or ensure systemd/Docker keeps logs) so the next time you get a failure you can correlate it with SSH/server logs.

So you’re only “past the point” of knowing for runs whose stdout was never captured; going forward, use the table + optional file logging (or journalctl/Docker) to confirm what happened end-to-end.

---

## Post-deadline catch-up (player list + league tables empty)

If you have leagues and managers set up but **no player list for a manager** (e.g. 344182) and **no league tables** for the current gameweek, the post-deadline batch didn't run or didn't complete. Run it once manually:

1. **From backend directory:** `cd backend && python scripts/run_deadline_batch_test.py --gameweek 27` (use current GW). The script refreshes picks/transfers for all tracked managers (and any in `REQUIRED_MANAGER_IDS` / `VITE_MANAGER_ID`), seeds history, baselines, whitelist, and refreshes materialized views (standings).
2. **Include a specific manager if not in a league:** In `.env` set `REQUIRED_MANAGER_IDS=344182` or `VITE_MANAGER_ID=344182`, then run the command above.
3. **Avoid the service re-running:** Add `--record-success` so the run is written to `deadline_batch_runs`: `python scripts/run_deadline_batch_test.py --gameweek 27 --record-success`
4. **If fixtures for that GW have already started:** The script will refuse (would overwrite live points). Use the backfill script for history instead.
