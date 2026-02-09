# Scheduling the LiveFPL predictions scraper (every 30 min)

**Production (Linux):** Use the **systemd timer** so the scraper runs every 30 minutes as a **self-sufficient job**. It does not depend on the main FPL refresh service; it runs independently and writes directly to Supabase.

---

## Production: self-sufficient scraper (systemd timer)

On your production server (e.g. Digital Ocean droplet):

1. **Copy the units** (after deploying code so the script exists on the server):

   ```bash
   sudo cp /opt/fpl-refresh/backend/systemd/fpl-livefpl-predictions.service \
           /opt/fpl-refresh/backend/systemd/fpl-livefpl-predictions.timer \
           /etc/systemd/system/
   ```

   If your app is not under `/opt/fpl-refresh`, edit the **service** file and set:
   - `WorkingDirectory` = your backend directory (e.g. `/opt/fpl-refresh/backend`)
   - `EnvironmentFile` = path to your `.env` (e.g. `/opt/fpl-refresh/.env`)
   - `ExecStart` = full path to your venv Python and script (e.g. `/opt/fpl-refresh/venv/bin/python3 /opt/fpl-refresh/backend/scripts/refresh_livefpl_predictions.py`)

2. **Ensure `.env` has** `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` (or `SUPABASE_KEY`). The script uses these to insert into `price_change_predictions`.

3. **Reload and enable the timer**:

   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now fpl-livefpl-predictions.timer
   ```

4. **Verify** the timer is active and next run time:

   ```bash
   systemctl list-timers fpl-livefpl-predictions.timer
   ```

5. **Logs** (journal):

   ```bash
   journalctl -u fpl-livefpl-predictions.service -f
   ```

   Or last run: `journalctl -u fpl-livefpl-predictions.service -n 50`

The timer runs at **:00 and :30 past every hour**; first run is **2 minutes after boot**. No other service is required.

---

## macOS (launchd)

1. Copy the plist and fix the path:

   ```bash
   mkdir -p ~/Library/LaunchAgents
   cp backend/systemd/com.fpl.livefpl-predictions.plist ~/Library/LaunchAgents/
   # Edit and set REPO_ROOT to your repo path, e.g. /Users/silverman/Desktop/fpl-new
   sed -i '' 's|REPO_ROOT|/Users/silverman/Desktop/fpl-new|g' ~/Library/LaunchAgents/com.fpl.livefpl-predictions.plist
   ```

2. Load and start:

   ```bash
   launchctl load ~/Library/LaunchAgents/com.fpl.livefpl-predictions.plist
   ```

3. To stop: `launchctl unload ~/Library/LaunchAgents/com.fpl.livefpl-predictions.plist`

4. Logs: `/tmp/fpl-livefpl-predictions.log` and `/tmp/fpl-livefpl-predictions.err.log`

## Linux (systemd) — quick reference

From the repo root on the server (or use the Production section above for full steps):

```bash
sudo cp backend/systemd/fpl-livefpl-predictions.service backend/systemd/fpl-livefpl-predictions.timer /etc/systemd/system/
# Edit the service if your paths differ from /opt/fpl-refresh
sudo systemctl daemon-reload
sudo systemctl enable --now fpl-livefpl-predictions.timer
```

Check: `systemctl list-timers fpl-livefpl-predictions.timer`

## Cron (any OS)

```cron
*/30 * * * * cd /path/to/fpl-new/backend && python3 scripts/refresh_livefpl_predictions.py >> /tmp/fpl-livefpl.log 2>&1
```

Replace `/path/to/fpl-new` with your repo path. Ensure the cron environment can see your `.env` (or set SUPABASE_URL and SUPABASE_SERVICE_KEY in the crontab).
