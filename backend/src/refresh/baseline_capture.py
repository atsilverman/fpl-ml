"""
Baseline Capture Module - Critical for Delta Calculations

Captures baseline data at gameweek start (post-deadline, pre-live) that must
be preserved throughout live matches to enable accurate delta calculations:
- Rank changes (mini league and overall)
- Transfer delta points
- Total points baseline

CRITICAL: Baselines are captured ONCE at deadline and NEVER overwritten during
live updates. Only updated when gameweek finishes (FPL API authoritative) or
when new gameweek starts (establish new baselines).
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from database.supabase_client import SupabaseClient
from fpl_api.client import FPLAPIClient

logger = logging.getLogger(__name__)

# Defaults for per-matchday baseline capture window (minutes before first kickoff)
MATCHDAY_BASELINE_MINUTES_BEFORE_DEFAULT = 90
MATCHDAY_BASELINE_MINUTES_STOP_BEFORE_DEFAULT = 5


class BaselineCapture:
    """Handles baseline data capture and preservation."""

    def __init__(
        self,
        fpl_client: FPLAPIClient,
        db_client: SupabaseClient,
        config: Optional[Any] = None,
    ):
        self.fpl_client = fpl_client
        self.db_client = db_client
        self.config = config
    
    async def capture_manager_baselines(
        self,
        manager_id: int,
        gameweek: int
    ) -> bool:
        """
        Capture baseline data for a manager at gameweek start.
        
        This should be called:
        - After transfer deadline passes
        - Before first match starts
        - Once per gameweek (not during live updates)
        
        Args:
            manager_id: Manager ID
            gameweek: Gameweek number
            
        Returns:
            True if baselines were captured, False if already exists
        """
        try:
            # Check if baselines already exist (idempotent)
            existing = self.db_client.client.table("manager_gameweek_history").select(
                "baseline_total_points, previous_mini_league_rank, previous_overall_rank"
            ).eq("manager_id", manager_id).eq("gameweek", gameweek).execute().data
            
            if existing and existing[0].get("baseline_total_points") is not None:
                logger.debug("Baselines already exist, skipping capture", extra={
                    "manager_id": manager_id,
                    "gameweek": gameweek
                })
                return False
            
            # Get previous gameweek data
            previous_gw = gameweek - 1
            previous_history = self.db_client.client.table("manager_gameweek_history").select(
                "total_points, mini_league_rank, overall_rank"
            ).eq("manager_id", manager_id).eq("gameweek", previous_gw).execute().data
            
            # Get FPL API history for authoritative baseline
            history = await self.fpl_client.get_entry_history(manager_id)
            gw_history = next(
                (h for h in history.get("current", []) if h.get("event") == gameweek),
                {}
            )
            prev_gw_history = next(
                (h for h in history.get("current", []) if h.get("event") == previous_gw),
                {}
            )
            
            # Determine baseline values (prefer FPL API, fallback to database)
            baseline_total = None
            previous_mini_rank = None
            previous_overall_rank = None
            
            # Baseline total points: Use previous gameweek total from FPL API (authoritative)
            if prev_gw_history.get("total_points") is not None:
                baseline_total = prev_gw_history["total_points"]
            elif previous_history:
                baseline_total = previous_history[0]["total_points"]
            
            # Previous mini league rank: Use database (calculated from previous gameweek)
            if previous_history:
                previous_mini_rank = previous_history[0].get("mini_league_rank")
            
            # Previous overall rank: Use FPL API (authoritative)
            if prev_gw_history.get("overall_rank") is not None:
                previous_overall_rank = prev_gw_history["overall_rank"]
            elif previous_history:
                previous_overall_rank = previous_history[0].get("overall_rank")
            
            # Update with baselines (only if not already set)
            update_data = {}
            if baseline_total is not None:
                update_data["baseline_total_points"] = baseline_total
            if previous_mini_rank is not None:
                update_data["previous_mini_league_rank"] = previous_mini_rank
            if previous_overall_rank is not None:
                update_data["previous_overall_rank"] = previous_overall_rank
            
            if update_data:
                self.db_client.client.table("manager_gameweek_history").update(
                    update_data
                ).eq("manager_id", manager_id).eq("gameweek", gameweek).execute()
                
                logger.info("Captured manager baselines", extra={
                    "manager_id": manager_id,
                    "gameweek": gameweek,
                    "baseline_total": baseline_total,
                    "previous_mini_rank": previous_mini_rank,
                    "previous_overall_rank": previous_overall_rank
                })
                return True
            else:
                logger.warning("No baseline data available to capture", extra={
                    "manager_id": manager_id,
                    "gameweek": gameweek
                })
                return False
                
        except Exception as e:
            logger.error("Error capturing manager baselines", extra={
                "manager_id": manager_id,
                "gameweek": gameweek,
                "error": str(e)
            }, exc_info=True)
            return False
    
    async def capture_transfer_baselines(
        self,
        manager_id: int,
        gameweek: int
    ) -> int:
        """
        Capture baseline points for transfers at deadline.
        
        Args:
            manager_id: Manager ID
            gameweek: Gameweek number
            
        Returns:
            Number of transfers with baselines captured
        """
        try:
            # Get transfers for this gameweek
            transfers = self.db_client.client.table("manager_transfers").select(
                "id, player_in_id, player_out_id"
            ).eq("manager_id", manager_id).eq("gameweek", gameweek).execute().data
            
            if not transfers:
                return 0
            
            # Get player gameweek stats (may be 0 if not yet played)
            player_ids = set()
            for transfer in transfers:
                player_ids.add(transfer["player_in_id"])
                player_ids.add(transfer["player_out_id"])
            
            # Get current player points (baseline at deadline)
            player_stats = self.db_client.client.table("player_gameweek_stats").select(
                "player_id, total_points"
            ).eq("gameweek", gameweek).in_("player_id", list(player_ids)).execute().data
            
            stats_map = {stat["player_id"]: stat["total_points"] for stat in player_stats}
            
            # Update transfers with baselines
            updated_count = 0
            for transfer in transfers:
                player_in_points = stats_map.get(transfer["player_in_id"], 0)
                player_out_points = stats_map.get(transfer["player_out_id"], 0)
                point_impact = player_in_points - player_out_points
                
                # Only update if baselines not already set
                existing = self.db_client.client.table("manager_transfers").select(
                    "player_in_points_baseline"
                ).eq("id", transfer["id"]).execute().data
                
                if existing and existing[0].get("player_in_points_baseline") is None:
                    self.db_client.client.table("manager_transfers").update({
                        "player_in_points_baseline": player_in_points,
                        "player_out_points_baseline": player_out_points,
                        "point_impact_baseline": point_impact
                    }).eq("id", transfer["id"]).execute()
                    updated_count += 1
            
            if updated_count > 0:
                logger.info("Captured transfer baselines", extra={
                    "manager_id": manager_id,
                    "gameweek": gameweek,
                    "transfers_count": updated_count
                })
            
            return updated_count
            
        except Exception as e:
            logger.error("Error capturing transfer baselines", extra={
                "manager_id": manager_id,
                "gameweek": gameweek,
                "error": str(e)
            }, exc_info=True)
            return 0
    
    async def capture_all_baselines_for_gameweek(
        self,
        gameweek: int,
        manager_ids: Optional[List[int]] = None
    ) -> Dict[str, int]:
        """
        Capture baselines for all managers in a gameweek.
        
        Args:
            gameweek: Gameweek number
            manager_ids: Optional list of manager IDs (if None, gets all from mini leagues)
            
        Returns:
            Dictionary with counts of captured baselines
        """
        try:
            # Get manager IDs if not provided
            if manager_ids is None:
                managers = self.db_client.client.table("mini_league_managers").select(
                    "manager_id"
                ).execute().data
                manager_ids = list(set([m["manager_id"] for m in managers]))
            
            manager_count = 0
            transfer_count = 0
            
            for manager_id in manager_ids:
                # Capture manager baselines
                if await self.capture_manager_baselines(manager_id, gameweek):
                    manager_count += 1
                
                # Capture transfer baselines
                transfer_count += await self.capture_transfer_baselines(manager_id, gameweek)
            
            result = {
                "managers_captured": manager_count,
                "transfers_captured": transfer_count,
                "total_managers": len(manager_ids)
            }
            
            logger.info("Captured all baselines for gameweek", extra={
                "gameweek": gameweek,
                **result
            })

            # Also write matchday 1 baseline (start of GW = first matchday)
            await self._write_matchday_one_baselines(gameweek, manager_ids)

            return result

        except Exception as e:
            logger.error("Error capturing all baselines", extra={
                "gameweek": gameweek,
                "error": str(e)
            }, exc_info=True)
            return {"managers_captured": 0, "transfers_captured": 0, "total_managers": 0}

    async def _write_matchday_one_baselines(
        self, gameweek: int, manager_ids: List[int]
    ) -> None:
        """Write matchday_sequence=1 baselines (rank at start of GW) after GW baselines captured."""
        try:
            first_kickoff = self.db_client.get_first_kickoff_for_gameweek(gameweek)
            if not first_kickoff:
                return
            try:
                dt = datetime.fromisoformat(first_kickoff.replace("Z", "+00:00"))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                matchday_date = dt.date().isoformat()
            except (ValueError, TypeError):
                return
            history = (
                self.db_client.client.table("manager_gameweek_history")
                .select("manager_id, previous_overall_rank, gameweek_rank")
                .eq("gameweek", gameweek)
                .in_("manager_id", manager_ids)
                .execute()
            )
            if not history.data:
                return
            rows = []
            for row in history.data:
                prev_overall = row.get("previous_overall_rank")
                if prev_overall is None:
                    continue
                rows.append({
                    "manager_id": row["manager_id"],
                    "gameweek": gameweek,
                    "matchday_sequence": 1,
                    "matchday_date": matchday_date,
                    "first_kickoff_at": first_kickoff,
                    "overall_rank_baseline": prev_overall,
                    "gameweek_rank_baseline": row.get("gameweek_rank"),
                    "captured_at": datetime.now(timezone.utc).isoformat(),
                })
            if rows:
                self.db_client.upsert_matchday_baselines(rows)
                logger.info("Wrote matchday 1 baselines", extra={
                    "gameweek": gameweek,
                    "managers": len(rows),
                })
        except Exception as e:
            logger.warning("Matchday 1 baselines write failed", extra={
                "gameweek": gameweek,
                "error": str(e),
            })

    def get_next_matchday_for_capture(
        self, gameweek: int, current_time: Optional[datetime] = None
    ) -> Optional[Dict[str, Any]]:
        """
        If we are in the capture window for the next matchday, return its info.
        Window: [first_kickoff - N min, first_kickoff - M min] (e.g. 90 min before to 5 min before).
        """
        now = current_time or datetime.now(timezone.utc)
        info = self.db_client.get_next_matchday_info(gameweek, now)
        if not info:
            return None
        first_kickoff_str = info["first_kickoff_at"]
        try:
            kickoff_dt = datetime.fromisoformat(first_kickoff_str.replace("Z", "+00:00"))
            if kickoff_dt.tzinfo is None:
                kickoff_dt = kickoff_dt.replace(tzinfo=timezone.utc)
        except (ValueError, TypeError):
            return None
        mins_before = getattr(
            self.config, "matchday_baseline_minutes_before", None
        ) or MATCHDAY_BASELINE_MINUTES_BEFORE_DEFAULT
        mins_stop = getattr(
            self.config, "matchday_baseline_minutes_stop_before", None
        ) or MATCHDAY_BASELINE_MINUTES_STOP_BEFORE_DEFAULT
        window_start = kickoff_dt - timedelta(minutes=mins_before)
        window_end = kickoff_dt - timedelta(minutes=mins_stop)
        if not (window_start <= now <= window_end):
            return None
        if self.db_client.matchday_baseline_already_captured(
            gameweek, info["matchday_sequence"]
        ):
            return None
        return info

    def capture_matchday_baselines(
        self,
        gameweek: int,
        matchday_sequence: int,
        matchday_date: str,
        first_kickoff_at: str,
        manager_ids: Optional[List[int]] = None,
    ) -> int:
        """
        Capture overall_rank and gameweek_rank from manager_gameweek_history for all
        tracked managers and upsert into manager_gameweek_matchday_baselines.
        Returns number of rows written.
        """
        try:
            if manager_ids is None:
                managers = self.db_client.client.table("mini_league_managers").select(
                    "manager_id"
                ).execute().data
                manager_ids = list(set([m["manager_id"] for m in managers]))
            if not manager_ids:
                return 0
            history = (
                self.db_client.client.table("manager_gameweek_history")
                .select("manager_id, overall_rank, gameweek_rank")
                .eq("gameweek", gameweek)
                .in_("manager_id", manager_ids)
                .execute()
            )
            if not history.data:
                return 0
            rows = []
            for row in history.data:
                overall = row.get("overall_rank")
                if overall is None:
                    continue
                rows.append({
                    "manager_id": row["manager_id"],
                    "gameweek": gameweek,
                    "matchday_sequence": matchday_sequence,
                    "matchday_date": matchday_date,
                    "first_kickoff_at": first_kickoff_at,
                    "overall_rank_baseline": overall,
                    "gameweek_rank_baseline": row.get("gameweek_rank"),
                    "captured_at": datetime.now(timezone.utc).isoformat(),
                })
            if rows:
                self.db_client.upsert_matchday_baselines(rows)
                logger.info("Captured matchday baselines", extra={
                    "gameweek": gameweek,
                    "matchday_sequence": matchday_sequence,
                    "managers": len(rows),
                })
            return len(rows)
        except Exception as e:
            logger.error("Capture matchday baselines failed", extra={
                "gameweek": gameweek,
                "matchday_sequence": matchday_sequence,
                "error": str(e),
            }, exc_info=True)
            return 0

    def should_capture_baselines(
        self,
        gameweek: int,
        deadline_time: datetime,
        current_time: datetime
    ) -> bool:
        """
        Determine if we should capture baselines for a gameweek.
        
        Conditions:
        - After transfer deadline has passed
        - Before first match starts (or matches haven't started yet)
        - Baselines not already captured
        
        Args:
            gameweek: Gameweek number
            deadline_time: Transfer deadline time
            current_time: Current time
            
        Returns:
            True if baselines should be captured
        """
        # Check if deadline has passed
        if current_time < deadline_time:
            return False
        
        # Check if baselines already exist for this gameweek
        existing = self.db_client.client.table("manager_gameweek_history").select(
            "baseline_total_points"
        ).eq("gameweek", gameweek).limit(1).execute().data
        
        if existing and existing[0].get("baseline_total_points") is not None:
            # Baselines already captured
            return False
        
        # Critical gate: do not capture baselines after any fixture has started (wrong delta baseline)
        fixtures = self.db_client.client.table("fixtures").select(
            "started"
        ).eq("gameweek", gameweek).execute().data
        
        if fixtures and any(f.get("started") for f in fixtures):
            logger.warning("Skipping baseline capture: at least one fixture has started", extra={
                "gameweek": gameweek
            })
            return False
        
        return True
