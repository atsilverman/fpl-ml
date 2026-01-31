"""
Refresh Orchestrator - Coordinates all data refresh operations.

Manages state machine, dependency ordering, and refresh cadence.
"""

import asyncio
import logging
from datetime import datetime, time, timezone, timedelta
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
        # Throttle for FPL rank-change check (only run every 5 min when in BONUS_PENDING)
        self._last_rank_check_time: Optional[datetime] = None
        self._last_rank_check_gameweek: Optional[int] = None
        self._rank_check_interval_seconds: int = 300  # 5 minutes
        
    async def initialize(self):
        """Initialize orchestrator and clients."""
        logger.info("Initializing refresh orchestrator")
        
        # Initialize clients
        self.fpl_client = FPLAPIClient(self.config)
        self.db_client = SupabaseClient(self.config)
        self.player_refresher = PlayerDataRefresher(self.fpl_client, self.db_client)
        self.manager_refresher = ManagerDataRefresher(self.fpl_client, self.db_client)
        self.baseline_capture = BaselineCapture(self.fpl_client, self.db_client)
        
        logger.info("Refresh orchestrator initialized")
    
    async def shutdown(self):
        """Shutdown orchestrator gracefully."""
        logger.info("Shutting down refresh orchestrator")
        self.running = False
        
        if self.fpl_client:
            await self.fpl_client.close()
        
        logger.info("Refresh orchestrator shut down")
    
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
        
        # Check for live matches
        live_matches = [
            f for f in fixtures
            if f.get("started") and not f.get("finished")
        ]
        
        if live_matches:
            return RefreshState.LIVE_MATCHES
        
        # Check for bonus pending
        bonus_pending_matches = [
            f for f in fixtures
            if f.get("finished_provisional") and not f.get("finished")
        ]
        
        if bonus_pending_matches:
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
            logger.info("Gameweek status change detected: is_next → is_current", extra={
                "gameweek": curr.get("id")
            })
            return True
        
        # Detect if is_current gameweek became is_previous
        if prev.get("is_current") and curr.get("is_previous") and prev.get("id") == curr.get("id"):
            logger.info("Gameweek status change detected: is_current → is_previous", extra={
                "gameweek": curr.get("id")
            })
            return True
        
        # Detect if tracked next gameweek became current (different gameweek)
        if (self.next_gameweek_id_before_deadline and 
            curr.get("id") == self.next_gameweek_id_before_deadline and 
            curr.get("is_current")):
            logger.info("Gameweek status change detected: tracked next gameweek became current", extra={
                "gameweek": curr.get("id")
            })
            return True
        
        # Update previous state
        self.previous_gameweek_state = {
            "is_current": curr.get("is_current", False),
            "is_next": curr.get("is_next", False),
            "is_previous": curr.get("is_previous", False),
            "id": curr.get("id")
        }
        
        return False
    
    async def _refresh_gameweeks(self):
        """Refresh gameweeks table."""
        try:
            bootstrap = await self.fpl_client.get_bootstrap_static()
            events = bootstrap.get("events", [])
            
            for event in events:
                gameweek_data = {
                    "id": event["id"],
                    "name": event["name"],
                    "deadline_time": event["deadline_time"],
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
            
            logger.debug("Refreshed gameweeks", extra={
                "gameweeks_count": len(events)
            })
            
        except Exception as e:
            logger.error("Error refreshing gameweeks", extra={
                "error": str(e)
            }, exc_info=True)
    
    async def _refresh_fixtures(self):
        """Refresh fixtures table."""
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
            
            for fixture in fixtures:
                gameweek_id = fixture.get("event")
                fixture_data = {
                    "fpl_fixture_id": fixture["id"],
                    "gameweek": gameweek_id,
                    "home_team_id": fixture["team_h"],
                    "away_team_id": fixture["team_a"],
                    "home_score": fixture.get("team_h_score"),
                    "away_score": fixture.get("team_a_score"),
                    "started": fixture.get("started", False),
                    "finished": fixture.get("finished", False),
                    "finished_provisional": fixture.get("finished_provisional", False),
                    "minutes": fixture.get("minutes", 0),
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
            
        except Exception as e:
            logger.error("Error refreshing fixtures", extra={
                "error": str(e)
            }, exc_info=True)
    
    async def _refresh_players(self):
        """Refresh player gameweek stats for active players."""
        if not self.current_gameweek:
            return
        
        # Get fixtures to check for live matches (defensive check)
        fixtures = self.db_client.client.table("fixtures").select("*").eq(
            "gameweek", self.current_gameweek
        ).execute().data
        
        # Defensive check: skip if no live matches
        has_live_matches = any(
            f.get("started", False) and not f.get("finished", False)
            for f in fixtures
        )
        
        if not has_live_matches:
            logger.debug("No live matches detected, skipping player refresh", extra={
                "gameweek": self.current_gameweek
            })
            return
        
        # Get live event data (single API call)
        try:
            live_data = await self.fpl_client.get_event_live(self.current_gameweek)
            active_player_ids = {
                elem["id"] for elem in live_data.get("elements", [])
                if elem.get("stats", {}).get("minutes", 0) > 0
            }
            
            if active_player_ids:
                # Get fixtures from API for fixture context
                fixtures_api = await self.fpl_client.get_fixtures()
                fixtures_by_gameweek = {
                    f["id"]: f for f in fixtures_api
                    if f.get("event") == self.current_gameweek
                }
                
                await self.player_refresher.refresh_player_gameweek_stats(
                    self.current_gameweek,
                    active_player_ids,
                    live_data=live_data,
                    fixtures=fixtures_by_gameweek,
                    live_only=True  # Skip expected/ICT stats during live matches
                )
        except Exception as e:
            logger.error("Error refreshing players", extra={
                "error": str(e)
            }, exc_info=True)
    
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
            gameweeks = self.db_client.get_gameweeks(id=self.current_gameweek, limit=1)
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
                logger.info("Capturing baselines for gameweek", extra={
                    "gameweek": self.current_gameweek
                })
                
                # Get all tracked managers (from mini leagues)
                result = await self.baseline_capture.capture_all_baselines_for_gameweek(
                    self.current_gameweek
                )
                
                logger.info("Baseline capture completed", extra={
                    "gameweek": self.current_gameweek,
                    **result
                })
        except Exception as e:
            logger.error("Error capturing baselines", extra={
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
            logger.error("Error getting tracked manager IDs", extra={
                "error": str(e)
            }, exc_info=True)
            return []
    
    def _get_active_manager_ids(self) -> List[int]:
        """
        Get manager IDs who have players currently playing in live matches.
        
        OPTIMIZATION: Only refresh managers with active players to reduce API calls.
        
        Returns:
            List of manager IDs with active players
        """
        try:
            # Get all managers with picks in current gameweek
            picks_result = self.db_client.client.table("manager_picks").select(
                "manager_id, player_id"
            ).eq("gameweek", self.current_gameweek).execute()
            
            if not picks_result.data:
                return []
            
            # Get player IDs from picks
            player_ids = list(set([p["player_id"] for p in picks_result.data]))
            
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
            
            return list(active_manager_ids)
            
        except Exception as e:
            logger.error("Error identifying active managers", extra={
                "error": str(e)
            }, exc_info=True)
            # Fallback: return all tracked managers if error
            return self._get_tracked_manager_ids()
    
    async def _refresh_manager_points(self):
        """
        Refresh manager gameweek history (points, ranks) for all tracked managers.
        
        ⚠️ CRITICAL: This applies auto-subs progressively as matches finish.
        Auto-subs are only applied when a player's match finishes, so we need
        to recalculate manager points during live matches to capture auto-subs.
        
        ⚠️ CRITICAL: This preserves baseline data (baseline_total_points, previous ranks)
        during live updates. Baselines are only set by baseline_capture module.
        """
        if not self.current_gameweek:
            return
        
        try:
            # OPTIMIZATION: Only refresh managers with active players during live matches
            if self.current_state in (RefreshState.LIVE_MATCHES, RefreshState.BONUS_PENDING):
                manager_ids = self._get_active_manager_ids()
                logger.info("Refreshing active manager points", extra={
                    "manager_count": len(manager_ids),
                    "gameweek": self.current_gameweek,
                    "optimization": "active_managers_only"
                })
            else:
                # Outside live matches, refresh all managers
                manager_ids = self._get_tracked_manager_ids()
                logger.info("Refreshing all manager points", extra={
                    "manager_count": len(manager_ids),
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
                        logger.error("Error refreshing manager points", extra={
                            "manager_id": manager_id,
                            "gameweek": self.current_gameweek,
                            "error": str(result)
                        }, exc_info=True)
                
                # Rate limiting: Wait 2 seconds between batches to stay under 30 calls/min
                # Each manager makes ~2 API calls, so 5 managers = 10 calls
                # 10 calls / 0.5 calls/sec = 20 seconds needed, but we batch so wait 2 sec
                if batch_num + batch_size < len(manager_ids):
                    await asyncio.sleep(2.0)
            
            # Recalculate mini-league ranks after points update
            # Get all leagues
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
                    logger.error("Error calculating mini league ranks", extra={
                        "league_id": league["league_id"],
                        "gameweek": self.current_gameweek,
                        "error": str(e)
                    }, exc_info=True)
            
        except Exception as e:
            logger.error("Error refreshing manager points", extra={
                "gameweek": self.current_gameweek,
                "error": str(e)
            }, exc_info=True)
    
    async def _check_fpl_rank_change_and_refresh(self):
        """
        In BONUS_PENDING, poll FPL API for one manager to see if overall_rank/gameweek_rank
        have been updated. When detected, set fpl_ranks_updated and trigger full manager refresh
        so frontend can drop the stale indicator.
        Throttled to run at most every 5 minutes.
        """
        if not self.current_gameweek:
            return
        try:
            gameweeks = self.db_client.get_gameweeks(id=self.current_gameweek, limit=1)
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
                logger.info("FPL ranks updated detected, setting flag and refreshing all managers", extra={
                    "gameweek": self.current_gameweek
                })
                self.db_client.update_gameweek_fpl_ranks_updated(self.current_gameweek, True)
                await self._refresh_manager_points()
        except Exception as e:
            logger.error("Error in FPL rank change check", extra={
                "gameweek": self.current_gameweek,
                "error": str(e)
            }, exc_info=True)
    
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
                    logger.warning("Player points integrity check failed", extra={
                        "manager_id": row.get("manager_id"),
                        "manager_name": row.get("manager_name"),
                        "manager_total_points": row.get("manager_total_points"),
                        "sum_player_starting_points": row.get("sum_player_starting_points"),
                        "transfer_costs": row.get("transfer_costs"),
                        "difference": row.get("difference"),
                        "expected": row.get("sum_player_starting_points", 0) + row.get("transfer_costs", 0)
                    })
            
            if invalid_managers:
                logger.warning("Data integrity validation found discrepancies", extra={
                    "invalid_count": len(invalid_managers),
                    "total_checked": len(manager_ids),
                    "invalid_managers": invalid_managers
                })
            else:
                logger.debug("Data integrity validation passed for all managers", extra={
                    "checked_count": len(manager_ids)
                })
                
        except Exception as e:
            logger.error("Error validating player points integrity", extra={
                "error": str(e)
            }, exc_info=True)
    
    async def _refresh_cycle(self):
        """Execute one refresh cycle."""
        try:
            # Phase 1: Always refresh foundational tables first
            await self._refresh_gameweeks()
            
            # Detect current state
            new_state = await self._detect_state()
            if new_state != self.current_state:
                logger.info("State transition", extra={
                    "from": self.current_state.value,
                    "to": new_state.value
                })
                
                # If transitioning away from TRANSFER_DEADLINE, reset tracking flags
                if self.current_state == RefreshState.TRANSFER_DEADLINE:
                    logger.info("Exiting TRANSFER_DEADLINE state", extra={
                        "refresh_completed": self.deadline_refresh_completed,
                        "new_state": new_state.value
                    })
                    # Reset flags for next deadline window
                    self.deadline_refresh_completed = False
                    self.next_gameweek_id_before_deadline = None
                    self.previous_gameweek_state = None
                
                self.current_state = new_state
            
            # Phase 2: Refresh fixtures (state-dependent)
            await self._refresh_fixtures()
            
            # Phase 3: Conditional refreshes based on state
            if self.current_state in (RefreshState.LIVE_MATCHES, RefreshState.BONUS_PENDING):
                await self._refresh_players()
                # ⚠️ CRITICAL: Refresh manager points to apply auto-subs progressively
                # Auto-subs are applied as matches finish, so we need to recalculate manager points
                await self._refresh_manager_points()
                # Validate data integrity after refresh
                await self._validate_player_points_integrity()
            
            # Phase 3b: In BONUS_PENDING, poll FPL API for rank change to drop stale indicator
            if self.current_state == RefreshState.BONUS_PENDING and self.current_gameweek:
                await self._check_fpl_rank_change_and_refresh()
            
            if self.current_state == RefreshState.PRICE_WINDOW:
                await self._refresh_prices()
            
            if self.current_state == RefreshState.TRANSFER_DEADLINE:
                # ⚠️ CRITICAL: Post-deadline refresh strategy
                # Wait 30 minutes after deadline, then check once per minute until
                # gameweek status changes indicate API is back and data is ready
                
                # Get current gameweek data to check for status changes
                gameweeks = self.db_client.get_gameweeks(is_current=True, limit=1)
                if gameweeks:
                    current_gw = gameweeks[0]
                    status_changed = self._detect_gameweek_status_change(current_gw)
                    
                    if status_changed and not self.deadline_refresh_completed:
                        # Gameweek status changed - API is back, refresh all deadline data
                        logger.info("Gameweek status change detected - refreshing deadline data", extra={
                            "gameweek": self.current_gameweek
                        })
                        
                        # Get all tracked managers
                        manager_ids = self._get_tracked_manager_ids()
                        
                        if manager_ids:
                            # Refresh manager picks and transfers in batches
                            batch_size = 5
                            total_batches = (len(manager_ids) + batch_size - 1) // batch_size
                            
                            logger.info("Refreshing manager picks and transfers", extra={
                                "manager_count": len(manager_ids),
                                "total_batches": total_batches,
                                "gameweek": self.current_gameweek
                            })
                            
                            # Get deadline time for API wait logic
                            deadline_time = None
                            if current_gw.get("deadline_time"):
                                deadline_time = datetime.fromisoformat(
                                    current_gw["deadline_time"].replace("Z", "+00:00")
                                )
                            
                            # Pre-flight API check: Wait for API to be ready before starting batch refresh
                            # This handles cases where status changed but API still has errors
                            if deadline_time:
                                current_time = datetime.now(timezone.utc)
                                logger.info("Waiting for API to be ready before batch refresh", extra={
                                    "gameweek": self.current_gameweek
                                })
                                try:
                                    api_ready = await self.manager_refresher.wait_for_api_after_deadline(
                                        deadline_time,
                                        current_time
                                    )
                                    if not api_ready:
                                        logger.warning("API not ready after wait, proceeding with caution", extra={
                                            "gameweek": self.current_gameweek
                                        })
                                except Exception as e:
                                    logger.warning("Error waiting for API, proceeding anyway", extra={
                                        "gameweek": self.current_gameweek,
                                        "error": str(e)
                                    })
                            
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
                                        
                                        logger.error(f"Error refreshing manager {task_type}", extra={
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
                                logger.warning("Batch refresh had failures, retrying failed managers", extra={
                                    "gameweek": self.current_gameweek,
                                    "failed_count": len(failed_managers),
                                    "success_rate": f"{success_rate:.1f}%",
                                    "total_managers": len(manager_ids)
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
                                        logger.info("Successfully retried manager refresh", extra={
                                            "manager_id": manager_id,
                                            "gameweek": self.current_gameweek
                                        })
                                    except Exception as e:
                                        failed_managers.add(manager_id)
                                        logger.error("Retry failed for manager", extra={
                                            "manager_id": manager_id,
                                            "gameweek": self.current_gameweek,
                                            "error": str(e)
                                        }, exc_info=True)
                                    
                                    # Rate limiting between retries
                                    await asyncio.sleep(2.0)
                                
                                # Recalculate success rate after retry
                                success_count = len(manager_ids) - len(failed_managers)
                                success_rate = (success_count / len(manager_ids)) * 100 if manager_ids else 0
                            
                            # Only mark as completed if we have reasonable success rate
                            # Allow some failures (e.g., network issues) but not complete failure
                            if success_rate >= 80:  # At least 80% success
                                logger.info("Batch refresh completed with acceptable success rate", extra={
                                    "gameweek": self.current_gameweek,
                                    "success_count": success_count,
                                    "failed_count": len(failed_managers),
                                    "success_rate": f"{success_rate:.1f}%"
                                })
                                
                                # Capture baselines after picks/transfers are refreshed
                                await self._capture_baselines_if_needed()
                            
                                # Build player whitelist for all leagues
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
                                        logger.error("Error building player whitelist", extra={
                                            "league_id": league["league_id"],
                                            "gameweek": self.current_gameweek,
                                            "error": str(e)
                                        }, exc_info=True)
                                
                                # Mark as completed - this will cause state detection to exit TRANSFER_DEADLINE
                                # and allow normal state detection (e.g., LIVE_MATCHES when games start)
                                self.deadline_refresh_completed = True
                                
                                logger.info("Deadline refresh completed - exiting TRANSFER_DEADLINE state", extra={
                                    "gameweek": self.current_gameweek,
                                    "managers_refreshed": success_count,
                                    "managers_failed": len(failed_managers),
                                    "success_rate": f"{success_rate:.1f}%",
                                    "note": "Will now detect LIVE_MATCHES state when games start"
                                })
                            else:
                                # Too many failures - don't mark as completed, will retry next cycle
                                logger.error("Batch refresh failed - too many errors, will retry next cycle", extra={
                                    "gameweek": self.current_gameweek,
                                    "success_count": success_count,
                                    "failed_count": len(failed_managers),
                                    "success_rate": f"{success_rate:.1f}%",
                                    "threshold": "80%"
                                })
                                # Don't mark as completed - will retry on next cycle
                                return  # Exit early, don't mark as completed
                        else:
                            logger.warning("No tracked managers found for deadline refresh", extra={
                                "gameweek": self.current_gameweek
                            })
                    elif not status_changed:
                        # Status hasn't changed yet - still waiting for API
                        logger.debug("Waiting for gameweek status change after deadline", extra={
                            "gameweek": self.current_gameweek,
                            "time_since_deadline_min": None  # Could calculate if needed
                        })
                    else:
                        # Status changed but already refreshed
                        logger.debug("Deadline refresh already completed", extra={
                            "gameweek": self.current_gameweek
                        })
                else:
                    logger.warning("Could not get current gameweek for deadline refresh check")
            
            # Phase 4: Refresh materialized views
            try:
                self.db_client.refresh_all_materialized_views()
            except Exception as e:
                logger.error("Error refreshing materialized views", extra={
                    "error": str(e)
                }, exc_info=True)
            
        except Exception as e:
            logger.error("Error in refresh cycle", extra={
                "error": str(e)
            }, exc_info=True)
    
    async def run(self):
        """Run the refresh orchestrator main loop."""
        logger.info("Starting refresh orchestrator main loop")
        self.running = True
        
        while self.running:
            try:
                await self._refresh_cycle()
                
                # Use 1 minute interval during TRANSFER_DEADLINE state to check for status changes
                # Otherwise use gameweeks interval as base
                if self.current_state == RefreshState.TRANSFER_DEADLINE:
                    await asyncio.sleep(60)  # 1 minute
                else:
                    await asyncio.sleep(self.config.gameweeks_refresh_interval)
                
            except asyncio.CancelledError:
                logger.info("Refresh orchestrator cancelled")
                break
            except Exception as e:
                logger.error("Fatal error in refresh loop", extra={
                    "error": str(e)
                }, exc_info=True)
                # Wait before retrying
                await asyncio.sleep(60)
