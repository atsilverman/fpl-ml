"""
Refresh Orchestrator - Coordinates all data refresh operations.

Manages state machine, dependency ordering, and refresh cadence.
"""

import asyncio
import logging
from datetime import date, datetime, time, timezone, timedelta
from enum import Enum
from typing import Optional, List, Dict, Any

from config import Config
from database.supabase_client import SupabaseClient
from fpl_api.client import FPLAPIClient
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
        # Track if we've already refreshed picks/transfers for current deadline window
        self.deadline_refresh_completed: bool = False
        # First run time of deadline batch (for fixed-window retries so transfers endpoint can catch up)
        self._deadline_batch_first_run_time: Optional[datetime] = None
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
        
    async def initialize(self):
        """Initialize orchestrator and clients."""
        logger.info("Orchestrator starting")
        
        # Initialize clients
        self.fpl_client = FPLAPIClient(self.config)
        self.db_client = SupabaseClient(self.config)
        self.player_refresher = PlayerDataRefresher(self.fpl_client, self.db_client)
        self.manager_refresher = ManagerDataRefresher(self.fpl_client, self.db_client)
        self.baseline_capture = BaselineCapture(self.fpl_client, self.db_client)
        
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
        
        # Get fixtures for current gameweek
        fixtures = self.db_client.client.table("fixtures").select("*").eq(
            "gameweek", self.current_gameweek
        ).execute().data
        
        # Check for live matches (match in progress: clock running, not yet provisionally finished)
        live_matches = [
            f for f in fixtures
            if f.get("started") and not f.get("finished_provisional")
        ]
        
        if live_matches:
            return RefreshState.LIVE_MATCHES
        
        # Check for bonus pending: all fixtures finished_provisional and not finished
        if fixtures and all(
            f.get("finished_provisional") and not f.get("finished")
            for f in fixtures
        ):
            return RefreshState.BONUS_PENDING
        
        # Check price change window
        if self._is_price_change_window(datetime.now(timezone.utc)):
            return RefreshState.PRICE_WINDOW
        
        # Check transfer deadline (30+ minutes after deadline only)
        # Strategy: Wait 30 minutes after deadline to avoid API lockup, then check
        # once per minute until gameweek status changes indicate API is back
        # Once refresh is complete, exit this state to allow normal state detection
        if not self.deadline_refresh_completed:
            deadline_time = datetime.fromisoformat(current_gw["deadline_time"].replace("Z", "+00:00"))
            now = datetime.now(timezone.utc)
            time_to_deadline = (deadline_time - now).total_seconds()
            
            # Only enter TRANSFER_DEADLINE state 30+ minutes after deadline
            # This avoids API errors during the 0-30 minute lockup window
            # Exit once refresh is completed to allow normal state detection (e.g., LIVE_MATCHES)
            if time_to_deadline <= -1800:  # 30 minutes (1800 seconds) after deadline
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
    
    async def _refresh_fixtures(self) -> Optional[Dict[int, Dict[str, Any]]]:
        """Refresh fixtures table. Returns fixtures for current gameweek keyed by fpl_fixture_id for reuse (e.g. player refresh)."""
        try:
            fixtures = await self.fpl_client.get_fixtures()
            
            # Filter to current gameweek
            if self.current_gameweek:
                fixtures = [
                    f for f in fixtures
                    if f.get("event") == self.current_gameweek
                ]
            
            # Get gameweeks to map deadline_time (FPL fixtures API doesn't provide deadline_time)
            # deadline_time is a gameweek-level property, not fixture-level
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
                # FPL can return null for started/finished before kickoff; normalize so DB and UI stay consistent
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
                    # deadline_time comes from gameweeks table, not fixtures API
                    "deadline_time": deadline_time_map.get(gameweek_id),
                    "updated_at": datetime.now(timezone.utc).isoformat()
                }
                
                self.db_client.upsert_fixture(fixture_data)
            
            logger.debug("Refreshed fixtures", extra={
                "fixtures_count": len(fixtures),
                "gameweek": self.current_gameweek
            })
            return fixtures_by_id
        except Exception as e:
            logger.error("Fixtures refresh failed", extra={"error": str(e)}, exc_info=True)
            return None
    
    async def _refresh_players(
        self,
        bootstrap: Optional[Dict[str, Any]] = None,
        fixtures_by_gameweek: Optional[Dict[int, Dict[str, Any]]] = None,
    ) -> Optional[Dict[str, Any]]:
        """Refresh player gameweek stats for active players. Reuses bootstrap and fixtures when provided to avoid duplicate API calls. Returns live_data when live so caller can sync fixture scores from same source."""
        if not self.current_gameweek:
            return None
        
        # Get fixtures to check for live matches (defensive check)
        fixtures = self.db_client.client.table("fixtures").select("*").eq(
            "gameweek", self.current_gameweek
        ).execute().data
        
        # Refresh when we have in-progress OR provisionally-finished matches (so GW points stay updated until all fixtures are fully finished).
        # In progress: started and not yet finished_provisional.
        # Provisionally finished: finished_provisional and not finished (bonus pending); event-live still has minutes/points/provisional bonus.
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
        
        # Get live event data (single API call). Catch-up refresh (element-summary when fixtures finished) runs in _fast_cycle.
        try:
            live_data = await self.fpl_client.get_event_live(self.current_gameweek)
            active_player_ids = {
                elem["id"] for elem in live_data.get("elements", [])
                if elem.get("stats", {}).get("minutes", 0) > 0
            }
            
            if active_player_ids:
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
        # Only run when at least one fixture is finished (matches have ended, FPL may have confirmed bonus)
        any_finished = any(f.get("finished") for f in fixtures_by_gameweek.values())
        if not any_finished:
            return
        try:
            # Get player ids that have stats for this gameweek (so we refresh them via element-summary)
            stats_result = self.db_client.client.table("player_gameweek_stats").select(
                "player_id"
            ).eq("gameweek", self.current_gameweek).execute()
            player_ids = list({r["player_id"] for r in (stats_result.data or [])})
            if not player_ids:
                logger.debug("Catch-up refresh: no player stats for gameweek", extra={"gameweek": self.current_gameweek})
                return
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
            )
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
        Keeps matches page in sync with GW points and match clock; event-live minutes are often
        more current than the /fixtures/ API, so we derive fixture minutes as max player minutes.
        """
        if not bootstrap or not fixtures_by_gameweek or not live_data.get("elements"):
            return
        elements = bootstrap.get("elements", [])
        player_team = {int(e["id"]): int(e["team"]) for e in elements if "id" in e and "team" in e}
        for fpl_fixture_id, fixture in fixtures_by_gameweek.items():
            team_h = fixture.get("team_h")
            team_a = fixture.get("team_a")
            if team_h is None or team_a is None:
                continue
            home_goals = 0
            away_goals = 0
            max_minutes = 0
            for elem in live_data.get("elements", []):
                pid = elem.get("id")
                stats = elem.get("stats") or {}
                goals = stats.get("goals_scored", 0) or 0
                mins = stats.get("minutes", 0) or 0
                team_id = player_team.get(pid)
                if team_id == team_h:
                    home_goals += goals
                    if mins > max_minutes:
                        max_minutes = mins
                elif team_id == team_a:
                    away_goals += goals
                    if mins > max_minutes:
                        max_minutes = mins
            try:
                self.db_client.update_fixture_scores(
                    fpl_fixture_id,
                    home_score=home_goals,
                    away_score=away_goals,
                    minutes=max_minutes if max_minutes > 0 else None,
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
            # When ranks finalize we refresh all managers; otherwise optimize during live
            if force_all_managers:
                manager_ids = self._get_tracked_manager_ids()
                if manager_ids:
                    logger.info("Refreshing all manager points (ranks final)", extra={
                        "count": len(manager_ids),
                        "gameweek": self.current_gameweek
                    })
            elif self.current_state in (RefreshState.LIVE_MATCHES, RefreshState.BONUS_PENDING):
                manager_ids = self._get_active_manager_ids()
                used_fallback = False
                if not manager_ids:
                    # Fallback: no "active" managers found (e.g. manager_picks for GW empty
                    # or no player_gameweek_stats with minutes>0 yet). Refresh all tracked
                    # managers so points still update and UI is not stuck at 0.
                    manager_ids = self._get_tracked_manager_ids()
                    used_fallback = True
                    logger.warning(
                        "No active managers, using all tracked",
                        extra={
                            "gameweek": self.current_gameweek,
                            "fallback_count": len(manager_ids)
                        }
                    )
                if manager_ids:
                    logger.info("Refreshing manager points", extra={
                        "count": len(manager_ids),
                        "gameweek": self.current_gameweek,
                        "optimization": "active_managers_only" if not used_fallback else "all_tracked_fallback"
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
            
            # Refresh managers in parallel batches to optimize performance
            # Rate limit: 30 calls/min = 0.5 calls/sec = 2 sec per call
            # Process 5 managers concurrently, then wait 2 seconds
            batch_size = 5
            total_batches = (len(manager_ids) + batch_size - 1) // batch_size
            
            for batch_num in range(0, len(manager_ids), batch_size):
                batch = manager_ids[batch_num:batch_num + batch_size]
                batch_index = (batch_num // batch_size) + 1
                
                logger.debug("Processing manager batch", extra={
                    "batch": batch_index,
                    "total_batches": total_batches,
                    "batch_size": len(batch)
                })
                
                # Process batch in parallel
                tasks = [
                    self.manager_refresher.refresh_manager_gameweek_history(
                        manager_id,
                        self.current_gameweek
                    )
                    for manager_id in batch
                ]
                
                results = await asyncio.gather(*tasks, return_exceptions=True)
                
                # Log any errors
                for manager_id, result in zip(batch, results):
                    if isinstance(result, Exception):
                        logger.error("Manager points refresh failed", extra={
                            "manager_id": manager_id,
                            "gameweek": self.current_gameweek,
                            "error": str(result)
                        }, exc_info=True)
                
                # Rate limiting: Wait 2 seconds between batches to stay under 30 calls/min
                # Each manager makes ~2 API calls, so 5 managers = 10 calls
                # 10 calls / 0.5 calls/sec = 20 seconds needed, but we batch so wait 2 sec
                if batch_num + batch_size < len(manager_ids):
                    await asyncio.sleep(2.0)
            
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
                self.db_client.update_gameweek_fpl_ranks_updated(self.current_gameweek, True)
                await self._refresh_manager_points(force_all_managers=True)
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

    async def _fast_cycle(self):
        """Execute fast refresh cycle (gameweeks, state, fixtures, players when live). No manager points or MVs in live - those run in slow loop."""
        try:
            # Heartbeat at start so "Since backend" stays current when cycle runs (even if cycle later blocks)
            try:
                self.db_client.insert_refresh_event("fast")
            except Exception as ev:
                logger.debug("Refresh event (start) insert failed", extra={"path": "fast", "error": str(ev)})
            # Phase 1: Always refresh foundational tables first (reuse bootstrap for player refresh)
            bootstrap = await self._refresh_gameweeks()
            
            # Detect current state
            new_state = await self._detect_state()
            if new_state != self.current_state:
                logger.info("State transition", extra={
                    "from": self.current_state.value,
                    "to": new_state.value
                })
                
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
                    self.previous_gameweek_state = None
                
                self.current_state = new_state
            
            # Phase 2: Refresh fixtures (state-dependent); reuse for player refresh to avoid duplicate get_fixtures()
            fixtures_by_gameweek = await self._refresh_fixtures()
            
            # Phase 3 (fast only): player data every cycle; manager points + MVs run in slow loop
            if self.current_state in (RefreshState.LIVE_MATCHES, RefreshState.BONUS_PENDING):
                live_data = await self._refresh_players(
                    bootstrap=bootstrap, fixtures_by_gameweek=fixtures_by_gameweek
                )
                # Sync fixture scores from event-live so matches page stays in sync with GW points
                if live_data:
                    self._update_fixture_scores_from_live(
                        live_data, bootstrap, fixtures_by_gameweek
                    )
            else:
                # Option B: when fixtures have finished=True but we stopped normal refresh, run catch-up
                # via element-summary to pull confirmed bonus; stop when no player has provisional status
                await self._run_catch_up_player_refresh(
                    bootstrap=bootstrap,
                    fixtures_by_gameweek=fixtures_by_gameweek,
                )
            
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
                # ⚠️ CRITICAL: Post-deadline refresh strategy
                # Wait 30 minutes after deadline, then run picks+transfers batch. Run for a fixed window
                # (e.g. 45 min) so transfers endpoint has time to update (FPL can lag vs is_current).
                now_utc = datetime.now(timezone.utc)
                gameweeks = self.db_client.get_gameweeks(is_current=True, limit=1)
                if gameweeks:
                    current_gw = gameweeks[0]
                    # Ensure we know which GW we're waiting for (we only ever pass is_current to detector)
                    if self.next_gameweek_id_before_deadline is None:
                        self.next_gameweek_id_before_deadline = current_gw.get("id")
                    status_changed = self._detect_gameweek_status_change(current_gw)
                    # Run batch: on status change, or first time we haven't run yet this deadline, or again within window
                    should_run_batch = False
                    is_first_in_window = False
                    if status_changed and not self.deadline_refresh_completed:
                        should_run_batch = True
                        is_first_in_window = True
                    elif not self.deadline_refresh_completed and self._deadline_batch_first_run_time is None:
                        # First time in TRANSFER_DEADLINE: run so we capture picks/transfers (don't rely on status_changed which needs prev state)
                        should_run_batch = True
                        is_first_in_window = True
                    elif not self.deadline_refresh_completed and self._deadline_batch_first_run_time is not None:
                        window_end = self._deadline_batch_first_run_time + timedelta(
                            minutes=self.config.deadline_refresh_window_minutes
                        )
                        if now_utc < window_end:
                            should_run_batch = True
                            is_first_in_window = False

                    if should_run_batch:
                        if is_first_in_window:
                            settle_sec = self.config.post_deadline_settle_seconds
                            if settle_sec > 0:
                                logger.info(
                                    "GW status changed, waiting for API endpoints to settle",
                                    extra={"gameweek": self.current_gameweek, "settle_seconds": settle_sec}
                                )
                                await asyncio.sleep(settle_sec)
                        logger.info(
                            "Refreshing deadline data",
                            extra={"gameweek": self.current_gameweek, "first_in_window": is_first_in_window}
                        )
                        
                        # Get all tracked managers
                        manager_ids = self._get_tracked_manager_ids()
                        
                        if manager_ids:
                            # Refresh manager picks and transfers in batches
                            batch_size = 5
                            total_batches = (len(manager_ids) + batch_size - 1) // batch_size
                            
                            logger.info("Refreshing picks and transfers", extra={
                                "count": len(manager_ids),
                                "total_batches": total_batches,
                                "gameweek": self.current_gameweek
                            })
                            
                            # Get deadline time for API wait logic (first run only)
                            deadline_time = None
                            if current_gw.get("deadline_time"):
                                deadline_time = datetime.fromisoformat(
                                    current_gw["deadline_time"].replace("Z", "+00:00")
                                )
                            if is_first_in_window:
                                # Pre-flight API check: Wait for API to be ready before first batch refresh
                                if deadline_time:
                                    current_time = datetime.now(timezone.utc)
                                    logger.info("Waiting for API before batch refresh", extra={"gameweek": self.current_gameweek})
                                    try:
                                        api_ready = await self.manager_refresher.wait_for_api_after_deadline(
                                            deadline_time,
                                            current_time
                                        )
                                        if not api_ready:
                                            logger.warning("API not ready, proceeding anyway", extra={"gameweek": self.current_gameweek})
                                    except Exception as e:
                                        logger.warning("API wait failed, proceeding anyway", extra={"gameweek": self.current_gameweek, "error": str(e)})
                            
                            # Track errors during batch refresh
                            failed_managers = set()
                            
                            for batch_num in range(0, len(manager_ids), batch_size):
                                batch = manager_ids[batch_num:batch_num + batch_size]
                                batch_index = (batch_num // batch_size) + 1
                                
                                logger.debug("Processing manager batch for picks/transfers", extra={
                                    "batch": batch_index,
                                    "total_batches": total_batches,
                                    "batch_size": len(batch)
                                })
                                
                                # Process picks and transfers in parallel
                                tasks = []
                                for manager_id in batch:
                                    tasks.append(
                                        self.manager_refresher.refresh_manager_picks(
                                            manager_id,
                                            self.current_gameweek,
                                            deadline_time=deadline_time,
                                            use_cache=False  # Force refresh from API
                                        )
                                    )
                                    tasks.append(
                                        self.manager_refresher.refresh_manager_transfers(
                                            manager_id,
                                            self.current_gameweek
                                        )
                                    )
                                
                                results = await asyncio.gather(*tasks, return_exceptions=True)
                                
                                # Log any errors and track failures
                                for i, result in enumerate(results):
                                    if isinstance(result, Exception):
                                        manager_index = i // 2  # Each manager has 2 tasks (picks, transfers)
                                        task_index = i % 2  # 0 = picks, 1 = transfers
                                        manager_id = batch[manager_index]
                                        task_type = "picks" if task_index == 0 else "transfers"
                                        
                                        # Track failed managers
                                        failed_managers.add(manager_id)
                                        
                                        # Check if it's a retryable error (API lockup, 5xx errors)
                                        error_str = str(result)
                                        is_retryable = any(keyword in error_str.lower() for keyword in [
                                            "500", "502", "503", "504", "timeout", "connection", "maintenance"
                                        ])
                                        
                                        logger.error("Manager %s failed", task_type, extra={
                                            "manager_id": manager_id,
                                            "gameweek": self.current_gameweek,
                                            "task_type": task_type,
                                            "error": error_str,
                                            "is_retryable": is_retryable
                                        }, exc_info=True)
                                
                                # Rate limiting: Wait 2 seconds between batches
                                if batch_num + batch_size < len(manager_ids):
                                    await asyncio.sleep(2.0)
                            
                            # Evaluate refresh success
                            success_count = len(manager_ids) - len(failed_managers)
                            success_rate = (success_count / len(manager_ids)) * 100 if manager_ids else 0
                            
                            # Retry failed managers once if we have retryable errors
                            if failed_managers and success_rate < 90:  # Less than 90% success
                                logger.warning("Batch had failures, retrying", extra={
                                    "gameweek": self.current_gameweek,
                                    "failed": len(failed_managers),
                                    "success_rate": f"{success_rate:.1f}%",
                                    "total": len(manager_ids)
                                })
                                
                                # Wait a bit before retry
                                await asyncio.sleep(5.0)
                                
                                # Retry failed managers
                                retry_failed = list(failed_managers)
                                failed_managers.clear()
                                
                                for manager_id in retry_failed:
                                    try:
                                        await self.manager_refresher.refresh_manager_picks(
                                            manager_id,
                                            self.current_gameweek,
                                            deadline_time=deadline_time,
                                            use_cache=False
                                        )
                                        await self.manager_refresher.refresh_manager_transfers(
                                            manager_id,
                                            self.current_gameweek
                                        )
                                        logger.info("Retry succeeded", extra={"manager_id": manager_id, "gameweek": self.current_gameweek})
                                    except Exception as e:
                                        failed_managers.add(manager_id)
                                        logger.error("Retry failed", extra={"manager_id": manager_id, "gameweek": self.current_gameweek, "error": str(e)}, exc_info=True)
                                    
                                    # Rate limiting between retries
                                    await asyncio.sleep(2.0)
                                
                                # Recalculate success rate after retry
                                success_count = len(manager_ids) - len(failed_managers)
                                success_rate = (success_count / len(manager_ids)) * 100 if manager_ids else 0
                            
                            # Only mark as completed if we have reasonable success rate
                            # Allow some failures (e.g., network issues) but not complete failure
                            if success_rate >= 80:  # At least 80% success
                                logger.info("Batch refresh done", extra={
                                    "gameweek": self.current_gameweek,
                                    "success": success_count,
                                    "failed": len(failed_managers),
                                    "success_rate": f"{success_rate:.1f}%",
                                    "first_in_window": is_first_in_window
                                })
                                if is_first_in_window:
                                    self._deadline_batch_first_run_time = now_utc
                                    # Capture baselines and whitelist once (first successful run)
                                    await self._capture_baselines_if_needed()
                                    leagues_result = self.db_client.client.table("mini_leagues").select(
                                        "league_id"
                                    ).execute()
                                    for league in leagues_result.data:
                                        try:
                                            await self.manager_refresher.build_player_whitelist(
                                                league["league_id"],
                                                self.current_gameweek
                                            )
                                        except Exception as e:
                                            logger.error("Player whitelist failed", extra={
                                                "league_id": league["league_id"],
                                                "gameweek": self.current_gameweek,
                                                "error": str(e)
                                            }, exc_info=True)
                                    # Wait for FPL to release new gameweek so we stop showing last week's data
                                    try:
                                        await self._wait_for_new_gameweek_release()
                                    except Exception as e:
                                        logger.warning("Wait for new gameweek release failed", extra={
                                            "gameweek": self.current_gameweek,
                                            "error": str(e)
                                        }, exc_info=True)
                                # Refresh ML Top Transfers MV after every batch so UI gets data when transfers endpoint updates
                                try:
                                    self.db_client.refresh_league_transfer_aggregation()
                                except Exception as mv_err:
                                    logger.warning("League transfer aggregation refresh failed", extra={
                                        "gameweek": self.current_gameweek,
                                        "error": str(mv_err)
                                    })
                                # Mark completed only after fixed window so we don't cut off before transfers endpoint updates
                                if is_first_in_window:
                                    # Will run again next cycle(s) until window elapses
                                    logger.info("Deadline batch first run done; will re-run until window elapses", extra={
                                        "gameweek": self.current_gameweek,
                                        "window_minutes": self.config.deadline_refresh_window_minutes
                                    })
                                else:
                                    window_end = self._deadline_batch_first_run_time + timedelta(
                                        minutes=self.config.deadline_refresh_window_minutes
                                    )
                                    if now_utc >= window_end:
                                        self.deadline_refresh_completed = True
                                        logger.info("Deadline refresh done (window elapsed)", extra={
                                            "gameweek": self.current_gameweek,
                                            "success": success_count,
                                            "failed": len(failed_managers),
                                            "success_rate": f"{success_rate:.1f}%"
                                        })
                            else:
                                # Too many failures - don't mark as completed, will retry next cycle
                                logger.error("Batch failed, retrying next cycle", extra={
                                    "gameweek": self.current_gameweek,
                                    "success": success_count,
                                    "failed": len(failed_managers),
                                    "success_rate": f"{success_rate:.1f}%",
                                    "threshold": "80%"
                                })
                                # Don't mark as completed - will retry on next cycle
                                return  # Exit early, don't mark as completed
                        else:
                            logger.warning("No managers for deadline refresh", extra={"gameweek": self.current_gameweek})
                    elif self.deadline_refresh_completed:
                        logger.debug("Deadline refresh already completed", extra={"gameweek": self.current_gameweek})
                    elif not status_changed:
                        logger.debug("Waiting for gameweek status change after deadline", extra={
                            "gameweek": self.current_gameweek
                        })
                    else:
                        logger.debug("Deadline state (window or status)", extra={"gameweek": self.current_gameweek})
                else:
                    logger.warning("No current gameweek for deadline check")
            
            # Phase 4: Refresh materialized views (non-live states only; live does MVs in Phase 3 when do_full)
            if self.current_state not in (RefreshState.LIVE_MATCHES, RefreshState.BONUS_PENDING):
                try:
                    self.db_client.refresh_all_materialized_views()
                except Exception as e:
                    logger.error("Materialized views refresh failed", extra={"error": str(e)}, exc_info=True)

        except Exception as e:
            logger.error("Fast cycle failed", extra={"error": str(e)}, exc_info=True)
        finally:
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
                    await asyncio.sleep(60)
                elif self.current_state in (RefreshState.LIVE_MATCHES, RefreshState.BONUS_PENDING):
                    await asyncio.sleep(self.config.fast_loop_interval_live)
                else:
                    # Idle: use short interval when within kickoff window or past kickoff (likely live, DB may be stale)
                    if self._is_in_kickoff_window() or self._is_likely_live_window():
                        await asyncio.sleep(self.config.fast_loop_interval_live)
                    else:
                        await asyncio.sleep(self.config.gameweeks_refresh_interval)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Fast loop error", extra={"error": str(e)}, exc_info=True)
                await asyncio.sleep(30)
    
    async def _run_slow_loop(self):
        """Slow loop: manager points + MVs every full_refresh_interval_live when in live. Runs in parallel with fast loop."""
        while self.running:
            try:
                # Hourly: refresh all configured managers' overall_rank and gameweek_rank (simple, no rank-change detection)
                now_utc = datetime.now(timezone.utc)
                if self.current_gameweek:
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
                # End of gameday (fixtures table: all finished_provisional): capture rank update, refresh all managers
                if self.current_gameweek:
                    await self._check_ranks_final_and_refresh()
                if self.current_state in (RefreshState.LIVE_MATCHES, RefreshState.BONUS_PENDING):
                    await self._refresh_manager_points()
                    await self._validate_player_points_integrity()
                    try:
                        self.db_client.refresh_materialized_views_for_live()
                    except Exception as e:
                        logger.error("Materialized views refresh failed", extra={"error": str(e)}, exc_info=True)
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
    
    async def run(self):
        """Run fast and slow loops in parallel."""
        logger.info("Refresh loops started (fast + slow)")
        self.running = True
        try:
            await asyncio.gather(self._run_fast_loop(), self._run_slow_loop())
        except asyncio.CancelledError:
            logger.info("Refresh loops cancelled")
        finally:
            self.running = False