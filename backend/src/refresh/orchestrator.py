"""
Refresh Orchestrator - Coordinates all data refresh operations.

Manages state machine, dependency ordering, and refresh cadence.
"""

import asyncio
import logging
import subprocess
from datetime import date, datetime, time, timezone, timedelta
from pathlib import Path
from enum import Enum
from typing import Optional, List, Dict, Any

from config import Config
from database.supabase_client import SupabaseClient
from fpl_api.client import FPLAPIClient, FPLAPIRateLimitError
from refresh.players import PlayerDataRefresher
from refresh.managers import ManagerDataRefresher
from refresh.baseline_capture import BaselineCapture

logger = logging.getLogger(__name__)


class RefreshState(Enum):
    """Refresh state enumeration."""
    IDLE = "idle"  # No matches active, normal refresh
    LIVE_MATCHES = "live_matches"  # Matches in progress
    BONUS_PENDING = "bonus_pending"  # Matches finished, bonus not confirmed
    PRICE_WINDOW = "price_window"  # Price change window (5:30-5:36 PM PST)
    TRANSFER_DEADLINE = "transfer_deadline"  # Near transfer deadline
    OUTSIDE_GAMEWEEK = "outside_gameweek"  # Outside active gameweek


class RefreshOrchestrator:
    """Orchestrates all refresh operations."""
    
    def __init__(self, config: Config):
        self.config = config
        self.fpl_client: Optional[FPLAPIClient] = None
        self.db_client: Optional[SupabaseClient] = None
        self.player_refresher: Optional[PlayerDataRefresher] = None
        self.manager_refresher: Optional[ManagerDataRefresher] = None
        self.baseline_capture: Optional[BaselineCapture] = None
        self.running = False
        self.current_state = RefreshState.IDLE
        self.current_gameweek: Optional[int] = None
        # Track previous gameweek state to detect status changes
        self.previous_gameweek_state: Optional[Dict[str, Any]] = None
        # Track the gameweek that was is_next before deadline
        self.next_gameweek_id_before_deadline: Optional[int] = None
        # Target gameweek for deadline batch: the GW we're waiting to become is_current
        self._deadline_target_gameweek_id: Optional[int] = None
        # Track if we've already refreshed picks/transfers for current deadline window
        self.deadline_refresh_completed: bool = False
        # First run time of deadline batch (for fixed-window retries so transfers endpoint can catch up)
        self._deadline_batch_first_run_time: Optional[datetime] = None
        # True when we ran the deadline batch this cycle (so Phase 4 skips MVs to avoid double refresh)
        self._deadline_batch_ran_this_cycle: bool = False
        # Throttle for FPL rank-change check (only run every 5 min when in BONUS_PENDING)
        self._last_rank_check_time: Optional[datetime] = None
        self._last_rank_check_gameweek: Optional[int] = None
        self._rank_check_interval_seconds: int = 300  # 5 minutes
        # During LIVE_MATCHES/BONUS_PENDING: player data every cycle; manager points + MVs every full_refresh_interval_live
        self._last_full_refresh_time: Optional[datetime] = None
        # Catch-up player refresh: gameweeks for which we've validated no player has provisional status (stop retrying)
        self._catch_up_done_gameweeks: set = set()
        # Post–price window: run manager refresh once per day after window closes (capture team value)
        self._post_price_window_refresh_done_date: Optional[date] = None  # date we last ran
        # Rank monitoring: after last game of match day, poll FPL every 15 min for up to 5 hours
        self._rank_monitor_window_end: Optional[datetime] = None
        self._rank_monitor_day_started: Optional[date] = None  # date we started window for
        # Hourly refresh: refresh all managers' overall_rank and gameweek_rank every 60 minutes
        self._last_hourly_rank_refresh_time: Optional[datetime] = None
        self._hourly_rank_refresh_interval_seconds: int = 3600  # 1 hour
        # Throttle live standings inside fast cycle so most fast cycles are short (gameweeks + fixtures + players only)
        self._last_live_standings_in_fast_cycle: Optional[datetime] = None
        
    async def initialize(self):
        """Initialize orchestrator and clients."""
        logger.info("Orchestrator starting")
        
        # Initialize clients
        self.fpl_client = FPLAPIClient(self.config)
        self.db_client = SupabaseClient(self.config)
        self.player_refresher = PlayerDataRefresher(self.fpl_client, self.db_client)
        self.manager_refresher = ManagerDataRefresher(self.fpl_client, self.db_client)
        self.baseline_capture = BaselineCapture(
            self.fpl_client, self.db_client, self.config
        )
        
        logger.info("Orchestrator ready")
    
    async def shutdown(self):
        """Shutdown orchestrator gracefully."""
        logger.info("Orchestrator shutting down")
        self.running = False
        
        if self.fpl_client:
            await self.fpl_client.close()
        
        logger.info("Orchestrator stopped")
    
    def _is_price_change_window(self, current_time: datetime) -> bool:
        """
        Check if current time is within price change window.
        
        Window: 5:30 PM - 5:36 PM PST (30 second refresh interval)
        
        Args:
            current_time: Current datetime (UTC)
            
        Returns:
            True if in price change window
        """
        # Convert to PST (UTC-8)
        pst_time = current_time.astimezone(timezone(timedelta(hours=-8)))
        price_change_time = time.fromisoformat(self.config.price_change_time)
        
        # Window starts at price_change_time and lasts for window_duration minutes
        window_duration = self.config.price_change_window_duration
        price_change_datetime = datetime.combine(pst_time.date(), price_change_time)
        window_start = price_change_datetime
        window_end = price_change_datetime + timedelta(minutes=window_duration)
        
        current_datetime = datetime.combine(pst_time.date(), pst_time.time())
        return window_start <= current_datetime <= window_end
    
    def _is_after_price_window_cooldown(self, current_time: datetime) -> bool:
        """
        True when we're past the price-change window but within the cooldown (e.g. 5 min).
        Used to run manager refresh once after the window to capture post–price-change team value.
        """
        pst_time = current_time.astimezone(timezone(timedelta(hours=-8)))
        price_change_time = time.fromisoformat(self.config.price_change_time)
        window_duration = self.config.price_change_window_duration
        price_change_datetime = datetime.combine(pst_time.date(), price_change_time)
        window_end = price_change_datetime + timedelta(minutes=window_duration)
        cooldown_end = window_end + timedelta(minutes=self.config.price_window_cooldown_minutes)
        current_datetime = datetime.combine(pst_time.date(), pst_time.time())
        return window_end < current_datetime <= cooldown_end
    
    def _is_last_match_of_today_finished(self, fixtures: List[Dict[str, Any]]) -> bool:
        """
        True when the fixture with latest kickoff today (UTC date) for current GW has finished (or finished_provisional).
        Used to start the rank-monitoring window after the last game of the match day.
        """
        if not fixtures:
            return False
        now = datetime.now(timezone.utc)
        today = now.date()
        today_fixtures = []
        for f in fixtures:
            k = f.get("kickoff_time")
            if not k:
                continue
            try:
                kickoff = datetime.fromisoformat(k.replace("Z", "+00:00"))
                if kickoff.tzinfo is None:
                    kickoff = kickoff.replace(tzinfo=timezone.utc)
                if kickoff.date() == today:
                    today_fixtures.append(f)
            except (ValueError, TypeError):
                continue
        if not today_fixtures:
            return False
        latest = max(
            today_fixtures,
            key=lambda x: x.get("kickoff_time") or ""
        )
        return bool(latest.get("finished_provisional") or latest.get("finished"))
    
    def _should_run_rank_monitor_check(self) -> bool:
        """True when we're inside the rank-monitor window and 15 min have passed since last check."""
        if not self._rank_monitor_window_end or not self.current_gameweek:
            return False
        now = datetime.now(timezone.utc)
        if now >= self._rank_monitor_window_end:
            self._rank_monitor_window_end = None
            self._rank_monitor_day_started = None
            return False
        interval = self.config.rank_monitor_interval_seconds
        if self._last_rank_check_time is None:
            return True
        return (now - self._last_rank_check_time).total_seconds() >= interval
    
    async def _detect_state(self) -> RefreshState:
        """
        Detect current refresh state based on gameweek and fixture data.
        
        Returns:
            Current refresh state
        """
        # Always refresh gameweeks first to get current state
        gameweeks = self.db_client.get_gameweeks(is_current=True, limit=1)
        
        if not gameweeks:
            return RefreshState.OUTSIDE_GAMEWEEK
        
        current_gw = gameweeks[0]
        self.current_gameweek = current_gw["id"]
        
        # Check if outside gameweek
        if not current_gw.get("is_current"):
            return RefreshState.OUTSIDE_GAMEWEEK
        
        # Check price change window first: 6-minute window is time-critical; we must not miss it
        # when we would otherwise be LIVE_MATCHES or BONUS_PENDING (e.g. match day, bonus not yet confirmed)
        if self._is_price_change_window(datetime.now(timezone.utc)):
            return RefreshState.PRICE_WINDOW
        
        # Get fixtures for current and next gameweek so we detect live when first match of *next* GW kicks off
        # (e.g. Tot–Ars in GW27 while FPL has not yet set is_current=27).
        gw_ids_for_fixtures = [current_gw["id"]]
        next_gws = self.db_client.get_gameweeks(is_next=True, limit=1)
        next_gw = next_gws[0] if next_gws else None
        if next_gw:
            gw_ids_for_fixtures.append(next_gw["id"])
        fixtures = self.db_client.client.table("fixtures").select("*").in_(
            "gameweek", gw_ids_for_fixtures
        ).execute().data
        
        # Fixtures for current GW only (for bonus_pending and later checks)
        fixtures_current = [f for f in fixtures if f.get("gameweek") == current_gw["id"]]
        
        now = datetime.now(timezone.utc)
        # Live = in progress: at or past scheduled kickoff and not yet provisionally finished.
        # Use kickoff_time so we enter LIVE at the exact minute kickoff happens, not when FPL API flips started.
        def _fixture_in_progress(f: Dict[str, Any]) -> bool:
            if f.get("finished_provisional"):
                return False
            if f.get("started"):
                return True
            k = f.get("kickoff_time")
            if not k:
                return False
            try:
                kickoff = datetime.fromisoformat(k.replace("Z", "+00:00"))
                if kickoff.tzinfo is None:
                    kickoff = kickoff.replace(tzinfo=timezone.utc)
                return now >= kickoff
            except (ValueError, TypeError):
                return False

        live_matches = [f for f in fixtures if _fixture_in_progress(f)]
        if live_matches:
            # If live match is in next GW, use that as current so event-live and player refresh use correct GW
            live_in_next = next((f for f in live_matches if f.get("gameweek") == next_gw["id"]), None) if next_gw else None
            if live_in_next:
                self.current_gameweek = next_gw["id"]
                logger.info(
                    "Live match in next gameweek (kickoff passed); using next GW as current",
                    extra={"gameweek": next_gw["id"], "gameweek_name": next_gw.get("name")},
                )
            return RefreshState.LIVE_MATCHES
        
        # Diagnostic: when no live found, log fixture state so we can see e.g. next GW kickoff passed but not detected
        if fixtures and logger.isEnabledFor(logging.DEBUG):
            def _past_kickoff(f: Dict[str, Any]) -> bool:
                k = f.get("kickoff_time")
                if not k:
                    return False
                try:
                    ko = datetime.fromisoformat(k.replace("Z", "+00:00"))
                    if ko.tzinfo is None:
                        ko = ko.replace(tzinfo=timezone.utc)
                    return now >= ko
                except (ValueError, TypeError):
                    return False
            fixture_diag = [
                {
                    "gameweek": f.get("gameweek"),
                    "kickoff_time": f.get("kickoff_time"),
                    "started": f.get("started"),
                    "finished_provisional": f.get("finished_provisional"),
                    "past_kickoff": _past_kickoff(f),
                }
                for f in fixtures
            ]
            logger.debug(
                "No live matches; fixture state",
                extra={
                    "current_gw_id": current_gw["id"],
                    "next_gw_id": next_gw["id"] if next_gw else None,
                    "fixture_count_current": len(fixtures_current),
                    "fixture_count_next": len(fixtures) - len(fixtures_current),
                    "fixtures": fixture_diag,
                },
            )
        
        # Check for bonus pending: all fixtures finished_provisional and not finished (current GW only)
        if fixtures_current and all(
            f.get("finished_provisional") and not f.get("finished")
            for f in fixtures_current
        ):
            return RefreshState.BONUS_PENDING
        
        # Check transfer deadline: enter when we're 30+ min past the relevant deadline.
        # (1) Next GW's deadline passed → wait for that GW to become is_current, then run batch.
        # (2) Current GW's deadline was 30+ min ago → FPL may have already flipped; enter and run batch for current.
        if not self.deadline_refresh_completed:
            next_gws = self.db_client.get_gameweeks(is_next=True, limit=1)
            if next_gws:
                next_gw = next_gws[0]
                next_deadline_raw = next_gw.get("deadline_time")
                if next_deadline_raw:
                    next_deadline = datetime.fromisoformat(next_deadline_raw.replace("Z", "+00:00"))
                    time_since = (now - next_deadline).total_seconds()
                    if time_since >= 2400:  # 40 min after next GW's deadline (avoid FPL API freeze)
                        self._deadline_target_gameweek_id = next_gw["id"]
                        logger.info(
                            "Entering TRANSFER_DEADLINE: watching for GW to become is_current",
                            extra={"target_gameweek": next_gw["id"], "gameweek_name": next_gw.get("name")},
                        )
                        return RefreshState.TRANSFER_DEADLINE
            # Also enter when current GW's deadline was 40+ min ago (FPL may have already flipped)
            current_deadline_raw = current_gw.get("deadline_time")
            if current_deadline_raw:
                current_deadline = datetime.fromisoformat(current_deadline_raw.replace("Z", "+00:00"))
                if (now - current_deadline).total_seconds() >= 2400:
                    self._deadline_target_gameweek_id = current_gw["id"]
                    logger.info(
                        "Entering TRANSFER_DEADLINE: watching for GW to become is_current",
                        extra={"target_gameweek": current_gw["id"], "gameweek_name": current_gw.get("name")},
                    )
                    return RefreshState.TRANSFER_DEADLINE
        
        # Mismatch recovery: if current GW has no successful deadline batch, enter TRANSFER_DEADLINE
        # so we run (or retry) the batch. Ensures we refresh when is_current has no batch (e.g. backend
        # was down at flip, or previous run failed).
        current_gw_id = current_gw.get("id")
        if current_gw_id is not None:
            current_deadline_raw = current_gw.get("deadline_time")
            if current_deadline_raw:
                current_deadline = datetime.fromisoformat(current_deadline_raw.replace("Z", "+00:00"))
                if (now - current_deadline).total_seconds() >= 2400 and not self.db_client.has_successful_deadline_batch_for_gameweek(current_gw_id):
                    self._deadline_target_gameweek_id = current_gw_id
                    logger.info(
                        "Deadline batch mismatch: current GW has no successful batch, entering TRANSFER_DEADLINE to refresh",
                        extra={"target_gameweek": current_gw_id, "gameweek_name": current_gw.get("name")},
                    )
                    return RefreshState.TRANSFER_DEADLINE
        
        return RefreshState.IDLE
    
    def _is_in_kickoff_window(self) -> bool:
        """
        True when now is within N minutes before or after any fixture kickoff for the current gameweek.
        Ensures we use short refresh interval around documented kickoffs (Sat–Mon multi-day gameweeks)
        so we quickly discover started=true and enter LIVE_MATCHES.
        """
        if not self.current_gameweek or not self.db_client:
            return False
        try:
            fixtures = self.db_client.client.table("fixtures").select(
                "kickoff_time"
            ).eq("gameweek", self.current_gameweek).execute().data
            if not fixtures:
                return False
            now = datetime.now(timezone.utc)
            window_minutes = self.config.kickoff_window_minutes
            delta = timedelta(minutes=window_minutes)
            for f in fixtures:
                k = f.get("kickoff_time")
                if not k:
                    continue
                try:
                    kickoff = datetime.fromisoformat(k.replace("Z", "+00:00"))
                    if kickoff.tzinfo is None:
                        kickoff = kickoff.replace(tzinfo=timezone.utc)
                    if kickoff - delta <= now <= kickoff + delta:
                        return True
                except (ValueError, TypeError):
                    continue
            return False
        except Exception as e:
            logger.debug("Kickoff window check failed", extra={"error": str(e)})
            return False
    
    def _get_refresh_interval(self, state: RefreshState, table: str) -> int:
        """
        Get refresh interval for a table based on state.
        
        Args:
            state: Current refresh state
            table: Table name
            
        Returns:
            Refresh interval in seconds
        """
        if table == "gameweeks":
            return self.config.gameweeks_refresh_interval
        
        if table == "fixtures":
            if state in (RefreshState.LIVE_MATCHES, RefreshState.BONUS_PENDING):
                return self.config.fixtures_refresh_interval_live
            return self.config.fixtures_refresh_interval_idle
        
        if table == "player_gameweek_stats":
            if state == RefreshState.LIVE_MATCHES:
                return self.config.players_refresh_interval_live
            if state == RefreshState.BONUS_PENDING:
                return self.config.players_refresh_interval_bonus
            return None  # Don't refresh if no active matches
        
        if table == "player_prices":
            if state == RefreshState.PRICE_WINDOW:
                return self.config.prices_refresh_interval_window
            # Only refresh during price window
            return None
        
        return None
    
    def _detect_gameweek_status_change(self, current_gameweek_data: Dict[str, Any]) -> bool:
        """
        Detect if gameweek status has changed, indicating FPL API has updated.
        
        Tracks changes in is_next, is_current, is_previous flags which indicate
        that the API has processed the deadline and new gameweek data is available.
        
        Args:
            current_gameweek_data: Current gameweek data from database
            
        Returns:
            True if status change detected, False otherwise
        """
        if self.previous_gameweek_state is None:
            # First check - store initial state and track next gameweek
            self.previous_gameweek_state = {
                "is_current": current_gameweek_data.get("is_current", False),
                "is_next": current_gameweek_data.get("is_next", False),
                "is_previous": current_gameweek_data.get("is_previous", False),
                "id": current_gameweek_data.get("id")
            }
            
            # Track the gameweek that is currently is_next (will become current after deadline)
            if current_gameweek_data.get("is_next"):
                self.next_gameweek_id_before_deadline = current_gameweek_data.get("id")
            
            return False
        
        # Check for status changes
        prev = self.previous_gameweek_state
        curr = current_gameweek_data
        
        # Detect if is_next gameweek became is_current
        if prev.get("is_next") and curr.get("is_current") and prev.get("id") == curr.get("id"):
            logger.info("GW status: next → current", extra={"gameweek": curr.get("id")})
            return True
        
        # Detect if is_current gameweek became is_previous
        if prev.get("is_current") and curr.get("is_previous") and prev.get("id") == curr.get("id"):
            logger.info("GW status: current → previous", extra={"gameweek": curr.get("id")})
            return True
        
        # Detect if tracked next gameweek became current (different gameweek)
        if (self.next_gameweek_id_before_deadline and 
            curr.get("id") == self.next_gameweek_id_before_deadline and 
            curr.get("is_current")):
            logger.info("GW status: next became current", extra={"gameweek": curr.get("id")})
            return True
        
        # Update previous state
        self.previous_gameweek_state = {
            "is_current": curr.get("is_current", False),
            "is_next": curr.get("is_next", False),
            "is_previous": curr.get("is_previous", False),
            "id": curr.get("id")
        }
        
        return False
    
    async def _wait_for_new_gameweek_release(self) -> None:
        """
        After deadline batch: wait for FPL to release the new gameweek (release_time),
        then refresh gameweeks until the next GW becomes is_current so we stop showing last week's data.
        """
        # Get the gameweek that is currently "next" (will become current when FPL releases)
        next_gws = self.db_client.get_gameweeks(is_next=True, limit=1)
        if not next_gws:
            logger.debug("No is_next gameweek for release wait")
            return
        next_gw = next_gws[0]
        next_gw_id = next_gw["id"]
        release_time_raw = next_gw.get("release_time")
        now_utc = datetime.now(timezone.utc)

        # If FPL provides release_time and it's in the future, wait until then (cap 60 min)
        if release_time_raw:
            try:
                release_dt = datetime.fromisoformat(
                    release_time_raw.replace("Z", "+00:00")
                )
                if release_dt.tzinfo is None:
                    release_dt = release_dt.replace(tzinfo=timezone.utc)
                if now_utc < release_dt:
                    wait_sec = (release_dt - now_utc).total_seconds()
                    max_wait = 3600  # 60 min
                    wait_sec = min(wait_sec, max_wait)
                    logger.info(
                        "Waiting for FPL gameweek release",
                        extra={
                            "next_gameweek": next_gw_id,
                            "release_time": release_time_raw,
                            "wait_seconds": int(wait_sec),
                        },
                    )
                    await asyncio.sleep(wait_sec)
            except (ValueError, TypeError) as e:
                logger.debug("Could not parse release_time", extra={"release_time": release_time_raw, "error": str(e)})

        # Poll refresh until the next gameweek is current (FPL has flipped is_current)
        poll_interval = 60  # seconds
        max_polls = 30  # ~30 min max
        for attempt in range(max_polls):
            await self._refresh_gameweeks()
            current_gws = self.db_client.get_gameweeks(gameweek_id=next_gw_id, limit=1)
            if current_gws and current_gws[0].get("is_current"):
                logger.info(
                    "New gameweek is current after release wait",
                    extra={"gameweek": next_gw_id, "attempts": attempt + 1},
                )
                return
            if attempt < max_polls - 1:
                logger.debug(
                    "New gameweek not yet current, re-polling",
                    extra={"next_gameweek": next_gw_id, "attempt": attempt + 1},
                )
                await asyncio.sleep(poll_interval)
        logger.warning(
            "New gameweek still not current after polling",
            extra={"next_gameweek": next_gw_id, "max_polls": max_polls},
        )

    async def _short_bootstrap_check(self) -> bool:
        """
        Quick check that FPL API is responsive (1–2 attempts, ~30s delay if first fails).
        Returns True if bootstrap-static succeeds, False otherwise. Used before deadline batch.
        """
        try:
            await self.fpl_client.get_bootstrap_static()
            return True
        except Exception as e:
            logger.info("Bootstrap check failed, retrying once in 30s", extra={"error": str(e)})
            await asyncio.sleep(30)
            try:
                await self.fpl_client.get_bootstrap_static()
                return True
            except Exception as e2:
                logger.warning("Bootstrap check failed again, skipping batch this cycle", extra={"error": str(e2)})
                return False

    async def _refresh_gameweeks(self) -> Optional[Dict[str, Any]]:
        """Refresh gameweeks table. Returns bootstrap for reuse (e.g. player refresh)."""
        try:
            bootstrap = await self.fpl_client.get_bootstrap_static()
            events = bootstrap.get("events", [])
            
            for event in events:
                # release_time: when FPL releases this gameweek (new GW goes live); used post-deadline
                raw_release = event.get("release_time")
                release_time = raw_release if raw_release else None
                gameweek_data = {
                    "id": event["id"],
                    "name": event["name"],
                    "deadline_time": event["deadline_time"],
                    "release_time": release_time,
                    "is_current": event.get("is_current", False),
                    "is_previous": event.get("is_previous", False),
                    "is_next": event.get("is_next", False),
                    "finished": event.get("finished", False),
                    "data_checked": event.get("data_checked", False),
                    "highest_score": event.get("highest_score"),
                    "average_entry_score": event.get("average_entry_score"),
                    "updated_at": datetime.now(timezone.utc).isoformat()
                }
                
                self.db_client.upsert_gameweek(gameweek_data)
            
            # Persist total managers (bootstrap total_players) for GW rank percentile
            total_players = bootstrap.get("total_players")
            if total_players is not None:
                self.db_client.upsert_fpl_global({
                    "id": "current_season",
                    "total_managers": total_players,
                    "updated_at": datetime.now(timezone.utc).isoformat()
                })

            # Upsert teams (names + all strength fields for schedule and future use)
            for team in bootstrap.get("teams", []):
                self.db_client.upsert_team({
                    "team_id": team["id"],
                    "team_name": team.get("name", ""),
                    "short_name": team.get("short_name", ""),
                    "strength": team.get("strength"),
                    "strength_overall_home": team.get("strength_overall_home"),
                    "strength_overall_away": team.get("strength_overall_away"),
                    "strength_attack_home": team.get("strength_attack_home"),
                    "strength_attack_away": team.get("strength_attack_away"),
                    "strength_defence_home": team.get("strength_defence_home"),
                    "strength_defence_away": team.get("strength_defence_away"),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                })
            
            logger.debug("Refreshed gameweeks", extra={
                "gameweeks_count": len(events)
            })
            return bootstrap
        except Exception as e:
            logger.error("Gameweeks refresh failed", extra={"error": str(e)}, exc_info=True)
            return None

    def _apply_fixtures_to_db(
        self, fixtures: List[Dict[str, Any]], gw_ids_to_refresh: List[int]
    ) -> Dict[int, Dict[str, Any]]:
        """Apply raw FPL fixture dicts to DB (upsert). Returns current gameweek fixtures keyed by fpl_fixture_id."""
        if gw_ids_to_refresh:
            fixtures = [f for f in fixtures if f.get("event") in gw_ids_to_refresh]
        gameweeks = self.db_client.get_gameweeks()
        deadline_time_map = {
            gw["id"]: gw["deadline_time"]
            for gw in gameweeks
            if gw.get("deadline_time")
        }
        fixtures_by_id: Dict[int, Dict[str, Any]] = {}
        for fixture in fixtures:
            gameweek_id = fixture.get("event")
            fixtures_by_id[fixture["id"]] = fixture
            started = fixture.get("started")
            finished = fixture.get("finished")
            finished_provisional = fixture.get("finished_provisional")
            fixture_data = {
                "fpl_fixture_id": fixture["id"],
                "gameweek": gameweek_id,
                "home_team_id": fixture["team_h"],
                "away_team_id": fixture["team_a"],
                "home_score": fixture.get("team_h_score"),
                "away_score": fixture.get("team_a_score"),
                "started": bool(started) if started is not None else False,
                "finished": bool(finished) if finished is not None else False,
                "finished_provisional": bool(finished_provisional) if finished_provisional is not None else False,
                "minutes": fixture.get("minutes", 0) or 0,
                "kickoff_time": fixture.get("kickoff_time"),
                "deadline_time": deadline_time_map.get(gameweek_id),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            self.db_client.upsert_fixture(fixture_data)
        current_fixtures_by_id = {
            fid: f for fid, f in fixtures_by_id.items()
            if f.get("event") == self.current_gameweek
        }
        logger.debug("Refreshed fixtures", extra={
            "fixtures_count": len(fixtures),
            "gameweeks_refreshed": gw_ids_to_refresh,
        })
        return current_fixtures_by_id

    async def _refresh_fixtures(self) -> Optional[Dict[int, Dict[str, Any]]]:
        """Refresh fixtures table for current and next gameweek (so DGW and next-GW matchups are visible).
        Returns fixtures for current gameweek only keyed by fpl_fixture_id for reuse (e.g. player refresh)."""
        try:
            fixtures = await self.fpl_client.get_fixtures()
            gw_ids_to_refresh = []
            if self.current_gameweek:
                gw_ids_to_refresh.append(self.current_gameweek)
            next_gws = self.db_client.get_gameweeks(is_next=True, limit=1)
            if next_gws and next_gws[0]["id"] not in gw_ids_to_refresh:
                gw_ids_to_refresh.append(next_gws[0]["id"])
            return self._apply_fixtures_to_db(fixtures, gw_ids_to_refresh)
        except Exception as e:
            logger.error("Fixtures refresh failed", extra={"error": str(e)}, exc_info=True)
            return None
    
    async def _refresh_players(
        self,
        bootstrap: Optional[Dict[str, Any]] = None,
        fixtures_by_gameweek: Optional[Dict[int, Dict[str, Any]]] = None,
        live_data: Optional[Dict[str, Any]] = None,
    ) -> Optional[Dict[str, Any]]:
        """Refresh player gameweek stats for active players. Reuses bootstrap and fixtures when provided to avoid duplicate API calls.
        When live_data is provided (e.g. from parallel fetch), does not call get_event_live again. Returns live_data when live."""
        if not self.current_gameweek:
            return None
        
        # Get fixtures to check for live matches (defensive check)
        fixtures = self.db_client.client.table("fixtures").select("*").eq(
            "gameweek", self.current_gameweek
        ).execute().data
        
        # Refresh when we have in-progress OR provisionally-finished matches (so GW points stay updated until all fixtures are fully finished).
        has_live_or_provisional = any(
            (f.get("started", False) and not f.get("finished_provisional", False))
            or (f.get("finished_provisional", False) and not f.get("finished", False))
            for f in fixtures
        )
        
        if not has_live_or_provisional:
            logger.debug("No live or provisionally finished matches, skipping player refresh", extra={
                "gameweek": self.current_gameweek
            })
            return None
        
        # Use provided live_data or fetch (single API call)
        try:
            if live_data is None:
                live_data = await self.fpl_client.get_event_live(self.current_gameweek)
            # Players with minutes in live response (so we have fresh stats to write)
            live_minutes_player_ids = {
                elem["id"] for elem in (live_data or {}).get("elements", [])
                if elem.get("stats", {}).get("minutes", 0) > 0
            }
            # Also include any player who already has stats for this gameweek so we don't drop DGW rows
            # (e.g. Arsenal DGW: live might not list them yet or we need to preserve two fixture rows)
            existing_stats_player_ids = set()
            # And include all players in tracked managers' picks so DGW players get stats written (two rows per fixture)
            picked_player_ids = set()
            if self.db_client and self.current_gameweek:
                try:
                    existing = self.db_client.client.table("player_gameweek_stats").select(
                        "player_id"
                    ).eq("gameweek", self.current_gameweek).execute().data or []
                    existing_stats_player_ids = {r["player_id"] for r in existing}
                except Exception:
                    pass
                try:
                    manager_ids = self._get_tracked_manager_ids()
                    if manager_ids:
                        picks_result = self.db_client.client.table("manager_picks").select(
                            "player_id"
                        ).eq("gameweek", self.current_gameweek).in_("manager_id", manager_ids).execute()
                        picked_player_ids = {p["player_id"] for p in (picks_result.data or [])}
                except Exception:
                    pass
            active_player_ids = live_minutes_player_ids | existing_stats_player_ids | picked_player_ids
            
            if active_player_ids and live_data:
                await self.player_refresher.refresh_player_gameweek_stats(
                    self.current_gameweek,
                    active_player_ids,
                    live_data=live_data,
                    fixtures=fixtures_by_gameweek,
                    bootstrap=bootstrap,
                    live_only=True  # Skip expected/ICT stats during live matches
                )
            return live_data
        except Exception as e:
            logger.error("Player refresh failed", extra={"error": str(e)}, exc_info=True)
            return None

    def _has_any_provisional_bonus(self, gameweek: int) -> bool:
        """True if any player_gameweek_stats row for this gameweek has bonus_status = 'provisional'."""
        if not gameweek or not self.db_client:
            return False
        try:
            result = self.db_client.client.table("player_gameweek_stats").select(
                "player_id", count="exact"
            ).eq("gameweek", gameweek).eq("bonus_status", "provisional").limit(1).execute()
            return (result.count or 0) > 0
        except Exception as e:
            logger.debug("Provisional bonus check failed", extra={"gameweek": gameweek, "error": str(e)})
            return True  # Assume still provisional on error so we retry

    async def _run_catch_up_player_refresh(
        self,
        bootstrap: Optional[Dict[str, Any]],
        fixtures_by_gameweek: Optional[Dict[int, Dict[str, Any]]],
    ) -> None:
        """
        After fixtures flip to finished=True, run one player refresh via element-summary to pull
        confirmed bonus. Repeat until no player has bonus_status = 'provisional' (then stop).
        """
        if not self.current_gameweek or not self.db_client or not self.player_refresher:
            return
        if self.current_gameweek in self._catch_up_done_gameweeks:
            return
        if not fixtures_by_gameweek:
            return
        # Run when at least one fixture is finished or finished_provisional (match done; pull BPS/bonus from element-summary)
        any_finished = any(
            f.get("finished") or f.get("finished_provisional") for f in fixtures_by_gameweek.values()
        )
        if not any_finished:
            return
        try:
            # Get player ids that have stats for this gameweek (so we refresh them via element-summary)
            stats_result = self.db_client.client.table("player_gameweek_stats").select(
                "player_id"
            ).eq("gameweek", self.current_gameweek).execute()
            player_ids = list({r["player_id"] for r in (stats_result.data or [])})

            # If no stats were collected during live (e.g. orchestrator wasn't running), backfill from
            # element-summary for all players in teams that have a finished/provisional fixture this gameweek.
            # This ensures the bonus subpage has BPS data for all matches.
            use_delta = True
            if not player_ids:
                team_ids = set()
                for f in fixtures_by_gameweek.values():
                    if f.get("finished") or f.get("finished_provisional"):
                        th, ta = f.get("team_h"), f.get("team_a")
                        if th is not None:
                            team_ids.add(th)
                        if ta is not None:
                            team_ids.add(ta)
                if not team_ids:
                    logger.debug("Catch-up: no finished fixtures, skip", extra={"gameweek": self.current_gameweek})
                    return
                players_result = self.db_client.client.table("players").select(
                    "fpl_player_id"
                ).in_("team_id", list(team_ids)).execute()
                player_ids = [r["fpl_player_id"] for r in (players_result.data or []) if r.get("fpl_player_id")]
                if not player_ids:
                    logger.debug("Catch-up: no players for teams in finished fixtures", extra={"gameweek": self.current_gameweek})
                    return
                use_delta = False
                logger.info(
                    "Catch-up backfill: no player_gameweek_stats for gameweek, fetching BPS for all players in finished fixtures (element-summary)",
                    extra={"gameweek": self.current_gameweek, "player_count": len(player_ids), "team_count": len(team_ids)},
                )
            else:
                logger.info("Catch-up player refresh (element-summary) for confirmed bonus", extra={
                    "gameweek": self.current_gameweek,
                    "player_count": len(player_ids),
                })
            await self.player_refresher.refresh_player_gameweek_stats(
                self.current_gameweek,
                set(player_ids),
                live_data=None,
                fixtures=fixtures_by_gameweek,
                bootstrap=bootstrap,
                live_only=True,
                expect_live_unavailable=True,
                use_delta=use_delta,
            )
            # After a backfill (no stats existed), refresh the fixtures MV so the API serves BPS for all matches
            if not use_delta:
                try:
                    self.db_client.refresh_materialized_view("mv_master_player_fixture_stats")
                except Exception as mv_err:
                    logger.warning("MV refresh after backfill failed", extra={"error": str(mv_err)})
            # Validation: stop when no player has provisional status
            if not self._has_any_provisional_bonus(self.current_gameweek):
                self._catch_up_done_gameweeks.add(self.current_gameweek)
                logger.info("Catch-up done: no player has provisional bonus", extra={"gameweek": self.current_gameweek})
        except Exception as e:
            logger.warning("Catch-up player refresh failed", extra={
                "gameweek": self.current_gameweek,
                "error": str(e),
            }, exc_info=True)

    def _update_fixture_scores_from_live(
        self,
        live_data: Dict[str, Any],
        bootstrap: Optional[Dict[str, Any]],
        fixtures_by_gameweek: Optional[Dict[int, Dict[str, Any]]],
    ) -> None:
        """
        Update fixture home_score, away_score and minutes from event-live (same source as GW points).
        - Scoreline: Fixtures API only (never event-live goals; DGW-safe). Only write when both scores present.
        - Minutes: max(api minutes, max player minutes, elapsed since kickoff). We always update minutes when
          we have live data so the clock never sticks; DB client enforces monotonicity (never decrease).
        """
        if not bootstrap or not fixtures_by_gameweek or not live_data.get("elements"):
            return
        now = datetime.now(timezone.utc)
        elements = bootstrap.get("elements", [])
        player_team = {int(e["id"]): int(e["team"]) for e in elements if "id" in e and "team" in e}
        for fpl_fixture_id, fixture in fixtures_by_gameweek.items():
            team_h = fixture.get("team_h")
            team_a = fixture.get("team_a")
            if team_h is None or team_a is None:
                continue
            max_minutes = 0
            for elem in live_data.get("elements", []):
                pid = elem.get("id")
                stats = elem.get("stats") or {}
                mins = stats.get("minutes", 0) or 0
                team_id = player_team.get(pid)
                if team_id == team_h or team_id == team_a:
                    if mins > max_minutes:
                        max_minutes = mins
            api_minutes = fixture.get("minutes") or 0
            # Floor: elapsed time since kickoff so we never show behind real time when FPL API lags
            elapsed_minutes = 0
            k = fixture.get("kickoff_time")
            if k:
                try:
                    kickoff = datetime.fromisoformat(k.replace("Z", "+00:00"))
                    if kickoff.tzinfo is None:
                        kickoff = kickoff.replace(tzinfo=timezone.utc)
                    if now >= kickoff:
                        elapsed_minutes = int((now - kickoff).total_seconds() / 60)
                        elapsed_minutes = min(elapsed_minutes, 120)  # cap at 120 for long stoppage
                except (ValueError, TypeError):
                    pass
            minutes_value = max(api_minutes, max_minutes, elapsed_minutes)
            if minutes_value <= 0:
                minutes_value = max(api_minutes, max_minutes)  # fallback without floor

            api_home = fixture.get("team_h_score")
            api_away = fixture.get("team_a_score")
            home_score = api_home if api_home is not None and api_away is not None else None
            away_score = api_away if api_home is not None and api_away is not None else None

            try:
                self.db_client.update_fixture_scores(
                    fpl_fixture_id,
                    home_score=home_score,
                    away_score=away_score,
                    minutes=minutes_value if minutes_value > 0 else None,
                )
            except Exception as e:
                logger.warning(
                    "Fixture score update failed",
                    extra={"fpl_fixture_id": fpl_fixture_id, "error": str(e)},
                )

    async def _refresh_prices(self):
        """Refresh player prices."""
        if not self.current_gameweek:
            return
        
        await self.player_refresher.refresh_player_prices(self.current_gameweek)
    
    async def _capture_baselines_if_needed(self):
        """
        Capture baselines if needed (post-deadline, pre-live).
        
        ⚠️ CRITICAL: This must run once per gameweek after deadline passes
        to preserve baseline data for delta calculations.
        """
        if not self.current_gameweek:
            return
        
        try:
            # Get current gameweek data
            gameweeks = self.db_client.get_gameweeks(gameweek_id=self.current_gameweek, limit=1)
            if not gameweeks:
                return
            
            current_gw = gameweeks[0]
            deadline_time = datetime.fromisoformat(
                current_gw["deadline_time"].replace("Z", "+00:00")
            )
            current_time = datetime.now(timezone.utc)
            
            # Check if we should capture baselines
            if self.baseline_capture.should_capture_baselines(
                self.current_gameweek,
                deadline_time,
                current_time
            ):
                logger.info("Capturing baselines", extra={"gameweek": self.current_gameweek})
                
                # Get all tracked managers (from mini leagues)
                result = await self.baseline_capture.capture_all_baselines_for_gameweek(
                    self.current_gameweek
                )
                
                logger.info("Baselines captured", extra={
                    "gameweek": self.current_gameweek,
                    **result
                })
        except Exception as e:
            logger.error("Baseline capture failed", extra={
                "gameweek": self.current_gameweek,
                "error": str(e)
            }, exc_info=True)
    
    def _get_tracked_manager_ids(self) -> List[int]:
        """
        Get all tracked manager IDs from mini_league_managers table.
        
        Returns:
            List of manager IDs
        """
        try:
            managers_result = self.db_client.client.table("mini_league_managers").select(
                "manager_id"
            ).execute()
            
            if not managers_result.data:
                return []
            
            manager_ids = list(set([m["manager_id"] for m in managers_result.data]))
            return manager_ids
            
        except Exception as e:
            logger.error("Tracked manager IDs failed", extra={"error": str(e)}, exc_info=True)
            return []
    
    def _get_active_manager_ids(self) -> List[int]:
        """
        Get manager IDs who have players currently playing in live matches.
        
        OPTIMIZATION: Only refresh managers with active players to reduce API calls.
        When no one has minutes > 0 yet (e.g. first kick-off), returns managers who
        have picks for this gameweek so we still limit scope instead of all tracked.
        
        Returns:
            List of manager IDs with active players (or with picks for this GW if none active yet)
        """
        try:
            # Get all managers with picks in current gameweek
            picks_result = self.db_client.client.table("manager_picks").select(
                "manager_id, player_id"
            ).eq("gameweek", self.current_gameweek).execute()
            
            if not picks_result.data:
                return []
            
            # Get active players (those with minutes > 0 in current gameweek)
            active_players_result = self.db_client.client.table("player_gameweek_stats").select(
                "player_id"
            ).eq("gameweek", self.current_gameweek).gt("minutes", 0).execute()
            
            active_player_ids = set([p["player_id"] for p in active_players_result.data])
            
            # Find managers who have at least one active player
            active_manager_ids = set()
            for pick in picks_result.data:
                if pick["player_id"] in active_player_ids:
                    active_manager_ids.add(pick["manager_id"])
            
            if active_manager_ids:
                return list(active_manager_ids)
            
            # No one has minutes > 0 yet (e.g. first kick-off, or picks not backfilled).
            # Fallback: managers who have picks for this GW (smaller than all tracked).
            managers_with_picks = list(set([p["manager_id"] for p in picks_result.data]))
            return managers_with_picks
            
        except Exception as e:
            logger.error("Active managers check failed", extra={"error": str(e)}, exc_info=True)
            # Fallback: return all tracked managers if error
            return self._get_tracked_manager_ids()
    
    def _is_end_of_gameday(self) -> bool:
        """
        True when at least one fixture for the current gameweek has finished_provisional
        (at least one matchday has ended; ranks may be available from FPL after each day).
        Allows multiple rank-refresh cycles per gameweek (Sat, Sun, Mon, midweek).
        """
        if not self.current_gameweek or not self.db_client:
            return False
        try:
            fixtures = self.db_client.client.table("fixtures").select(
                "finished_provisional"
            ).eq("gameweek", self.current_gameweek).execute().data
            if not fixtures:
                return False
            return any(f.get("finished_provisional") for f in fixtures)
        except Exception as e:
            logger.debug("End-of-gameday check failed", extra={"error": str(e)})
            return False

    async def _refresh_manager_points(self, force_all_managers: bool = False):
        """
        Refresh manager gameweek history (points, ranks) for all tracked managers.
        
        ⚠️ CRITICAL: This applies auto-subs progressively as matches finish.
        Auto-subs are only applied when a player's match finishes, so we need
        to recalculate manager points during live matches to capture auto-subs.
        
        ⚠️ CRITICAL: This preserves baseline data (baseline_total_points, previous ranks)
        during live updates. Baselines are only set by baseline_capture module.
        
        Args:
            force_all_managers: If True, always refresh all tracked managers (e.g. when
                ranks have just finalized); otherwise use active-only during live.
        """
        if not self.current_gameweek:
            return
        
        try:
            # When ranks finalize we refresh all managers; otherwise use all tracked during live
            # so league standings GW points stay current (player stats roll up to manager_gameweek_history)
            if force_all_managers or self.current_state in (RefreshState.LIVE_MATCHES, RefreshState.BONUS_PENDING):
                manager_ids = self._get_tracked_manager_ids()
                if manager_ids:
                    logger.info("Refreshing manager points", extra={
                        "count": len(manager_ids),
                        "gameweek": self.current_gameweek,
                        "reason": "ranks_final" if force_all_managers else "live"
                    })
            else:
                # Outside live matches, refresh all managers
                manager_ids = self._get_tracked_manager_ids()
                logger.info("Refreshing all manager points", extra={
                    "count": len(manager_ids),
                    "gameweek": self.current_gameweek
                })
            
            if not manager_ids:
                logger.debug("No managers to refresh", extra={
                    "gameweek": self.current_gameweek
                })
                return
            
            # Refresh managers in parallel batches (batch size and sleep configurable for rate-limit tuning)
            batch_size = self.config.manager_points_batch_size
            batch_sleep = self.config.manager_points_batch_sleep_seconds
            total_batches = (len(manager_ids) + batch_size - 1) // batch_size
            rate_limit_events = 0

            for batch_num in range(0, len(manager_ids), batch_size):
                batch = manager_ids[batch_num:batch_num + batch_size]
                batch_index = (batch_num // batch_size) + 1

                logger.debug(
                    "Manager points batch start",
                    extra={
                        "batch": batch_index,
                        "total_batches": total_batches,
                        "batch_size": len(batch),
                        "gameweek": self.current_gameweek,
                    },
                )

                tasks = [
                    self.manager_refresher.refresh_manager_gameweek_history(
                        manager_id,
                        self.current_gameweek
                    )
                    for manager_id in batch
                ]
                results = await asyncio.gather(*tasks, return_exceptions=True)

                for manager_id, result in zip(batch, results):
                    if isinstance(result, Exception):
                        if isinstance(result, FPLAPIRateLimitError):
                            rate_limit_events += 1
                            logger.warning(
                                "Manager points refresh rate limited (429)",
                                extra={
                                    "manager_id": manager_id,
                                    "gameweek": self.current_gameweek,
                                    "rate_limit_events_so_far": rate_limit_events,
                                },
                            )
                        logger.error("Manager points refresh failed", extra={
                            "manager_id": manager_id,
                            "gameweek": self.current_gameweek,
                            "error": str(result)
                        }, exc_info=True)

                logger.debug(
                    "Manager points batch completed",
                    extra={
                        "batch": batch_index,
                        "total_batches": total_batches,
                        "rate_limit_events_so_far": rate_limit_events,
                    },
                )

                if batch_num + batch_size < len(manager_ids) and batch_sleep > 0:
                    await asyncio.sleep(batch_sleep)
                if (batch_index % 5) == 0:
                    try:
                        self.db_client.insert_refresh_event("slow")
                    except Exception:
                        pass

            if rate_limit_events > 0:
                logger.warning(
                    "Manager points refresh finished with rate limit events; consider increasing MANAGER_POINTS_BATCH_SLEEP_SECONDS or reducing MANAGER_POINTS_BATCH_SIZE",
                    extra={
                        "gameweek": self.current_gameweek,
                        "rate_limit_events": rate_limit_events,
                        "batch_size": batch_size,
                        "batch_sleep_seconds": batch_sleep,
                    },
                )
            else:
                logger.debug(
                    "Manager points refresh completed with no rate limit events (safe to remove debug logging if stable)",
                    extra={"gameweek": self.current_gameweek},
                )
            
            # Recalculate mini-league ranks only when at least one fixture has started (or GW finished).
            # Before any kickoff, ranks stay at deadline order; recalc would use same totals but can overwrite.
            any_fixture_started = False
            try:
                fixtures = self.db_client.client.table("fixtures").select("started").eq(
                    "gameweek", self.current_gameweek
                ).execute().data
                any_fixture_started = any(f.get("started", False) for f in (fixtures or []))
            except Exception:
                pass
            if any_fixture_started:
                leagues_result = self.db_client.client.table("mini_leagues").select(
                    "league_id"
                ).execute()
                for league in leagues_result.data:
                    try:
                        await self.manager_refresher.calculate_mini_league_ranks(
                            league["league_id"],
                            self.current_gameweek
                        )
                    except Exception as e:
                        logger.error("League ranks failed", extra={
                            "league_id": league["league_id"],
                            "gameweek": self.current_gameweek,
                            "error": str(e)
                        }, exc_info=True)
            else:
                logger.debug("Skipping league rank recalc (no fixture started)", extra={
                    "gameweek": self.current_gameweek
                })
            
        except Exception as e:
            logger.error("Manager points refresh failed", extra={
                "gameweek": self.current_gameweek,
                "error": str(e)
            }, exc_info=True)
    
    async def _check_ranks_final_and_refresh(self):
        """
        At end of gameday (all fixtures finished_provisional), ensure we capture rank update:
        (1) If gameweek.data_checked is true, set fpl_ranks_updated and refresh all managers.
        (2) Else poll one manager for rank change (throttled); when detected, refresh all managers.
        Uses fixtures table to gate: runs when at least one fixture has finished_provisional (after each matchday).
        """
        if not self.current_gameweek or not self._is_end_of_gameday():
            return
        try:
            gameweeks = self.db_client.get_gameweeks(gameweek_id=self.current_gameweek, limit=1)
            if not gameweeks:
                return
            gw = gameweeks[0]
            if gw.get("fpl_ranks_updated"):
                return
            if gw.get("data_checked"):
                logger.info("Gameweek data_checked true, refreshing all managers for ranks", extra={
                    "gameweek": self.current_gameweek
                })
                await self._refresh_manager_points(force_all_managers=True)
                self.db_client.update_gameweek_fpl_ranks_updated(self.current_gameweek, True)
                logger.info("fpl_ranks_updated set (data_checked)", extra={"gameweek": self.current_gameweek})
                return
            await self._check_fpl_rank_change_and_refresh(force_all_managers=True)
        except Exception as e:
            logger.error("Ranks final check failed", extra={
                "gameweek": self.current_gameweek,
                "error": str(e)
            }, exc_info=True)

    async def _check_fpl_rank_change_and_refresh(self, force_all_managers: bool = False):
        """
        Poll FPL API for one manager to see if overall_rank/gameweek_rank have been updated.
        When detected, set fpl_ranks_updated and trigger full manager refresh so frontend
        can drop the stale indicator. Throttled to run at most every 5 minutes.
        """
        if not self.current_gameweek:
            return
        try:
            gameweeks = self.db_client.get_gameweeks(gameweek_id=self.current_gameweek, limit=1)
            if not gameweeks or gameweeks[0].get("fpl_ranks_updated"):
                return
            now = datetime.now(timezone.utc)
            if (
                self._last_rank_check_gameweek == self.current_gameweek
                and self._last_rank_check_time is not None
                and (now - self._last_rank_check_time).total_seconds() < self._rank_check_interval_seconds
            ):
                return
            manager_ids = self._get_tracked_manager_ids()
            if not manager_ids:
                return
            self._last_rank_check_time = now
            self._last_rank_check_gameweek = self.current_gameweek
            sample_manager_id = manager_ids[0]
            rank_changed = await self.manager_refresher.check_fpl_rank_change(
                sample_manager_id, self.current_gameweek
            )
            if rank_changed:
                logger.info("FPL ranks updated, refreshing all managers", extra={"gameweek": self.current_gameweek})
                self.db_client.update_gameweek_fpl_ranks_updated(self.current_gameweek, True)
                logger.info("fpl_ranks_updated set (rank-change poll)", extra={"gameweek": self.current_gameweek})
                await self._refresh_manager_points(force_all_managers=force_all_managers)
        except Exception as e:
            logger.error("FPL rank check failed", extra={"gameweek": self.current_gameweek, "error": str(e)}, exc_info=True)
    
    async def _validate_player_points_integrity(self):
        """
        Validate that manager total points equals sum of player starting points + transfer costs.
        
        This ensures data integrity: Manager Total = Sum(Player Starting Points) + Transfer Costs
        Bench points (regular or Bench Boost) are NOT included in manager total.
        """
        try:
            manager_ids = self._get_tracked_manager_ids()
            
            if not manager_ids:
                return
            
            # Check validation for all managers using the view
            validation_result = self.db_client.client.table("v_manager_points_validation").select(
                "manager_id, manager_name, manager_total_points, sum_player_starting_points, transfer_costs, difference, is_valid"
            ).in_("manager_id", manager_ids).execute()
            
            invalid_managers = []
            for row in validation_result.data or []:
                if not row.get("is_valid", True):
                    invalid_managers.append({
                        "manager_id": row.get("manager_id"),
                        "manager_name": row.get("manager_name"),
                        "difference": row.get("difference", 0)
                    })
            
            if invalid_managers:
                n, total = len(invalid_managers), len(manager_ids)
                logger.warning("Points mismatch: %s of %s managers", n, total, extra={
                    "invalid_count": n,
                    "total_checked": total,
                    "sample": invalid_managers[:3]
                })
            else:
                logger.debug("Points validation OK", extra={"checked": len(manager_ids)})
                
        except Exception as e:
            logger.error("Points validation failed", extra={"error": str(e)}, exc_info=True)
    
    def _is_likely_live_window(self) -> bool:
        """
        True when we're in IDLE but current time is past the earliest kickoff of the current gameweek.
        Ensures we keep using fast_loop_interval so we quickly get started=true from FPL and
        transition to LIVE_MATCHES (avoids stale 'Since backend' when DB is behind real kickoffs).
        """
        if not self.current_gameweek or not self.db_client:
            return False
        try:
            fixtures = self.db_client.client.table("fixtures").select(
                "kickoff_time"
            ).eq("gameweek", self.current_gameweek).execute().data
            if not fixtures:
                return False
            now = datetime.now(timezone.utc)
            for f in fixtures:
                k = f.get("kickoff_time")
                if not k:
                    continue
                try:
                    kickoff = datetime.fromisoformat(k.replace("Z", "+00:00"))
                    if kickoff.tzinfo is None:
                        kickoff = kickoff.replace(tzinfo=timezone.utc)
                    if now >= kickoff - timedelta(minutes=self.config.kickoff_window_minutes):
                        return True
                except (ValueError, TypeError):
                    continue
            return False
        except Exception as e:
            logger.debug("Likely live window check failed", extra={"error": str(e)})
            return False

    def _get_idle_sleep_seconds(self) -> int:
        """
        When state is IDLE, return sleep seconds so we run at least once before/during the
        kickoff window. Uses next (future) kickoff to cap sleep and avoid skipping the window.
        Considers both current and next gameweek so we use short interval when next GW's first
        match has kicked off (FPL may not have set is_current yet).
        When in gameweek, never exceed max_idle_sleep_seconds so we match API cadence (~1 min).
        """
        if self._is_in_kickoff_window() or self._is_likely_live_window():
            return self.config.fast_loop_interval_live
        default_sleep = self.config.gameweeks_refresh_interval
        if not self.current_gameweek or not self.db_client:
            return default_sleep
        # When in gameweek, cap so we never sleep > max_idle_sleep (match API update cadence)
        def cap_for_gameweek(s: int) -> int:
            if s > self.config.max_idle_sleep_seconds:
                return self.config.max_idle_sleep_seconds
            return s
        try:
            next_kickoff_raw = self.db_client.get_next_kickoff_for_gameweek(self.current_gameweek)
            # If no future kickoff in current GW, check next gameweek (first match may have kicked off)
            if not next_kickoff_raw:
                next_gws = self.db_client.get_gameweeks(is_next=True, limit=1)
                if next_gws:
                    next_gw_id = next_gws[0]["id"]
                    first_kickoff_raw = self.db_client.get_first_kickoff_for_gameweek(next_gw_id)
                    if first_kickoff_raw:
                        first_kickoff = datetime.fromisoformat(first_kickoff_raw.replace("Z", "+00:00"))
                        if first_kickoff.tzinfo is None:
                            first_kickoff = first_kickoff.replace(tzinfo=timezone.utc)
                        if datetime.now(timezone.utc) >= first_kickoff:
                            return self.config.fast_loop_interval_live
                    next_kickoff_raw = self.db_client.get_next_kickoff_for_gameweek(next_gw_id)
            if not next_kickoff_raw:
                return cap_for_gameweek(default_sleep)
            kickoff = datetime.fromisoformat(next_kickoff_raw.replace("Z", "+00:00"))
            if kickoff.tzinfo is None:
                kickoff = kickoff.replace(tzinfo=timezone.utc)
            now = datetime.now(timezone.utc)
            seconds_until = (kickoff - now).total_seconds()
            if seconds_until <= 0:
                return self.config.fast_loop_interval_live
            window_sec = self.config.kickoff_window_minutes * 60
            if seconds_until <= window_sec:
                return self.config.fast_loop_interval_live
            # Cap sleep so we wake before/during the kickoff window
            sleep_sec = int(seconds_until - window_sec)
            sleep_sec = max(self.config.fast_loop_interval_live, min(
                self.config.gameweeks_refresh_interval,
                sleep_sec,
            ))
            return cap_for_gameweek(sleep_sec)
        except Exception as e:
            logger.debug("Idle sleep calculation failed", extra={"error": str(e)})
            return cap_for_gameweek(default_sleep)

    async def _fast_cycle(self):
        """Execute fast refresh cycle (gameweeks, state, fixtures, players when live). No manager points or MVs in live - those run in slow loop."""
        try:
            # Heartbeat at start so "Since backend" stays current when cycle runs (even if cycle later blocks)
            try:
                self.db_client.insert_refresh_event("fast")
            except Exception as ev:
                logger.debug("Refresh event (start) insert failed", extra={"path": "fast", "error": str(ev)})
            # Phase 1: Always refresh foundational tables first (reuse bootstrap for player refresh)
            t0 = datetime.now(timezone.utc)
            bootstrap = await self._refresh_gameweeks()
            if bootstrap is not None:
                duration_ms = int((datetime.now(timezone.utc) - t0).total_seconds() * 1000)
                try:
                    self.db_client.insert_refresh_duration_log("gameweeks", "fast", self.current_state.value, duration_ms)
                except Exception:
                    pass
            # Detect current state
            new_state = await self._detect_state()
            if new_state != self.current_state:
                logger.info("State transition", extra={
                    "from": self.current_state.value,
                    "to": new_state.value
                })
                if new_state == RefreshState.LIVE_MATCHES and self.current_state != RefreshState.LIVE_MATCHES:
                    logger.info("First fixture started, entering LIVE_MATCHES", extra={"gameweek": self.current_gameweek})
                # When leaving live, reset standings throttle so next time we enter live we run standings on first cycle
                if self.current_state in (RefreshState.LIVE_MATCHES, RefreshState.BONUS_PENDING) and new_state not in (RefreshState.LIVE_MATCHES, RefreshState.BONUS_PENDING):
                    self._last_live_standings_in_fast_cycle = None
                # If transitioning away from TRANSFER_DEADLINE, reset tracking flags
                if self.current_state == RefreshState.TRANSFER_DEADLINE:
                    logger.info("Exiting deadline state", extra={
                        "refresh_done": self.deadline_refresh_completed,
                        "new_state": new_state.value
                    })
                    # Reset flags for next deadline window
                    self.deadline_refresh_completed = False
                    self._deadline_batch_first_run_time = None
                    self.next_gameweek_id_before_deadline = None
                    self._deadline_target_gameweek_id = None
                    self.previous_gameweek_state = None
                
                self.current_state = new_state

            # Keep player_prices and players.cost_tenths / selected_by_percent populated from bootstrap so UI always has current price and overall ownership
            if bootstrap and self.player_refresher:
                self.player_refresher.sync_players_ownership_from_bootstrap(bootstrap)
            if bootstrap and self.current_gameweek and self.player_refresher:
                self.player_refresher.sync_player_prices_from_bootstrap(bootstrap, self.current_gameweek)
            
            # Phase 2 and 3: fixtures and players. Live path uses parallel fetch and early fixture score write.
            fixtures_by_gameweek = None
            if self.current_state in (RefreshState.LIVE_MATCHES, RefreshState.BONUS_PENDING) and self.current_gameweek:
                # Live path: fetch fixtures and event-live in parallel; write fixture scores immediately; then refresh players with pre-fetched live_data
                t1 = datetime.now(timezone.utc)
                fixtures_coro = self.fpl_client.get_fixtures()
                live_coro = self.fpl_client.get_event_live(self.current_gameweek)
                results = await asyncio.gather(fixtures_coro, live_coro, return_exceptions=True)
                fixtures_list = results[0] if not isinstance(results[0], Exception) else []
                live_data = results[1] if not isinstance(results[1], Exception) else None
                if isinstance(results[0], Exception):
                    logger.warning("Parallel fixtures fetch failed", extra={"error": str(results[0])})
                if isinstance(results[1], Exception):
                    logger.warning("Parallel event-live fetch failed", extra={"error": str(results[1])})
                gw_ids_to_refresh = []
                if self.current_gameweek:
                    gw_ids_to_refresh.append(self.current_gameweek)
                next_gws = self.db_client.get_gameweeks(is_next=True, limit=1)
                if next_gws and next_gws[0]["id"] not in gw_ids_to_refresh:
                    gw_ids_to_refresh.append(next_gws[0]["id"])
                fixtures_by_gameweek = self._apply_fixtures_to_db(fixtures_list or [], gw_ids_to_refresh)
                duration_ms = int((datetime.now(timezone.utc) - t1).total_seconds() * 1000)
                try:
                    self.db_client.insert_refresh_duration_log("fixtures", "fast", self.current_state.value, duration_ms)
                except Exception:
                    pass
                # Write fixture scores from event-live immediately so match page updates before player processing
                if live_data and bootstrap and fixtures_by_gameweek:
                    self._update_fixture_scores_from_live(live_data, bootstrap, fixtures_by_gameweek)
                t2 = datetime.now(timezone.utc)
                live_data_out = await self._refresh_players(
                    bootstrap=bootstrap,
                    fixtures_by_gameweek=fixtures_by_gameweek,
                    live_data=live_data,
                )
                duration_ms = int((datetime.now(timezone.utc) - t2).total_seconds() * 1000)
                try:
                    self.db_client.insert_refresh_duration_log("gw_players", "fast", self.current_state.value, duration_ms)
                except Exception:
                    pass
                # Live standings: when live_data is available use in-memory path (every cycle).
                # When live_data is missing fall back to DB path and throttle by interval.
                now_utc = datetime.now(timezone.utc)
                use_live_data_path = live_data is not None and fixtures_by_gameweek is not None
                interval_sec = self.config.live_standings_in_fast_interval_seconds
                if use_live_data_path:
                    should_run_standings = True
                else:
                    should_run_standings = (
                        self._last_live_standings_in_fast_cycle is None
                        or (now_utc - self._last_live_standings_in_fast_cycle).total_seconds() >= interval_sec
                    )
                if should_run_standings:
                    try:
                        t_live_standings = datetime.now(timezone.utc)
                        manager_ids = self._get_tracked_manager_ids()
                        all_managers_updated = True
                        if manager_ids and self.current_gameweek:
                            if use_live_data_path:
                                logger.info(
                                    "Manager points from live_data",
                                    extra={"gameweek": self.current_gameweek, "count": len(manager_ids)},
                                )
                                all_managers_updated = await self.manager_refresher.refresh_manager_gameweek_points_from_live_data(
                                    manager_ids,
                                    self.current_gameweek,
                                    live_data,
                                    fixtures_by_gameweek,
                                )
                            else:
                                logger.info(
                                    "Manager points from DB (live_data unavailable)",
                                    extra={"gameweek": self.current_gameweek, "count": len(manager_ids)},
                                )
                                all_managers_updated = await self.manager_refresher.refresh_manager_gameweek_points_live_only(
                                    manager_ids, self.current_gameweek
                                )
                            any_fixture_started = False
                            try:
                                fixtures = self.db_client.client.table("fixtures").select("started").eq(
                                    "gameweek", self.current_gameweek
                                ).execute().data
                                any_fixture_started = any(f.get("started", False) for f in (fixtures or []))
                            except Exception:
                                pass
                            if any_fixture_started:
                                leagues_result = self.db_client.client.table("mini_leagues").select("league_id").execute()
                                for league in (leagues_result.data or []):
                                    try:
                                        await self.manager_refresher.calculate_mini_league_ranks(
                                            league["league_id"], self.current_gameweek
                                        )
                                    except Exception as e:
                                        logger.error("League ranks failed", extra={
                                            "league_id": league["league_id"],
                                            "gameweek": self.current_gameweek,
                                            "error": str(e),
                                        }, exc_info=True)
                            # Only refresh standings MV when all managers updated so we don't show incomplete data
                            if all_managers_updated:
                                self.db_client.refresh_materialized_views_for_live()
                        self._last_live_standings_in_fast_cycle = datetime.now(timezone.utc)
                        duration_ms = int((datetime.now(timezone.utc) - t_live_standings).total_seconds() * 1000)
                        try:
                            self.db_client.insert_refresh_duration_log("live_standings", "fast", self.current_state.value, duration_ms)
                        except Exception:
                            pass
                    except Exception as e:
                        logger.warning("Live standings update failed", extra={"error": str(e)}, exc_info=True)
            else:
                # Non-live: Phase 2 fixtures only, then catch-up if applicable
                t1 = datetime.now(timezone.utc)
                fixtures_by_gameweek = await self._refresh_fixtures()
                if fixtures_by_gameweek is not None or self.current_gameweek:
                    duration_ms = int((datetime.now(timezone.utc) - t1).total_seconds() * 1000)
                    try:
                        self.db_client.insert_refresh_duration_log("fixtures", "fast", self.current_state.value, duration_ms)
                    except Exception:
                        pass
                # Re-detect state after refreshing fixtures so we transition to LIVE_MATCHES in the same
                # cycle we get started=true from FPL (otherwise we stay IDLE until the next cycle).
                new_state_after_fixtures = await self._detect_state()
                if new_state_after_fixtures != self.current_state:
                    logger.info("State transition (after fixtures refresh)", extra={
                        "from": self.current_state.value,
                        "to": new_state_after_fixtures.value,
                    })
                    if new_state_after_fixtures == RefreshState.LIVE_MATCHES:
                        logger.info("First fixture started, entering LIVE_MATCHES", extra={"gameweek": self.current_gameweek})
                    if self.current_state in (RefreshState.LIVE_MATCHES, RefreshState.BONUS_PENDING) and new_state_after_fixtures not in (RefreshState.LIVE_MATCHES, RefreshState.BONUS_PENDING):
                        self._last_live_standings_in_fast_cycle = None
                    self.current_state = new_state_after_fixtures
                # Catch-up: when fixtures finished but we stopped normal refresh, pull confirmed bonus via element-summary
                t2 = datetime.now(timezone.utc)
                await self._run_catch_up_player_refresh(
                    bootstrap=bootstrap,
                    fixtures_by_gameweek=fixtures_by_gameweek,
                )
                duration_ms = int((datetime.now(timezone.utc) - t2).total_seconds() * 1000)
                if duration_ms > 0:
                    try:
                        self.db_client.insert_refresh_duration_log("gw_players", "fast", self.current_state.value, duration_ms)
                    except Exception:
                        pass
            # Record fast refresh after core work (gameweeks, fixtures, players) so debug panel
            # updates even when this cycle is stuck in a long block (e.g. TRANSFER_DEADLINE batch).
            try:
                self.db_client.insert_refresh_event("fast")
            except Exception as ev:
                logger.debug("Refresh event insert failed", extra={"path": "fast", "error": str(ev)})
            
            if self.current_state == RefreshState.PRICE_WINDOW:
                await self._refresh_prices()
            
            now_utc = datetime.now(timezone.utc)
            # After price window closes: run manager refresh once per day to capture post–price-change team value
            if self._is_after_price_window_cooldown(now_utc):
                today = now_utc.date()
                if self._post_price_window_refresh_done_date is None or self._post_price_window_refresh_done_date != today:
                    logger.info("Post–price window cooldown: refreshing all managers for team value", extra={"date": str(today)})
                    try:
                        self.db_client.clear_price_change_predictions()
                        logger.info("Cleared price_change_predictions after price window close", extra={"date": str(today)})
                    except Exception as e:
                        logger.warning("Clear price_change_predictions failed", extra={"error": str(e)}, exc_info=True)
                    try:
                        await self._refresh_manager_points(force_all_managers=True)
                        self._post_price_window_refresh_done_date = today
                    except Exception as e:
                        logger.warning("Post–price window manager refresh failed", extra={"error": str(e)}, exc_info=True)
            
            # Rank monitoring: after last game of the match day, poll FPL every 15 min for up to 5 hours
            if fixtures_by_gameweek and self.current_gameweek:
                fixture_list = list(fixtures_by_gameweek.values())
                if self._is_last_match_of_today_finished(fixture_list):
                    today = now_utc.date()
                    if self._rank_monitor_day_started is None or self._rank_monitor_day_started != today:
                        self._rank_monitor_day_started = today
                        self._rank_monitor_window_end = now_utc + timedelta(hours=self.config.rank_monitor_hours_after_last_matchday)
                        logger.info("Rank monitor window started (last match of day finished)", extra={
                            "gameweek": self.current_gameweek,
                            "window_end": self._rank_monitor_window_end.isoformat(),
                        })
                if self._should_run_rank_monitor_check():
                    logger.debug("Rank monitor: polling FPL for rank updates", extra={"gameweek": self.current_gameweek})
                    try:
                        await self._check_fpl_rank_change_and_refresh(force_all_managers=True)
                        self._last_rank_check_time = now_utc
                    except Exception as e:
                        logger.warning("Rank monitor check failed", extra={"error": str(e)}, exc_info=True)
            
            if self.current_state == RefreshState.TRANSFER_DEADLINE:
                # Post-deadline refresh: runs only after 30+ min past deadline and when target GW is is_current
                # (API freeze released). Bootstrap check confirms API is responsive before we run.
                # Refreshes picks, transfers, baselines, whitelist for all managers in all tracked leagues
                # (mini_league_managers) plus REQUIRED_MANAGER_IDS. Sets up the gameweek that just passed (e.g. GW27).
                # Run batch only when target gameweek is now is_current (trigger on flip).
                now_utc = datetime.now(timezone.utc)
                gameweeks = self.db_client.get_gameweeks(is_current=True, limit=1)
                if not gameweeks:
                    logger.warning("No current gameweek for deadline check")
                else:
                    current_gw = gameweeks[0]
                    target_gw_id = self._deadline_target_gameweek_id
                    # Persisted check: skip if we already completed a successful batch for this GW (survives restart)
                    if target_gw_id is not None and current_gw["id"] == target_gw_id and self.db_client.has_successful_deadline_batch_for_gameweek(target_gw_id):
                        self.deadline_refresh_completed = True
                        logger.info("Deadline batch already completed for this gameweek (persisted), skipping", extra={"gameweek": target_gw_id})
                    should_run = (
                        target_gw_id is not None
                        and current_gw["id"] == target_gw_id
                        and not self.deadline_refresh_completed
                    )
                    if should_run:
                        logger.info(
                            "Target gameweek is now is_current; running deadline batch (critical: this is the GW value we were watching for)",
                            extra={"target_gameweek": target_gw_id, "current_gw_id": current_gw["id"], "gameweek_name": current_gw.get("name")},
                        )
                        self._deadline_batch_ran_this_cycle = False
                        self.current_gameweek = target_gw_id  # Use new GW for all batch steps
                        manager_ids = self._get_tracked_manager_ids()
                        # Include all required (e.g. app-configured) managers so every configured manager/league gets picks
                        if self.config.required_manager_ids:
                            extra = [mid for mid in self.config.required_manager_ids if mid not in manager_ids]
                            if extra:
                                manager_ids = list(manager_ids) + extra
                        league_count = 0
                        leagues_result = type("_Res", (), {"data": []})()  # default empty
                        try:
                            leagues_result = self.db_client.client.table("mini_leagues").select("league_id").execute()
                            league_count = len(leagues_result.data) if leagues_result.data else 0
                        except Exception:
                            pass
                        run_id = self.db_client.insert_deadline_batch_start(target_gw_id)
                        logger.info(
                            "Post-deadline refresh: running for GW that just passed (all configured managers and leagues) after API release check",
                            extra={
                                "gameweek": target_gw_id,
                                "manager_count": len(manager_ids),
                                "league_count": league_count,
                            },
                        )
                        first_kickoff = self.db_client.get_first_kickoff_for_gameweek(target_gw_id)
                        if first_kickoff:
                            try:
                                kickoff_dt = datetime.fromisoformat(first_kickoff.replace("Z", "+00:00"))
                                if kickoff_dt.tzinfo is None:
                                    kickoff_dt = kickoff_dt.replace(tzinfo=timezone.utc)
                                mins_until = (kickoff_dt - now_utc).total_seconds() / 60
                                logger.info("Deadline batch: first kickoff", extra={
                                    "gameweek": target_gw_id,
                                    "first_kickoff_utc": first_kickoff,
                                    "minutes_until_first_kickoff": round(mins_until, 1),
                                })
                            except (ValueError, TypeError):
                                pass
                        phase = {}
                        t0 = datetime.now(timezone.utc)
                        bootstrap_ok = await self._short_bootstrap_check()
                        phase["bootstrap_check_sec"] = round((datetime.now(timezone.utc) - t0).total_seconds(), 1)
                        if not bootstrap_ok and run_id is not None:
                            phase["failure_reason"] = "bootstrap_failed"
                            self.db_client.update_deadline_batch_finish(
                                run_id,
                                finished_at=datetime.now(timezone.utc).isoformat(),
                                duration_seconds=(datetime.now(timezone.utc) - t0).total_seconds(),
                                manager_count=len(manager_ids) if manager_ids else 0,
                                league_count=league_count,
                                success=False,
                                phase_breakdown=phase,
                            )
                        elif not bootstrap_ok:
                            pass  # No run_id, skip
                        elif manager_ids:
                            settle_sec = min(self.config.post_deadline_settle_seconds, 60)
                            if settle_sec > 0:
                                logger.info("Settling before deadline batch", extra={"settle_seconds": settle_sec})
                                await asyncio.sleep(settle_sec)
                            phase["settle_sec"] = settle_sec
                            t1 = datetime.now(timezone.utc)
                            batch_size = self.config.deadline_batch_size
                            batch_sleep = self.config.deadline_batch_sleep_seconds
                            deadline_time = None
                            if current_gw.get("deadline_time"):
                                deadline_time = datetime.fromisoformat(
                                    current_gw["deadline_time"].replace("Z", "+00:00")
                                )
                            # Fetch bootstrap once for all managers (avoids 60 duplicate fetches in transfers)
                            shared_bootstrap = await self.fpl_client.get_bootstrap_static()
                            failed_managers = set()
                            picks_metadata = {}  # manager_id -> {active_chip, gameweek_rank} from picks phase
                            for batch_num in range(0, len(manager_ids), batch_size):
                                batch = manager_ids[batch_num : batch_num + batch_size]
                                tasks = []
                                for mid in batch:
                                    tasks.append(
                                        self.manager_refresher.refresh_manager_picks(
                                            mid, target_gw_id, deadline_time=deadline_time, use_cache=False
                                        )
                                    )
                                    tasks.append(self.manager_refresher.refresh_manager_transfers(mid, target_gw_id, bootstrap=shared_bootstrap))
                                results = await asyncio.gather(*tasks, return_exceptions=True)
                                for i, res in enumerate(results):
                                    if i % 2 == 0:
                                        mid = batch[i // 2]
                                        if isinstance(res, Exception):
                                            failed_managers.add(mid)
                                            logger.error("Manager picks/transfers failed", extra={
                                                "manager_id": mid, "gameweek": target_gw_id, "error": str(res)
                                            })
                                        elif isinstance(res, dict):
                                            picks_metadata[mid] = {"active_chip": res.get("active_chip"), "gameweek_rank": res.get("gameweek_rank")}
                                if batch_num + batch_size < len(manager_ids) and batch_sleep > 0:
                                    await asyncio.sleep(batch_sleep)
                            success_count = len(manager_ids) - len(failed_managers)
                            success_rate = (success_count / len(manager_ids)) * 100 if manager_ids else 0
                            phase["picks_and_transfers_sec"] = round((datetime.now(timezone.utc) - t1).total_seconds(), 1)
                            if success_rate >= 80:
                                t2 = datetime.now(timezone.utc)
                                # Fast path: seed history from previous GW (no FPL history/picks API calls)
                                self.manager_refresher.seed_manager_gameweek_history_from_previous(
                                    manager_ids, target_gw_id, picks_metadata
                                )
                                for league in (leagues_result.data or []):
                                    try:
                                        await self.manager_refresher.calculate_mini_league_ranks(
                                            league["league_id"], target_gw_id
                                        )
                                    except Exception as e:
                                        logger.warning("Mini league ranks failed", extra={"league_id": league["league_id"], "error": str(e)})
                                phase["history_refresh_sec"] = round((datetime.now(timezone.utc) - t2).total_seconds(), 1)
                                t3 = datetime.now(timezone.utc)
                                await self._capture_baselines_if_needed()
                                phase["baselines_sec"] = round((datetime.now(timezone.utc) - t3).total_seconds(), 1)
                                t4 = datetime.now(timezone.utc)
                                for league in (leagues_result.data or []):
                                    try:
                                        await self.manager_refresher.build_player_whitelist(
                                            league["league_id"], target_gw_id
                                        )
                                    except Exception as e:
                                        logger.error("Player whitelist failed", extra={"league_id": league["league_id"], "error": str(e)})
                                phase["whitelist_sec"] = round((datetime.now(timezone.utc) - t4).total_seconds(), 1)
                                t5 = datetime.now(timezone.utc)
                                try:
                                    self.db_client.refresh_league_transfer_aggregation()
                                except Exception as mv_err:
                                    logger.warning("League transfer aggregation failed", extra={"error": str(mv_err)})
                                phase["transfer_aggregation_sec"] = round((datetime.now(timezone.utc) - t5).total_seconds(), 1)
                                t6 = datetime.now(timezone.utc)
                                try:
                                    self.db_client.refresh_all_materialized_views()
                                except Exception as e:
                                    logger.error("Materialized views refresh failed", extra={"error": str(e)})
                                phase["materialized_views_sec"] = round((datetime.now(timezone.utc) - t6).total_seconds(), 1)
                                self._deadline_batch_ran_this_cycle = True
                                self.deadline_refresh_completed = True
                                finished_at = datetime.now(timezone.utc)
                                duration_sec = (finished_at - t0).total_seconds()
                                if run_id is not None:
                                    self.db_client.update_deadline_batch_finish(
                                        run_id,
                                        finished_at=finished_at.isoformat(),
                                        duration_seconds=round(duration_sec, 1),
                                        manager_count=len(manager_ids),
                                        league_count=league_count,
                                        success=True,
                                        phase_breakdown=phase,
                                    )
                                logger.info("Deadline batch completed", extra={
                                    "gameweek": target_gw_id,
                                    "duration_sec": round(duration_sec, 1),
                                    "success_count": success_count,
                                    "phase_breakdown": phase,
                                })
                            else:
                                finished_at = datetime.now(timezone.utc)
                                phase["failure_reason"] = "success_rate_below_80"
                                phase["success_rate"] = round(success_rate, 1)
                                if run_id is not None:
                                    self.db_client.update_deadline_batch_finish(
                                        run_id,
                                        finished_at=finished_at.isoformat(),
                                        duration_seconds=(finished_at - t0).total_seconds(),
                                        manager_count=len(manager_ids),
                                        league_count=league_count,
                                        success=False,
                                        phase_breakdown=phase,
                                    )
                                self.deadline_refresh_completed = True
                                logger.error("Deadline batch failed (success rate < 80%)", extra={
                                    "gameweek": target_gw_id,
                                    "success_rate": f"{success_rate:.1f}%",
                                })
                        else:
                            logger.warning("No managers for deadline refresh", extra={"gameweek": target_gw_id})
                            if run_id is not None:
                                phase["failure_reason"] = "no_managers"
                                self.db_client.update_deadline_batch_finish(
                                    run_id,
                                    finished_at=datetime.now(timezone.utc).isoformat(),
                                    duration_seconds=(datetime.now(timezone.utc) - t0).total_seconds(),
                                    manager_count=0,
                                    league_count=league_count,
                                    success=False,
                                    phase_breakdown=phase,
                                )
                    elif self.deadline_refresh_completed:
                        logger.debug("Deadline refresh already completed", extra={"gameweek": self.current_gameweek})
                    else:
                        logger.debug("Waiting for target GW to become current", extra={
                            "target_gameweek": target_gw_id,
                            "current_gameweek": current_gw.get("id"),
                        })
            
            # Phase 4: Refresh materialized views (non-live states only; live does MVs in Phase 3 when do_full)
            # Skip if we already ran MVs inside the deadline batch this cycle
            if self.current_state not in (RefreshState.LIVE_MATCHES, RefreshState.BONUS_PENDING):
                if not self._deadline_batch_ran_this_cycle:
                    try:
                        self.db_client.refresh_all_materialized_views()
                    except Exception as e:
                        logger.error("Materialized views refresh failed", extra={"error": str(e)}, exc_info=True)

        except Exception as e:
            logger.error("Fast cycle failed", extra={"error": str(e)}, exc_info=True)
        finally:
            self._deadline_batch_ran_this_cycle = False
            # Always record fast cycle attempt so debug panel shows backend activity even when cycle fails
            try:
                self.db_client.insert_refresh_event("fast")
            except Exception as ev:
                logger.debug("Refresh event insert failed", extra={"path": "fast", "error": str(ev)})
    
    async def _run_fast_loop(self):
        """Fast loop: gameweeks, fixtures, players every 30s in live (or gameweeks interval otherwise). Does not block on manager points or MVs."""
        while self.running:
            try:
                await self._fast_cycle()
                if self.current_state == RefreshState.TRANSFER_DEADLINE:
                    await asyncio.sleep(self.config.fast_loop_interval_deadline)
                elif self.current_state in (RefreshState.LIVE_MATCHES, RefreshState.BONUS_PENDING):
                    await asyncio.sleep(self.config.fast_loop_interval_live)
                elif self.current_state == RefreshState.PRICE_WINDOW:
                    # Poll every 30s during price window so we capture actual changes reliably
                    await asyncio.sleep(self.config.prices_refresh_interval_window)
                else:
                    # Idle: cap sleep by next kickoff so we run at least once before/during kickoff window
                    sleep_sec = self._get_idle_sleep_seconds()
                    await asyncio.sleep(sleep_sec)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Fast loop error", extra={"error": str(e)}, exc_info=True)
                await asyncio.sleep(30)
    
    async def _run_slow_loop(self):
        """Slow loop: manager points + MVs every full_refresh_interval_live when in live. Runs in parallel with fast loop."""
        while self.running:
            try:
                # Heartbeat at start so "Since backend" updates when iteration begins (not only when it finishes)
                try:
                    self.db_client.insert_refresh_event("slow")
                except Exception as e:
                    logger.debug("Refresh event (slow start) insert failed", extra={"error": str(e)})
                # When live: run manager points + MVs FIRST so standings update every ~2 min.
                # Hourly/ranks run after to avoid blocking live updates for 20+ min.
                if self.current_state in (RefreshState.LIVE_MATCHES, RefreshState.BONUS_PENDING):
                    t_mp = datetime.now(timezone.utc)
                    await self._refresh_manager_points()
                    duration_ms = int((datetime.now(timezone.utc) - t_mp).total_seconds() * 1000)
                    try:
                        self.db_client.insert_refresh_duration_log("manager_points", "slow", self.current_state.value, duration_ms)
                    except Exception:
                        pass
                    await self._validate_player_points_integrity()
                    t_mv = datetime.now(timezone.utc)
                    try:
                        self.db_client.refresh_materialized_views_for_live()
                        duration_ms = int((datetime.now(timezone.utc) - t_mv).total_seconds() * 1000)
                        try:
                            self.db_client.insert_refresh_duration_log("mvs", "slow", self.current_state.value, duration_ms)
                        except Exception:
                            pass
                    except Exception as e:
                        logger.error("Materialized views refresh failed", extra={"error": str(e)}, exc_info=True)
                # Hourly (IDLE or after live): refresh all managers' overall_rank/gameweek_rank. Skip when live to avoid blocking.
                now_utc = datetime.now(timezone.utc)
                if self.current_gameweek and self.current_state not in (RefreshState.LIVE_MATCHES, RefreshState.BONUS_PENDING):
                    should_hourly = (
                        self._last_hourly_rank_refresh_time is None
                        or (now_utc - self._last_hourly_rank_refresh_time).total_seconds() >= self._hourly_rank_refresh_interval_seconds
                    )
                    if should_hourly:
                        logger.info("Hourly rank refresh: refreshing all managers (overall_rank, gameweek_rank)", extra={"gameweek": self.current_gameweek})
                        try:
                            await self._refresh_manager_points(force_all_managers=True)
                            self._last_hourly_rank_refresh_time = now_utc
                        except Exception as e:
                            logger.warning("Hourly rank refresh failed", extra={"gameweek": self.current_gameweek, "error": str(e)}, exc_info=True)
                # Per-matchday rank baseline: capture before first kickoff of each matchday (when in capture window).
                if self.current_gameweek and self.current_state not in (RefreshState.LIVE_MATCHES, RefreshState.BONUS_PENDING):
                    matchday_info = self.baseline_capture.get_next_matchday_for_capture(self.current_gameweek)
                    if matchday_info:
                        manager_ids = self._get_tracked_manager_ids()
                        self.baseline_capture.capture_matchday_baselines(
                            self.current_gameweek,
                            matchday_info["matchday_sequence"],
                            matchday_info["matchday_date"],
                            matchday_info["first_kickoff_at"],
                            manager_ids=manager_ids,
                        )
                # End of gameday (fixtures table: all finished_provisional): capture rank update. Skip when live.
                if self.current_gameweek and self.current_state not in (RefreshState.LIVE_MATCHES, RefreshState.BONUS_PENDING):
                    await self._check_ranks_final_and_refresh()
                # IDLE: sync auto-sub flags to manager_picks so UI shows sub indicators
                # (pegged to player match finished, not gated by live/bonus state)
                if self.current_state == RefreshState.IDLE and self.current_gameweek:
                    try:
                        manager_ids = self._get_tracked_manager_ids()
                        if manager_ids:
                            for manager_id in manager_ids:
                                try:
                                    self.manager_refresher.sync_auto_sub_flags_to_picks(
                                        manager_id, self.current_gameweek
                                    )
                                except Exception as e:
                                    logger.debug(
                                        "Auto-sub sync failed for manager",
                                        extra={"manager_id": manager_id, "gameweek": self.current_gameweek, "error": str(e)},
                                    )
                    except Exception as e:
                        logger.warning(
                            "Auto-sub sync (IDLE) failed",
                            extra={"gameweek": self.current_gameweek, "error": str(e)},
                            exc_info=True,
                        )
                # Record slow cycle completion for frontend lag monitoring (every iteration, including idle)
                try:
                    self.db_client.insert_refresh_event("slow")
                except Exception as e:
                    logger.debug("Refresh event insert failed", extra={"path": "slow", "error": str(e)})
                await asyncio.sleep(self.config.full_refresh_interval_live)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Slow loop error", extra={"error": str(e)}, exc_info=True)
                await asyncio.sleep(60)
    
    async def _run_predictions_loop(self):
        """Run LiveFPL scraper every 30 minutes so predictions update without a separate cron."""
        backend_dir = Path(__file__).resolve().parent.parent
        script = backend_dir / "scripts" / "refresh_livefpl_predictions.py"
        interval = 1800  # 30 minutes
        # First run after 60s so we don't block startup; then every 30 min
        await asyncio.sleep(60)
        while self.running:
            try:
                if script.exists():
                    proc = await asyncio.create_subprocess_exec(
                        "python3",
                        str(script),
                        cwd=str(backend_dir),
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE,
                    )
                    try:
                        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=120)
                    except asyncio.TimeoutError:
                        proc.kill()
                        await proc.wait()
                        logger.warning("LiveFPL predictions scrape timed out after 120s", extra={})
                        stdout, stderr = b"", b""
                    if proc.returncode != 0:
                        logger.warning(
                            "LiveFPL predictions scrape failed",
                            extra={"returncode": proc.returncode, "stderr": (stderr or b"").decode()[:500]},
                        )
                    else:
                        logger.debug("LiveFPL predictions scrape completed")
                else:
                    logger.warning("LiveFPL predictions script not found", extra={"path": str(script)})
                await asyncio.sleep(interval)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning("Predictions loop error", extra={"error": str(e)}, exc_info=True)
                await asyncio.sleep(interval)

    async def run_deadline_batch_test(
        self, gameweek: Optional[int] = None, record_success: bool = False
    ) -> Dict[str, Any]:
        """
        Force-run the deadline batch for a gameweek (bypasses state and DB skip check).
        Used for testing timing or for post-deadline catch-up when the service didn't run.
        When record_success=True, writes a successful run to deadline_batch_runs so the
        orchestrator won't re-run. Returns phase breakdown dict with timing for each phase.
        """
        if not self.db_client or not self.manager_refresher:
            await self.initialize()
        target_gw_id = gameweek
        if target_gw_id is None:
            gameweeks = self.db_client.get_gameweeks(is_current=True, limit=1)
            if not gameweeks:
                return {"error": "No current gameweek in DB"}
            target_gw_id = gameweeks[0]["id"]
            current_gw = gameweeks[0]
        else:
            gw_rows = self.db_client.get_gameweeks(gameweek_id=target_gw_id, limit=1)
            current_gw = gw_rows[0] if gw_rows else {}
        self.current_gameweek = target_gw_id
        manager_ids = self._get_tracked_manager_ids()
        if self.config.required_manager_ids:
            extra = [mid for mid in self.config.required_manager_ids if mid not in manager_ids]
            if extra:
                manager_ids = list(manager_ids) + extra
        leagues_result = type("_Res", (), {"data": []})()
        try:
            leagues_result = self.db_client.client.table("mini_leagues").select("league_id").execute()
            leagues_result = type("_Res", (), {"data": leagues_result.data or []})()
        except Exception:
            pass
        league_count = len(leagues_result.data) if leagues_result.data else 0
        if not manager_ids:
            return {"error": "No tracked managers", "phase": {}}
        phase = {}
        t0 = datetime.now(timezone.utc)
        bootstrap_ok = await self._short_bootstrap_check()
        phase["bootstrap_check_sec"] = round((datetime.now(timezone.utc) - t0).total_seconds(), 1)
        if not bootstrap_ok:
            return {"error": "Bootstrap check failed", "phase": phase}
        settle_sec = min(self.config.post_deadline_settle_seconds, 60)
        if settle_sec > 0:
            await asyncio.sleep(settle_sec)
        phase["settle_sec"] = settle_sec
        t1 = datetime.now(timezone.utc)
        batch_size = self.config.deadline_batch_size
        batch_sleep = self.config.deadline_batch_sleep_seconds
        deadline_time = None
        if current_gw.get("deadline_time"):
            deadline_time = datetime.fromisoformat(current_gw["deadline_time"].replace("Z", "+00:00"))
        picks_metadata = {}
        for batch_num in range(0, len(manager_ids), batch_size):
            batch = manager_ids[batch_num : batch_num + batch_size]
            tasks = []
            for mid in batch:
                tasks.append(self.manager_refresher.refresh_manager_picks(mid, target_gw_id, deadline_time=deadline_time, use_cache=False))
                tasks.append(self.manager_refresher.refresh_manager_transfers(mid, target_gw_id))
            results = await asyncio.gather(*tasks, return_exceptions=True)
            for i, res in enumerate(results):
                if i % 2 == 0:
                    mid = batch[i // 2]
                    if isinstance(res, dict):
                        picks_metadata[mid] = {"active_chip": res.get("active_chip"), "gameweek_rank": res.get("gameweek_rank")}
            if batch_num + batch_size < len(manager_ids) and batch_sleep > 0:
                await asyncio.sleep(batch_sleep)
        phase["picks_and_transfers_sec"] = round((datetime.now(timezone.utc) - t1).total_seconds(), 1)
        # Refuse seed when any fixture has started (would overwrite live points with 0)
        try:
            started_fixtures = self.db_client.client.table("fixtures").select(
                "fpl_fixture_id"
            ).eq("gameweek", target_gw_id).eq("started", True).limit(1).execute().data
            if started_fixtures:
                return {
                    "error": "Cannot run deadline batch test: fixtures for GW have started. "
                    "Seed path would overwrite live points. Use backfill instead: "
                    "python scripts/backfill_manager_history.py --gameweeks <gw> --force",
                    "phase": phase,
                    "gameweek": target_gw_id,
                }
        except Exception as e:
            logger.warning("Could not check fixture status", extra={"gameweek": target_gw_id, "error": str(e)})
        t2 = datetime.now(timezone.utc)
        self.manager_refresher.seed_manager_gameweek_history_from_previous(manager_ids, target_gw_id, picks_metadata)
        for league in (leagues_result.data or []):
            try:
                await self.manager_refresher.calculate_mini_league_ranks(league["league_id"], target_gw_id)
            except Exception as e:
                logger.warning("Mini league ranks failed", extra={"league_id": league["league_id"], "error": str(e)})
        phase["history_refresh_sec"] = round((datetime.now(timezone.utc) - t2).total_seconds(), 1)
        t3 = datetime.now(timezone.utc)
        await self._capture_baselines_if_needed()
        phase["baselines_sec"] = round((datetime.now(timezone.utc) - t3).total_seconds(), 1)
        t4 = datetime.now(timezone.utc)
        for league in (leagues_result.data or []):
            try:
                await self.manager_refresher.build_player_whitelist(league["league_id"], target_gw_id)
            except Exception as e:
                logger.warning("Player whitelist failed", extra={"league_id": league["league_id"], "error": str(e)})
        phase["whitelist_sec"] = round((datetime.now(timezone.utc) - t4).total_seconds(), 1)
        t5 = datetime.now(timezone.utc)
        try:
            self.db_client.refresh_league_transfer_aggregation()
        except Exception as mv_err:
            logger.warning("League transfer aggregation failed", extra={"error": str(mv_err)})
        phase["transfer_aggregation_sec"] = round((datetime.now(timezone.utc) - t5).total_seconds(), 1)
        t6 = datetime.now(timezone.utc)
        try:
            self.db_client.refresh_all_materialized_views()
        except Exception as e:
            logger.error("Materialized views refresh failed", extra={"error": str(e)})
        phase["materialized_views_sec"] = round((datetime.now(timezone.utc) - t6).total_seconds(), 1)
        total_sec = round((datetime.now(timezone.utc) - t0).total_seconds(), 1)
        if record_success:
            run_id = self.db_client.insert_deadline_batch_start(target_gw_id)
            if run_id is not None:
                self.db_client.update_deadline_batch_finish(
                    run_id,
                    finished_at=datetime.now(timezone.utc).isoformat(),
                    duration_seconds=total_sec,
                    manager_count=len(manager_ids),
                    league_count=league_count,
                    success=True,
                    phase_breakdown=phase,
                )
                logger.info("Deadline batch (test/catch-up) recorded as successful", extra={"gameweek": target_gw_id})
        return {"gameweek": target_gw_id, "manager_count": len(manager_ids), "league_count": league_count, "total_sec": total_sec, "phase": phase}

    async def run(self):
        """Run fast, slow, and predictions loops in parallel."""
        logger.info("Refresh loops started (fast + slow + predictions)")
        self.running = True
        try:
            await asyncio.gather(
                self._run_fast_loop(),
                self._run_slow_loop(),
                self._run_predictions_loop(),
            )
        except asyncio.CancelledError:
            logger.info("Refresh loops cancelled")
        finally:
            self.running = False