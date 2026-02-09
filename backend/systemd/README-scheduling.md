# Scheduling the LiveFPL predictions scraper (every 30 min)

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

## Linux (systemd)

Only on a machine that has systemd (e.g. a Linux server, not macOS):

```bash
sudo cp backend/systemd/fpl-livefpl-predictions.service backend/systemd/fpl-livefpl-predictions.timer /etc/systemd/system/
# Edit the service if your paths differ from /opt/fpl-refresh/backend
sudo systemctl daemon-reload
sudo systemctl enable --now fpl-livefpl-predictions.timer
```

Check: `systemctl list-timers fpl-livefpl-predictions.timer`

## Cron (any OS)

```cron
*/30 * * * * cd /path/to/fpl-new/backend && python3 scripts/refresh_livefpl_predictions.py >> /tmp/fpl-livefpl.log 2>&1
```

Replace `/path/to/fpl-new` with your repo path. Ensure the cron environment can see your `.env` (or set SUPABASE_URL and SUPABASE_SERVICE_KEY in the crontab).
