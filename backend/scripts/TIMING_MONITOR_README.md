# Gameweek Status Timing Monitor

## Purpose

Tracks how long it takes for FPL API to update various gameweek attributes, creating a reference timeline for understanding FPL API update patterns.

## What It Tracks

### Status Changes
- **Fixtures**: When all fixtures are marked `finished` and `finished_provisional`
- **Gameweek**: When `finished` and `data_checked` change to `True`
- **Average Score**: When `average_entry_score` changes

### Timing Metrics
- Duration from first check to each milestone
- Duration between milestones (e.g., fixtures finished → data_checked)
- Human-readable time differences

## Usage

```bash
# Basic: Check every 60 seconds, auto-stop when data_checked=True
python3 scripts/monitor_gw_status_timing.py

# Custom interval: Check every 30 seconds
python3 scripts/monitor_gw_status_timing.py 30

# With max checks limit
python3 scripts/monitor_gw_status_timing.py 60 200

# Different gameweek
python3 scripts/monitor_gw_status_timing.py 60 100 24
```

## Arguments

1. `interval_seconds` (default: 60) - Check interval
2. `max_checks` (default: None) - Maximum checks before stopping
3. `gameweek` (default: 23) - Gameweek to monitor

## Output

### Console Output
- Real-time status updates
- Change notifications
- Timing summary at the end

### Files Saved
All saved to `backend/timeline/gw{gameweek}/`:

1. **`timeline_{timestamp}.json`** - Complete timeline data (JSON)
2. **`summary_{timestamp}.txt`** - Human-readable summary

## Example Timeline Output

```
Reference Times:
First Check: 2026-01-27T01:00:00+00:00
All Fixtures Finished: 2026-01-27T02:00:00+00:00
All Fixtures Finished Provisional: 2026-01-27T02:00:00+00:00
Gameweek Finished: 2026-01-27T04:00:00+00:00
Data Checked True: 2026-01-27T05:30:00+00:00

Durations (from first check):
All Fixtures Finished: 1.0 hours (60.0 minutes)
Data Checked True: 4.5 hours (270.0 minutes)

Key Milestones:
✓ All fixtures marked finished
✓ All fixtures marked finished_provisional
✓ Gameweek marked finished
✓ Data checked = True
```

## Auto-Stop

The script automatically stops when:
- `data_checked` becomes `True`

This ensures you capture the complete timeline up to when FPL finalizes the gameweek data.

## Building a Reference Database

Run this script for multiple gameweeks to build a reference database of FPL API update patterns. The JSON timeline files can be aggregated to analyze:
- Average time for each milestone
- Variability in update timing
- Patterns across different gameweeks
