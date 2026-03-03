#!/usr/bin/env python3
"""
Monitor FPL event-live update rate during a live match.

Polls /event/{gw}/live at a fixed interval and tracks when player minutes change.
Minutes tick every game minute, so observed change frequency approximates FPL's
live data update cadence. Use results to tune FAST_LOOP_INTERVAL_LIVE.

Usage:
    cd backend && python3 scripts/monitor_fpl_live_update_rate.py
    # Auto-detect gameweek, 5s poll, 20min max (defaults)

    python3 scripts/monitor_fpl_live_update_rate.py 32 5 15
    # GW32, 5s poll, 15min max

    python3 scripts/monitor_fpl_live_update_rate.py "" 3 10
    # Auto GW, 3s poll, 10min max (use 0 or "" for first arg to auto-detect)

Output: timeline/live_update_rate/ directory with JSON + summary including:
  - min/median/max seconds between observed minutes changes
  - recommended FAST_LOOP_INTERVAL_LIVE
"""

import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Any, Optional

import httpx

BASE_URL = "https://fantasy.premierleague.com/api"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept": "application/json",
}


async def fetch_json(client: httpx.AsyncClient, path: str) -> Optional[Dict]:
    """Fetch JSON from FPL API."""
    url = f"{BASE_URL}/{path}"
    try:
        r = await client.get(url, headers=HEADERS, timeout=15.0)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        print(f"  ❌ Fetch failed: {e}")
        return None


def get_current_gameweek(bootstrap: Dict) -> Optional[int]:
    """Return is_current gameweek id from bootstrap."""
    for e in bootstrap.get("events", []):
        if e.get("is_current"):
            return e.get("id")
    return None


def get_player_name(bootstrap: Dict, player_id: int) -> str:
    """Return player web_name from bootstrap."""
    for p in bootstrap.get("elements", []):
        if p.get("id") == player_id:
            return p.get("web_name", str(player_id))
    return str(player_id)


async def run_monitor(
    gameweek: Optional[int] = None,
    poll_interval_sec: int = 5,
    max_duration_minutes: Optional[int] = 20,
):
    """Run the live update rate monitor."""
    out_dir = Path(__file__).parent.parent / "timeline" / "live_update_rate"
    out_dir.mkdir(parents=True, exist_ok=True)

    # Per player: last minutes and timestamp of last change
    last_minutes: Dict[int, int] = {}
    last_change_time: Dict[int, datetime] = {}
    changes: List[Dict[str, Any]] = []
    poll_count = 0
    start_time = datetime.now(timezone.utc)
    bootstrap: Optional[Dict] = None

    print("🚀 FPL event-live update rate monitor")
    print(f"   Poll interval: {poll_interval_sec}s")
    print(f"   Max duration: {max_duration_minutes or 'unlimited'} minutes")
    print("   Press Ctrl+C to stop and save results.\n")

    async with httpx.AsyncClient(follow_redirects=True) as client:
        # Resolve gameweek if not provided
        if gameweek is None:
            print("📡 Fetching bootstrap to get current gameweek...")
            bootstrap = await fetch_json(client, "bootstrap-static/")
            if not bootstrap:
                print("❌ Could not fetch bootstrap")
                return
            gameweek = get_current_gameweek(bootstrap)
            if not gameweek:
                print("❌ No current gameweek (no live match?). Try passing gameweek manually.")
                return
            print(f"   Current gameweek: {gameweek}\n")
        else:
            # Still fetch bootstrap for player names
            bootstrap = await fetch_json(client, "bootstrap-static/")
            if not bootstrap:
                print("⚠️  Could not fetch bootstrap; player names will show as IDs")

        endpoint = f"event/{gameweek}/live"
        print(f"📡 Polling {BASE_URL}/{endpoint} every {poll_interval_sec}s\n")
        print("=" * 70)

        try:
            while True:
                poll_count += 1
                now = datetime.now(timezone.utc)

                # Check max duration
                if max_duration_minutes:
                    elapsed = (now - start_time).total_seconds()
                    if elapsed >= max_duration_minutes * 60:
                        print(f"\n⏱️  Reached max duration ({max_duration_minutes} min). Stopping.")
                        break

                data = await fetch_json(client, endpoint)
                if not data:
                    print(f"  Poll #{poll_count}: fetch failed, retrying...")
                    await asyncio.sleep(poll_interval_sec)
                    continue

                elements = data.get("elements", [])
                players_with_minutes = [
                    e for e in elements
                    if (e.get("stats") or {}).get("minutes", 0) > 0
                ]

                if not players_with_minutes and poll_count == 1:
                    print("⚠️  No players with minutes yet. Match may not have started. Keep polling...")

                for elem in players_with_minutes:
                    pid = elem.get("id")
                    stats = elem.get("stats") or {}
                    mins = int(stats.get("minutes", 0) or 0)
                    if pid is None:
                        continue

                    prev_mins = last_minutes.get(pid)
                    if prev_mins is not None and mins != prev_mins:
                        # Minutes changed
                        prev_time = last_change_time.get(pid)
                        sec_since = (
                            int((now - prev_time).total_seconds()) if prev_time else None
                        )
                        name = get_player_name(bootstrap, pid) if bootstrap else str(pid)
                        change = {
                            "timestamp_utc": now.isoformat(),
                            "poll_number": poll_count,
                            "player_id": pid,
                            "player_name": name,
                            "old_minutes": prev_mins,
                            "new_minutes": mins,
                            "seconds_since_previous_change": sec_since,
                        }
                        changes.append(change)
                        sec_str = f" (+{sec_since}s since last)" if sec_since is not None else ""
                        print(f"  [{now.strftime('%H:%M:%S')}] #{poll_count} {name} (id={pid}): {prev_mins}→{mins}{sec_str}")

                    last_minutes[pid] = mins
                    if prev_mins is not None and mins != prev_mins:
                        last_change_time[pid] = now
                    elif prev_mins is None:
                        last_change_time[pid] = now

                await asyncio.sleep(poll_interval_sec)

        except asyncio.CancelledError:
            pass
        except KeyboardInterrupt:
            print("\n\n⏹️  Stopped by user")

    # Compute stats
    intervals = [
        c["seconds_since_previous_change"]
        for c in changes
        if c.get("seconds_since_previous_change") is not None
    ]

    recommended = None
    if not intervals:
        print("\n⚠️  No minutes changes observed. Possible reasons:")
        print("   - Match hadn't started or just kicked off")
        print("   - Match finished (minutes don't change post-match)")
        print("   - Poll interval too long relative to FPL update rate")
        print("   - Try shorter poll_interval (e.g. 3) next time")
    else:
        intervals.sort()
        n = len(intervals)
        min_i = min(intervals)
        max_i = max(intervals)
        median_i = intervals[n // 2] if n else 0
        p95_i = intervals[int(n * 0.95)] if n > 1 else intervals[0]

        recommended = max(5, min(60, (median_i + p95_i) // 2))
        recommended = min(recommended, poll_interval_sec * 2)

        print("\n" + "=" * 70)
        print("RESULTS")
        print("=" * 70)
        print(f"  Total polls: {poll_count}")
        print(f"  Minutes changes observed: {len(changes)}")
        print(f"  Intervals between changes (seconds):")
        print(f"    Min:    {min_i}s")
        print(f"    Median: {median_i}s")
        print(f"    Max:    {max_i}s")
        print(f"    P95:    {p95_i}s")
        print(f"\n  💡 Recommended FAST_LOOP_INTERVAL_LIVE: {recommended}s")
        print(f"     (FPL appears to update every ~{median_i}s during live matches)")

    # Save output
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    gw_suffix = f"gw{gameweek}" if gameweek else "gw?"
    json_path = out_dir / f"live_update_rate_{gw_suffix}_{ts}.json"
    summary_path = out_dir / f"live_update_rate_{gw_suffix}_{ts}.txt"

    output = {
        "gameweek": gameweek,
        "poll_interval_sec": poll_interval_sec,
        "poll_count": poll_count,
        "changes_count": len(changes),
        "start_time_utc": start_time.isoformat(),
        "end_time_utc": datetime.now(timezone.utc).isoformat(),
        "intervals_seconds": {
            "min": min(intervals) if intervals else None,
            "median": median_i if intervals else None,
            "max": max(intervals) if intervals else None,
            "p95": p95_i if intervals else None,
        } if intervals else None,
        "recommended_fast_loop_interval_live": recommended if intervals else None,
        "changes": changes,
    }

    with open(json_path, "w") as f:
        json.dump(output, f, indent=2)

    with open(summary_path, "w") as f:
        f.write(f"FPL event-live update rate monitor – GW{gameweek}\n")
        f.write("=" * 60 + "\n\n")
        f.write(f"Poll interval: {poll_interval_sec}s\n")
        f.write(f"Polls: {poll_count}, Changes: {len(changes)}\n\n")
        if intervals:
            f.write(f"Intervals between minutes changes (seconds):\n")
            f.write(f"  Min: {min_i}, Median: {median_i}, Max: {max_i}, P95: {p95_i}\n\n")
            f.write(f"Recommended FAST_LOOP_INTERVAL_LIVE: {recommended}s\n")
        f.write("\nChanges:\n")
        for c in changes:
            f.write(f"  {c['timestamp_utc']} {c['player_name']} {c['old_minutes']}→{c['new_minutes']}")
            if c.get("seconds_since_previous_change") is not None:
                f.write(f" (+{c['seconds_since_previous_change']}s)")
            f.write("\n")

    print(f"\n💾 Saved: {json_path.name}")
    print(f"💾 Saved: {summary_path.name}")


def main():
    """Parse args and run."""
    gw = None
    poll = 5
    max_min = 20

    if len(sys.argv) > 1:
        try:
            val = int(sys.argv[1])
            gw = None if val == 0 else val
        except ValueError:
            print(f"Invalid gameweek: {sys.argv[1]} (use 0 to auto-detect)")
            sys.exit(1)
    if len(sys.argv) > 2:
        try:
            poll = int(sys.argv[2])
        except ValueError:
            print(f"Invalid poll interval: {sys.argv[2]}, using 5")
    if len(sys.argv) > 3:
        try:
            max_min = int(sys.argv[3])
        except ValueError:
            pass

    asyncio.run(run_monitor(gameweek=gw, poll_interval_sec=poll, max_duration_minutes=max_min))


if __name__ == "__main__":
    main()
