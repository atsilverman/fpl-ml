#!/usr/bin/env python3
"""
Monitor gameweek status changes and track timing of FPL API attribute updates.

Tracks how long it takes for various attributes to update:
- Fixtures: finished, finished_provisional
- Gameweek: finished, data_checked
- Average entry score changes

Creates a reference timeline of FPL API update patterns.
"""

import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, Optional, List
import httpx
import time


class GameweekStatusTimingMonitor:
    """Monitor gameweek status changes and track timing."""
    
    def __init__(self, gameweek: int = 23, check_interval: int = 60):
        self.gameweek = gameweek
        self.check_interval = check_interval
        self.base_url = "https://fantasy.premierleague.com/api"
        self.timeline_dir = Path(__file__).parent.parent / "timeline" / f"gw{gameweek}"
        self.timeline_dir.mkdir(parents=True, exist_ok=True)
        
        # Get local timezone
        self.local_tz = datetime.now().astimezone().tzinfo
        
        # Track initial state and timing
        self.initial_state = None
        self.timeline: List[Dict[str, Any]] = []
        self.last_status = None
        self.run_count = 0
        
        # Reference times (when we first detect changes)
        self.reference_times = {
            "first_check": None,
            "all_fixtures_finished": None,
            "all_fixtures_finished_provisional": None,
            "gameweek_finished": None,
            "data_checked_true": None,
            "average_score_first_change": None,
        }
        
    async def fetch_endpoint(self, endpoint: str) -> Dict[str, Any]:
        """Fetch data from FPL API endpoint."""
        url = f"{self.base_url}/{endpoint}"
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            "Accept": "application/json",
        }
        
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            response = await client.get(url, headers=headers)
            response.raise_for_status()
            
            # Log relevant headers for debugging
            relevant_headers = {
                "last-modified": response.headers.get("Last-Modified"),
                "etag": response.headers.get("ETag"),
                "cache-control": response.headers.get("Cache-Control"),
                "date": response.headers.get("Date"),
            }
            if any(relevant_headers.values()):
                print(f"\n📋 Response Headers for {endpoint}:")
                for key, value in relevant_headers.items():
                    if value:
                        print(f"  {key}: {value}")
            
            return response.json()
    
    def get_gameweek_status(self, bootstrap: Dict[str, Any]) -> Dict[str, Any]:
        """Extract gameweek status from bootstrap data."""
        events = bootstrap.get("events", [])
        gw = next((e for e in events if e.get("id") == self.gameweek), None)
        
        if not gw:
            return None
        
        return {
            "id": gw.get("id"),
            "name": gw.get("name"),
            "finished": gw.get("finished"),
            "data_checked": gw.get("data_checked"),
            "is_current": gw.get("is_current"),
            "is_previous": gw.get("is_previous"),
            "is_next": gw.get("is_next"),
            "average_entry_score": gw.get("average_entry_score"),
            "highest_score": gw.get("highest_score"),
            "deadline_time": gw.get("deadline_time"),
        }
    
    def get_fixtures_status(self, fixtures: list) -> Dict[str, Any]:
        """Get fixtures status summary."""
        gw_fixtures = [f for f in fixtures if f.get("event") == self.gameweek]
        
        if not gw_fixtures:
            return {"total": 0}
        
        finished_count = sum(1 for f in gw_fixtures if f.get("finished", False))
        finished_provisional_count = sum(1 for f in gw_fixtures if f.get("finished_provisional", False))
        started_count = sum(1 for f in gw_fixtures if f.get("started", False))
        
        return {
            "total": len(gw_fixtures),
            "started": started_count,
            "finished": finished_count,
            "finished_provisional": finished_provisional_count,
            "all_started": started_count == len(gw_fixtures),
            "all_finished": finished_count == len(gw_fixtures),
            "all_finished_provisional": finished_provisional_count == len(gw_fixtures),
        }
    
    def detect_changes(self, current_status: Dict[str, Any], current_fixtures: Dict[str, Any]) -> Dict[str, Any]:
        """Detect changes and record timing."""
        changes = {}
        now = datetime.now(timezone.utc)
        
        if self.last_status is None:
            # First check - record initial state
            self.initial_state = {
                "gameweek": current_status.copy() if current_status else {},
                "fixtures": current_fixtures.copy(),
                "timestamp": now.isoformat()
            }
            self.reference_times["first_check"] = now
            return changes
        
        # Check gameweek status changes
        if current_status:
            last_gw = self.last_status.get("gameweek", {})
            
            # Check finished
            if last_gw.get("finished") != current_status.get("finished"):
                changes["gameweek_finished"] = {
                    "old": last_gw.get("finished"),
                    "new": current_status.get("finished"),
                    "timestamp": now.isoformat()
                }
                if current_status.get("finished") is True and not self.reference_times["gameweek_finished"]:
                    self.reference_times["gameweek_finished"] = now
            
            # Check data_checked
            if last_gw.get("data_checked") != current_status.get("data_checked"):
                changes["data_checked"] = {
                    "old": last_gw.get("data_checked"),
                    "new": current_status.get("data_checked"),
                    "timestamp": now.isoformat()
                }
                if current_status.get("data_checked") is True and not self.reference_times["data_checked_true"]:
                    self.reference_times["data_checked_true"] = now
            
            # Check average_entry_score
            if last_gw.get("average_entry_score") != current_status.get("average_entry_score"):
                changes["average_entry_score"] = {
                    "old": last_gw.get("average_entry_score"),
                    "new": current_status.get("average_entry_score"),
                    "timestamp": now.isoformat()
                }
                if not self.reference_times["average_score_first_change"]:
                    self.reference_times["average_score_first_change"] = now
        
        # Check fixtures status changes
        last_fixtures = self.last_status.get("fixtures", {})
        
        # All fixtures finished
        if (not last_fixtures.get("all_finished") and 
            current_fixtures.get("all_finished") and
            not self.reference_times["all_fixtures_finished"]):
            self.reference_times["all_fixtures_finished"] = now
            changes["all_fixtures_finished"] = {
                "timestamp": now.isoformat(),
                "count": current_fixtures.get("finished", 0),
                "total": current_fixtures.get("total", 0)
            }
        
        # All fixtures finished_provisional
        if (not last_fixtures.get("all_finished_provisional") and 
            current_fixtures.get("all_finished_provisional") and
            not self.reference_times["all_fixtures_finished_provisional"]):
            self.reference_times["all_fixtures_finished_provisional"] = now
            changes["all_fixtures_finished_provisional"] = {
                "timestamp": now.isoformat(),
                "count": current_fixtures.get("finished_provisional", 0),
                "total": current_fixtures.get("total", 0)
            }
        
        return changes
    
    def format_time(self, dt: datetime) -> str:
        """Format datetime in local timezone for display."""
        if dt:
            local_dt = dt.astimezone(self.local_tz)
            return local_dt.strftime('%Y-%m-%d %H:%M:%S %Z')
        return "N/A"
    
    def calculate_durations(self) -> Dict[str, Any]:
        """Calculate durations between reference times."""
        if not self.reference_times["first_check"]:
            return {}
        
        durations = {}
        first_check = self.reference_times["first_check"]
        
        for key, timestamp in self.reference_times.items():
            if key == "first_check" or not timestamp:
                continue
            
            delta = timestamp - first_check
            durations[key] = {
                "timestamp_utc": timestamp.isoformat(),
                "timestamp_local": self.format_time(timestamp),
                "duration_from_first_check": {
                    "total_seconds": int(delta.total_seconds()),
                    "hours": round(delta.total_seconds() / 3600, 2),
                    "minutes": round(delta.total_seconds() / 60, 2),
                    "human_readable": str(delta)
                }
            }
        
        # Calculate relative durations
        if self.reference_times["all_fixtures_finished"] and self.reference_times["all_fixtures_finished_provisional"]:
            delta = self.reference_times["all_fixtures_finished_provisional"] - self.reference_times["all_fixtures_finished"]
            durations["fixtures_finished_to_provisional"] = {
                "duration_seconds": int(delta.total_seconds()),
                "duration_minutes": round(delta.total_seconds() / 60, 2),
                "human_readable": str(delta)
            }
        
        if self.reference_times["all_fixtures_finished"] and self.reference_times["data_checked_true"]:
            delta = self.reference_times["data_checked_true"] - self.reference_times["all_fixtures_finished"]
            durations["fixtures_finished_to_data_checked"] = {
                "duration_seconds": int(delta.total_seconds()),
                "duration_minutes": round(delta.total_seconds() / 60, 2),
                "duration_hours": round(delta.total_seconds() / 3600, 2),
                "human_readable": str(delta)
            }
        
        if self.reference_times["gameweek_finished"] and self.reference_times["data_checked_true"]:
            delta = self.reference_times["data_checked_true"] - self.reference_times["gameweek_finished"]
            durations["gameweek_finished_to_data_checked"] = {
                "duration_seconds": int(delta.total_seconds()),
                "duration_minutes": round(delta.total_seconds() / 60, 2),
                "duration_hours": round(delta.total_seconds() / 3600, 2),
                "human_readable": str(delta)
            }
        
        return durations
    
    def save_timeline(self):
        """Save timeline and reference data."""
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        
        timeline_data = {
            "gameweek": self.gameweek,
            "initial_state": self.initial_state,
            "reference_times": {
                k: v.isoformat() if v else None 
                for k, v in self.reference_times.items()
            },
            "durations": self.calculate_durations(),
            "timeline": self.timeline,
            "final_check": datetime.now(timezone.utc).isoformat()
        }
        
        # Save full timeline
        timeline_file = self.timeline_dir / f"timeline_{timestamp}.json"
        with open(timeline_file, "w") as f:
            json.dump(timeline_data, f, indent=2)
        
        # Save human-readable summary
        summary_file = self.timeline_dir / f"summary_{timestamp}.txt"
        with open(summary_file, "w") as f:
            f.write(f"Gameweek {self.gameweek} Status Update Timeline\n")
            f.write("=" * 80 + "\n\n")
            
            f.write("Reference Times:\n")
            f.write("-" * 80 + "\n")
            for key, timestamp in self.reference_times.items():
                if timestamp:
                    local_dt = timestamp.astimezone(self.local_tz)
                    f.write(f"{key.replace('_', ' ').title()}:\n")
                    f.write(f"  UTC: {timestamp.isoformat()}\n")
                    f.write(f"  Local: {local_dt.strftime('%Y-%m-%d %H:%M:%S %Z')}\n")
            f.write("\n")
            
            f.write("Durations (from first check):\n")
            f.write("-" * 80 + "\n")
            durations = self.calculate_durations()
            for key, data in durations.items():
                if "duration_from_first_check" in data:
                    dur = data["duration_from_first_check"]
                    f.write(f"{key.replace('_', ' ').title()}:\n")
                    f.write(f"  UTC Time: {data.get('timestamp_utc', 'N/A')}\n")
                    f.write(f"  Local Time: {data.get('timestamp_local', 'N/A')}\n")
                    f.write(f"  Duration: {dur['human_readable']} ({dur['hours']} hours, {dur['minutes']} minutes)\n")
                elif "duration" in key.lower():
                    f.write(f"{key.replace('_', ' ').title()}: {data.get('human_readable', 'N/A')}\n")
            f.write("\n")
            
            f.write("Key Milestones:\n")
            f.write("-" * 80 + "\n")
            if self.reference_times["all_fixtures_finished"]:
                f.write(f"✓ All fixtures marked finished\n")
            if self.reference_times["all_fixtures_finished_provisional"]:
                f.write(f"✓ All fixtures marked finished_provisional\n")
            if self.reference_times["gameweek_finished"]:
                f.write(f"✓ Gameweek marked finished\n")
            if self.reference_times["data_checked_true"]:
                f.write(f"✓ Data checked = True\n")
        
        print(f"💾 Saved timeline: {timeline_file.name}")
        print(f"💾 Saved summary: {summary_file.name}")
    
    async def check_status(self):
        """Check current status and record changes."""
        self.run_count += 1
        now = datetime.now(timezone.utc)
        now_local = now.astimezone(self.local_tz)
        
        print(f"\n{'='*80}")
        print(f"Check #{self.run_count} - {now_local.strftime('%Y-%m-%d %H:%M:%S %Z')} ({now.strftime('%H:%M:%S UTC')})")
        print(f"{'='*80}")
        
        try:
            # Fetch data
            print("📡 Fetching bootstrap-static...")
            bootstrap = await self.fetch_endpoint("bootstrap-static/")
            
            print("📡 Fetching fixtures...")
            fixtures = await self.fetch_endpoint("fixtures/")
            
            # Extract status
            gw_status = self.get_gameweek_status(bootstrap)
            fixtures_status = self.get_fixtures_status(fixtures)
            
            if not gw_status:
                print("❌ Could not get gameweek status")
                return False, None
            
            # Display current status
            print(f"\n📊 Gameweek Status:")
            print(f"  Finished: {gw_status.get('finished')}")
            print(f"  Data Checked: {gw_status.get('data_checked')}")
            print(f"  Is Current: {gw_status.get('is_current')}")
            print(f"  Average Score: {gw_status.get('average_entry_score')}")
            print(f"  Highest Score: {gw_status.get('highest_score')}")
            
            print(f"\n📊 Fixtures Status:")
            print(f"  Total: {fixtures_status.get('total')}")
            print(f"  Started: {fixtures_status.get('started')}/{fixtures_status.get('total')}")
            print(f"  Finished: {fixtures_status.get('finished')}/{fixtures_status.get('total')}")
            print(f"  Finished Provisional: {fixtures_status.get('finished_provisional')}/{fixtures_status.get('total')}")
            
            # Detect changes
            changes = self.detect_changes(gw_status, fixtures_status)
            
            if changes:
                print(f"\n🔔 CHANGES DETECTED:")
                for key, change in changes.items():
                    print(f"  {key}: {change.get('old')} → {change.get('new', change.get('timestamp', 'N/A'))}")
                
                # Add to timeline
                self.timeline.append({
                    "check_number": self.run_count,
                    "timestamp": now.isoformat(),
                    "changes": changes,
                    "status": {
                        "gameweek": gw_status,
                        "fixtures": fixtures_status
                    }
                })
            
            # Update last status
            self.last_status = {
                "gameweek": gw_status,
                "fixtures": fixtures_status
            }
            
            # Check if we should stop
            if gw_status.get("data_checked") is True:
                print(f"\n✅ data_checked is now True - monitoring complete!")
                return True, "data_checked is now True"
            
            return False, None
            
        except Exception as e:
            print(f"❌ Error during check: {e}")
            import traceback
            traceback.print_exc()
            return False, None
    
    async def run(self, max_checks: Optional[int] = None):
        """Run monitoring loop."""
        local_tz_name = datetime.now(self.local_tz).strftime('%Z')
        print(f"🚀 Starting gameweek {self.gameweek} status timing monitor")
        print(f"   Check interval: {self.check_interval} seconds")
        print(f"   Timeline directory: {self.timeline_dir}")
        print(f"   Timezone: {local_tz_name} (times displayed in local timezone)")
        print(f"   Will stop when: data_checked=True")
        if max_checks:
            print(f"   Max checks: {max_checks}")
        print()
        
        check_count = 0
        try:
            while True:
                should_stop, reason = await self.check_status()
                check_count += 1
                
                if should_stop:
                    print(f"\n✅ {reason}")
                    print(f"✅ Monitoring complete after {check_count} checks.")
                    break
                
                if max_checks and check_count >= max_checks:
                    print(f"\n✅ Completed {max_checks} checks. Stopping.")
                    break
                
                print(f"\n⏳ Waiting {self.check_interval} seconds until next check...")
                await asyncio.sleep(self.check_interval)
                
        except KeyboardInterrupt:
            print(f"\n\n⏹️  Monitoring stopped by user after {check_count} checks")
        except Exception as e:
            print(f"\n❌ Monitoring error: {e}")
            import traceback
            traceback.print_exc()
        finally:
            # Save timeline before exiting
            if self.timeline or self.reference_times.get("first_check"):
                print(f"\n💾 Saving timeline...")
                self.save_timeline()
                
                # Print summary
                print(f"\n{'='*80}")
                print("TIMING SUMMARY")
                print(f"{'='*80}")
                durations = self.calculate_durations()
                for key, data in durations.items():
                    if "duration_from_first_check" in data:
                        dur = data["duration_from_first_check"]
                        local_time = data.get('timestamp_local', 'N/A')
                        print(f"{key.replace('_', ' ').title()}:")
                        print(f"  Time: {local_time}")
                        print(f"  Duration: {dur['hours']} hours ({dur['minutes']} minutes)")
                    elif "duration" in key.lower():
                        print(f"{key.replace('_', ' ').title()}: {data.get('human_readable', 'N/A')}")


async def main():
    """Main entry point."""
    import sys
    
    gameweek = 23
    interval = 60
    
    if len(sys.argv) > 1:
        try:
            interval = int(sys.argv[1])
        except ValueError:
            print(f"Invalid interval: {sys.argv[1]}. Using default: {interval}")
    
    max_checks = None
    if len(sys.argv) > 2:
        try:
            max_checks = int(sys.argv[2])
        except ValueError:
            pass
    
    if len(sys.argv) > 3:
        try:
            gameweek = int(sys.argv[3])
        except ValueError:
            print(f"Invalid gameweek: {sys.argv[3]}. Using default: {gameweek}")
    
    monitor = GameweekStatusTimingMonitor(gameweek=gameweek, check_interval=interval)
    await monitor.run(max_checks=max_checks)


if __name__ == "__main__":
    asyncio.run(main())
