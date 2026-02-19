"""
Manager data refresh module.

Handles refreshing manager picks, transfers, and calculating points.
"""

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set

from database.supabase_client import SupabaseClient
from fpl_api.client import FPLAPIClient
from utils.points_calculator import PointsCalculator

logger = logging.getLogger(__name__)


class ManagerDataRefresher:
    """Handles manager data refresh operations."""
    
    def __init__(
        self,
        fpl_client: FPLAPIClient,
        db_client: SupabaseClient
    ):
        self.fpl_client = fpl_client
        self.db_client = db_client
        self.points_calculator = PointsCalculator(db_client, fpl_client)
        # Track last count of players with confirmed bonuses per gameweek
        # Used to detect when new bonuses are confirmed (works for any day of week)
        # e.g., Saturday → Sunday → Monday games
        self._last_confirmed_bonus_count: Dict[int, int] = {}
    
    async def wait_for_api_after_deadline(
        self,
        deadline_time: datetime,
        current_time: datetime
    ) -> bool:
        """
        Wait for FPL API to return after maintenance window.
        
        Args:
            deadline_time: Transfer deadline time
            current_time: Current time
            
        Returns:
            True if API is available
        """
        time_since_deadline = (current_time - deadline_time).total_seconds() / 60
        
        # Only wait if we're in the post-deadline window (0-60 minutes)
        if time_since_deadline < 0 or time_since_deadline > 60:
            return True
        
        # Poll with exponential backoff: 2min → 3min → 5min → 5min (max)
        base_delay = 120  # 2 minutes
        max_delay = 300   # 5 minutes
        max_attempts = 20  # Up to ~60 minutes total wait time
        
        for attempt in range(max_attempts):
            try:
                # Try a lightweight endpoint to check API availability
                await self.fpl_client.get_bootstrap_static()
                
                logger.info("FPL API back online", extra={
                    "time_since_deadline_min": time_since_deadline,
                    "attempt": attempt + 1
                })
                return True
                
            except Exception as e:
                if attempt < max_attempts - 1:
                    delay = min(base_delay + (attempt * 60), max_delay)
                    logger.info(
                        "FPL API in maintenance, waiting",
                        extra={
                            "time_since_deadline_min": time_since_deadline,
                            "attempt": attempt + 1,
                            "wait_time": delay
                        }
                    )
                    await asyncio.sleep(delay)
                    continue
                else:
                    logger.warning(
                        "FPL API still in maintenance (max attempts)",
                        extra={"time_since_deadline_min": time_since_deadline}
                    )
                    raise
        
        return False
    
    def sync_auto_sub_flags_to_picks(
        self,
        manager_id: int,
        gameweek: int,
    ) -> None:
        """
        Sync inferred auto-sub state to manager_picks so the UI shows sub indicators
        proactively (when a starter is confirmed 0 mins + match finished).
        Called after refreshing manager points in LIVE_MATCHES/BONUS_PENDING so flags
        stay in sync with calculated points without waiting for the TRANSFER_DEADLINE batch.
        """
        try:
            picks_result = self.db_client.client.table("manager_picks").select(
                "player_id, position, is_captain, is_vice_captain, multiplier, "
                "was_auto_subbed_out, was_auto_subbed_in, auto_sub_replaced_player_id"
            ).eq("manager_id", manager_id).eq("gameweek", gameweek).order(
                "position", desc=False
            ).execute()
            picks_rows = picks_result.data if picks_result.data else []
            if not picks_rows:
                return
            picks_for_inference = [
                {"player_id": row["player_id"], "position": row["position"]}
                for row in picks_rows
            ]
            automatic_subs = self.points_calculator.infer_automatic_subs_from_db(
                gameweek, picks_for_inference
            )
            subbed_out: Set[int] = set()
            replaced_player_by_sub_in: Dict[int, int] = {}
            for sub in automatic_subs:
                out_id = sub.get("element_out")
                in_id = sub.get("element_in")
                if out_id is not None and in_id is not None:
                    subbed_out.add(out_id)
                    replaced_player_by_sub_in[in_id] = out_id
            now_iso = datetime.now(timezone.utc).isoformat()
            for row in picks_rows:
                player_id = row["player_id"]
                was_out = player_id in subbed_out
                was_in = player_id in replaced_player_by_sub_in
                replaced_id = replaced_player_by_sub_in.get(player_id)
                if (
                    row.get("was_auto_subbed_out") == was_out
                    and row.get("was_auto_subbed_in") == was_in
                    and row.get("auto_sub_replaced_player_id") == replaced_id
                ):
                    continue
                pick_data = {
                    "manager_id": manager_id,
                    "gameweek": gameweek,
                    "player_id": player_id,
                    "position": row["position"],
                    "is_captain": row.get("is_captain", False),
                    "is_vice_captain": row.get("is_vice_captain", False),
                    "multiplier": row.get("multiplier", 1),
                    "was_auto_subbed_out": was_out,
                    "was_auto_subbed_in": was_in,
                    "auto_sub_replaced_player_id": replaced_id,
                    "updated_at": now_iso,
                }
                self.db_client.upsert_manager_pick(pick_data)
            if automatic_subs:
                logger.debug(
                    "Synced auto-sub flags to manager_picks",
                    extra={
                        "manager_id": manager_id,
                        "gameweek": gameweek,
                        "count": len(automatic_subs),
                    },
                )
        except Exception as e:
            logger.warning(
                "Failed to sync auto-sub flags to manager_picks",
                extra={"manager_id": manager_id, "gameweek": gameweek, "error": str(e)},
                exc_info=True,
            )
    
    async def refresh_manager_picks(
        self,
        manager_id: int,
        gameweek: int,
        deadline_time: Optional[datetime] = None,
        use_cache: bool = True
    ):
        """
        Refresh manager picks for a gameweek.
        
        OPTIMIZATION: Checks database first before calling API (picks locked at deadline).
        
        Args:
            manager_id: Manager ID
            gameweek: Gameweek number
            deadline_time: Optional deadline time for maintenance window handling
            use_cache: If True, check database first before API call
        """
        try:
            # OPTIMIZATION: Check database first if use_cache is True
            if use_cache:
                existing_picks = self.db_client.client.table("manager_picks").select(
                    "player_id, position, is_captain, is_vice_captain, multiplier, was_auto_subbed_out, was_auto_subbed_in, auto_sub_replaced_player_id"
                ).eq("manager_id", manager_id).eq("gameweek", gameweek).execute().data
                
                # If picks exist in database, still need to fetch from API for auto-subs updates
                # But we can skip if picks are already stored and we're not in live matches
                # For now, always fetch to get latest auto-subs, but this reduces API calls
                # when picks don't exist yet (initial load)
                if existing_picks:
                    logger.debug("Found cached manager picks in database", extra={
                        "manager_id": manager_id,
                        "gameweek": gameweek,
                        "picks_count": len(existing_picks)
                    })
                    # Still fetch from API to get latest auto-subs, but log that we found cached picks
            
            # Wait for API if after deadline
            if deadline_time:
                current_time = datetime.now(timezone.utc)
                await self.wait_for_api_after_deadline(deadline_time, current_time)
            
            picks_data = await self.fpl_client.get_entry_picks(manager_id, gameweek)
            
            # Upsert manager: manager_team_name = entry/squad name, manager_name = person name (preserve backfilled)
            entry_data = await self.fpl_client.get_entry(manager_id)
            team_name = (
                entry_data.get("name")
                or entry_data.get("entry_name")
                or (entry_data.get("player_first_name", "") + " " + entry_data.get("player_last_name", "")).strip()
                or f"Manager {manager_id}"
            )
            person_name = (
                (entry_data.get("player_first_name") or "").strip() + " " + (entry_data.get("player_last_name") or "").strip()
            ).strip() or None
            existing = self.db_client.get_manager(manager_id)
            # Use person name from API when present; otherwise keep existing manager_name (backfilled) so we don't overwrite with team_name
            if person_name:
                manager_name = person_name
            elif existing and (existing.get("manager_name") or "").strip():
                manager_name = (existing.get("manager_name") or "").strip()
            else:
                manager_name = team_name
            manager_data = {
                "manager_id": manager_id,
                "manager_name": manager_name,
                "manager_team_name": team_name,
                "favourite_team_id": entry_data.get("favourite_team"),
                "joined_time": entry_data.get("joined_time"),
                "updated_at": datetime.now(timezone.utc).isoformat()
            }
            self.db_client.upsert_manager(manager_data)
            
            # Store picks
            picks = picks_data.get("picks", [])
            automatic_subs = picks_data.get("automatic_subs", [])
            # When FPL API has not yet returned automatic_subs (e.g. match just finished),
            # infer from DB so UI can show auto-sub indicators and flags stay in sync with points
            if not automatic_subs and picks:
                picks_for_inference = [
                    {"player_id": p["element"], "position": p["position"]}
                    for p in picks
                ]
                automatic_subs = self.points_calculator.infer_automatic_subs_from_db(
                    gameweek, picks_for_inference
                )
                if automatic_subs:
                    logger.debug(
                        "Inferred automatic_subs from DB (API had none)",
                        extra={
                            "manager_id": manager_id,
                            "gameweek": gameweek,
                            "count": len(automatic_subs),
                        },
                    )
            active_chip = picks_data.get("active_chip")
            entry_history = picks_data.get("entry_history") or {}
            gameweek_rank = entry_history.get("rank")
            
            for pick in picks:
                is_captain = pick.get("is_captain", False)
                raw_mult = pick.get("multiplier", 1)
                # Ensure captain/triple-captain multiplier is set even if API omits it
                if raw_mult == 1 and is_captain:
                    multiplier = 3 if active_chip == "3xc" else 2
                else:
                    multiplier = raw_mult if raw_mult in (1, 2, 3) else 1
                pick_data = {
                    "manager_id": manager_id,
                    "gameweek": gameweek,
                    "player_id": pick["element"],
                    "position": pick["position"],
                    "is_captain": is_captain,
                    "is_vice_captain": pick.get("is_vice_captain", False),
                    "multiplier": multiplier,
                    "was_auto_subbed_out": False,
                    "was_auto_subbed_in": False,
                    "auto_sub_replaced_player_id": None,
                    "updated_at": datetime.now(timezone.utc).isoformat()
                }
                
                # Check if this pick was auto-subbed
                for auto_sub in automatic_subs:
                    if auto_sub.get("element_out") == pick["element"]:
                        pick_data["was_auto_subbed_out"] = True
                    if auto_sub.get("element_in") == pick["element"]:
                        pick_data["was_auto_subbed_in"] = True
                        pick_data["auto_sub_replaced_player_id"] = auto_sub.get("element_out")
                
                self.db_client.upsert_manager_pick(pick_data)
            
            logger.debug("Refreshed manager picks", extra={
                "manager_id": manager_id,
                "gameweek": gameweek,
                "picks_count": len(picks)
            })
            # Return metadata for deadline batch fast path (avoids duplicate picks fetch in history phase)
            return {"active_chip": active_chip, "gameweek_rank": gameweek_rank}
            
        except Exception as e:
            logger.error("Error refreshing manager picks", extra={
                "manager_id": manager_id,
                "gameweek": gameweek,
                "error": str(e)
            }, exc_info=True)
            return None
    
    async def refresh_manager_transfers(
        self,
        manager_id: int,
        gameweek: int
    ):
        """
        Refresh manager transfers for a gameweek.
        
        Args:
            manager_id: Manager ID
            gameweek: Gameweek number
        """
        try:
            transfers = await self.fpl_client.get_entry_transfers(manager_id)
            
            # Filter to current gameweek
            gw_transfers = [
                t for t in transfers
                if t.get("event") == gameweek
            ]
            
            # Get bootstrap for prices
            bootstrap = await self.fpl_client.get_bootstrap_static()
            players_map = {p["id"]: p for p in bootstrap.get("elements", [])}
            
            for transfer in gw_transfers:
                player_in_id = transfer.get("element_in")
                player_out_id = transfer.get("element_out")
                
                # Get prices at time of transfer
                player_in = players_map.get(player_in_id, {})
                player_out = players_map.get(player_out_id, {})
                
                price_in = player_in.get("now_cost", 0)
                price_out = player_out.get("now_cost", 0)
                net_change = price_in - price_out
                
                transfer_data = {
                    "manager_id": manager_id,
                    "gameweek": gameweek,
                    "player_in_id": player_in_id,
                    "player_out_id": player_out_id,
                    "transfer_time": transfer.get("time"),
                    "price_in_tenths": price_in,
                    "price_out_tenths": price_out,
                    "net_price_change_tenths": net_change,
                    "updated_at": datetime.now(timezone.utc).isoformat()
                }
                
                self.db_client.upsert_manager_transfer(transfer_data)
            
            logger.debug("Refreshed manager transfers", extra={
                "manager_id": manager_id,
                "gameweek": gameweek,
                "transfers_count": len(gw_transfers)
            })
            
        except Exception as e:
            logger.error("Error refreshing manager transfers", extra={
                "manager_id": manager_id,
                "gameweek": gameweek,
                "error": str(e)
            }, exc_info=True)
    
    async def build_player_whitelist(
        self,
        league_id: int,
        gameweek: int
    ):
        """
        Build player whitelist for a league and gameweek.
        
        Args:
            league_id: League ID
            gameweek: Gameweek number
        """
        try:
            # Get all managers in league
            managers = self.db_client.client.table("mini_league_managers").select(
                "manager_id"
            ).eq("league_id", league_id).execute().data
            
            manager_ids = [m["manager_id"] for m in managers]
            
            # Get all picks for these managers in this gameweek
            owned_players = set()
            
            for manager_id in manager_ids:
                picks = self.db_client.client.table("manager_picks").select(
                    "player_id"
                ).eq("manager_id", manager_id).eq("gameweek", gameweek).execute().data
                
                for pick in picks:
                    owned_players.add(pick["player_id"])
            
            # Store whitelist
            for player_id in owned_players:
                whitelist_data = {
                    "league_id": league_id,
                    "gameweek": gameweek,
                    "player_id": player_id
                }
                # Note: Would need a method in db_client for whitelist
                # For now, use direct table access
                self.db_client.client.table("player_whitelist").upsert(
                    whitelist_data,
                    on_conflict="league_id,gameweek,player_id"
                ).execute()
            
            logger.info("Player whitelist built", extra={
                "league_id": league_id,
                "gameweek": gameweek,
                "players_count": len(owned_players),
                "managers_count": len(manager_ids)
            })
            
        except Exception as e:
            logger.error("Player whitelist failed", extra={
                "league_id": league_id,
                "gameweek": gameweek,
                "error": str(e)
            }, exc_info=True)
    
    async def calculate_manager_points(
        self,
        manager_id: int,
        gameweek: int
    ) -> Dict:
        """
        Calculate manager points for a gameweek.
        
        Args:
            manager_id: Manager ID
            gameweek: Gameweek number
            
        Returns:
            Dictionary with calculated points data
        """
        return await self.points_calculator.calculate_manager_gameweek_points(
            manager_id,
            gameweek
        )
    
    def _check_new_bonuses_confirmed(self, gameweek: int) -> bool:
        """
        Check if new bonuses were confirmed since last check.
        
        Tracks the count of players with confirmed bonuses per gameweek.
        When the count increases, it means new bonuses were just confirmed
        (e.g., after Saturday games, Sunday games, Monday games, etc.).
        Works for any day of the week.
        
        FPL API only updates gameweek_rank and overall_rank after bonuses are confirmed
        (~1 hour after each game day's final match). We need to detect when NEW bonuses
        are confirmed to refresh ranks after each game day, not just when all bonuses are confirmed.
        
        Args:
            gameweek: Gameweek number
            
        Returns:
            True if new bonuses were confirmed (count increased), False otherwise
        """
        try:
            # Get all finished fixtures for this gameweek
            fixtures = self.db_client.client.table("fixtures").select(
                "fpl_fixture_id, finished"
            ).eq("gameweek", gameweek).execute().data
            
            finished_fixture_ids = {f["fpl_fixture_id"] for f in fixtures if f.get("finished", False)}
            
            if not finished_fixture_ids:
                # No finished fixtures yet
                return False
            
            # Count players with confirmed bonuses in finished fixtures
            # A player has confirmed bonus if:
            # - They're in a finished fixture AND
            # - (bonus > 0 OR bonus_status = 'confirmed')
            # bonus > 0 means official bonus field is populated (FPL confirmed it)
            # Note: bonus = 0 with bonus_status = 'confirmed' means player got 0 bonus but it's been confirmed
            stats = self.db_client.client.table("player_gameweek_stats").select(
                "bonus, bonus_status, fixture_id"
            ).eq("gameweek", gameweek).in_("fixture_id", list(finished_fixture_ids)).execute().data
            
            # Count players with confirmed bonuses
            # Bonus is confirmed if bonus > 0 (official bonus populated) OR bonus_status = 'confirmed'
            current_count = 0
            for stat in stats:
                bonus = stat.get("bonus", 0)
                bonus_status = stat.get("bonus_status")
                fixture_id = stat.get("fixture_id")
                
                # Skip if fixture_id is None (shouldn't happen due to filter, but be safe)
                if fixture_id is None:
                    continue
                
                # Bonus is confirmed if official bonus is populated (bonus > 0) 
                # OR bonus_status is explicitly 'confirmed'
                # Note: bonus = 0 with bonus_status = 'confirmed' is still confirmed (just 0 points)
                if bonus > 0 or bonus_status == "confirmed":
                    current_count += 1
            
            # Get last count for this gameweek
            last_count = self._last_confirmed_bonus_count.get(gameweek, 0)
            
            # If current count > last count, new bonuses were confirmed
            if current_count > last_count:
                logger.info("New bonuses confirmed", extra={
                    "gameweek": gameweek,
                    "last_count": last_count,
                    "current_count": current_count,
                    "new_bonuses": current_count - last_count
                })
                # Update stored count
                self._last_confirmed_bonus_count[gameweek] = current_count
                return True
            
            # Update stored count even if no new bonuses (for tracking)
            self._last_confirmed_bonus_count[gameweek] = current_count
            return False
            
        except Exception as e:
            logger.warning("Bonus check failed", extra={
                "gameweek": gameweek,
                "error": str(e)
            })
            return False
    
    async def check_fpl_rank_change(self, manager_id: int, gameweek: int) -> bool:
        """
        Check if FPL API has updated overall_rank or gameweek_rank for this manager/gameweek.
        Used to trigger full manager refresh and drop stale indicator when FPL has finalized ranks.
        
        Returns:
            True if API returns rank values that differ from our stored values (or we had none stored).
        """
        try:
            history = await self.fpl_client.get_entry_history(manager_id)
            picks_data = await self.fpl_client.get_entry_picks(manager_id, gameweek)
            
            current_list = history.get("current", []) or []
            gw_history = next((h for h in current_list if h.get("event") == gameweek), None)
            api_overall_rank = gw_history.get("overall_rank") if gw_history else None
            entry_history = picks_data.get("entry_history", {}) or {}
            api_gw_rank = entry_history.get("rank")
            
            existing = self.db_client.client.table("manager_gameweek_history").select(
                "gameweek_rank, overall_rank"
            ).eq("manager_id", manager_id).eq("gameweek", gameweek).execute().data
            
            stored = existing[0] if existing else {}
            stored_overall = stored.get("overall_rank")
            stored_gw_rank = stored.get("gameweek_rank")
            
            overall_changed = (
                api_overall_rank is not None
                and (stored_overall is None or stored_overall != api_overall_rank)
            )
            gw_rank_changed = (
                api_gw_rank is not None
                and (stored_gw_rank is None or stored_gw_rank != api_gw_rank)
            )
            
            if overall_changed or gw_rank_changed:
                logger.info("FPL rank changed", extra={
                    "manager_id": manager_id,
                    "gameweek": gameweek,
                    "api_overall_rank": api_overall_rank,
                    "stored_overall_rank": stored_overall,
                    "api_gw_rank": api_gw_rank,
                    "stored_gw_rank": stored_gw_rank
                })
                return True
            return False
        except Exception as e:
            logger.warning("FPL rank check failed", extra={
                "manager_id": manager_id,
                "gameweek": gameweek,
                "error": str(e)
            })
            return False

    async def refresh_manager_gameweek_points_live_only(
        self, manager_ids: List[int], gameweek: int
    ) -> bool:
        """
        Update manager_gameweek_history gameweek_points and total_points from DB-only calculation (no FPL API).
        Used during live matches so standings update every fast cycle without waiting for slow loop.

        Returns:
            True if all managers were updated successfully; False if any calc or DB update failed.
            Caller should only refresh mv_mini_league_standings when True to avoid showing incomplete standings.
        """
        if not manager_ids:
            return True
        batch_size = 8
        any_failed = False
        for i in range(0, len(manager_ids), batch_size):
            batch = manager_ids[i : i + batch_size]
            # Calculate points for batch in parallel (DB-only: manager_picks + player_gameweek_stats)
            tasks = [self.calculate_manager_points(mid, gameweek) for mid in batch]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            # Load existing baseline_total_points for this batch
            existing = self.db_client.client.table("manager_gameweek_history").select(
                "manager_id, baseline_total_points"
            ).eq("gameweek", gameweek).in_("manager_id", batch).execute().data or []
            baseline_by_manager = {r["manager_id"]: r.get("baseline_total_points") for r in existing}
            for manager_id, points_result in zip(batch, results):
                if isinstance(points_result, Exception):
                    logger.warning("Live-only points calc failed", extra={"manager_id": manager_id, "error": str(points_result)})
                    any_failed = True
                    continue
                gameweek_points = points_result.get("gameweek_points", 0)
                baseline = baseline_by_manager.get(manager_id)
                total_points = (baseline if baseline is not None else 0) + gameweek_points
                try:
                    self.db_client.update_manager_gameweek_history_points(
                        manager_id, gameweek, gameweek_points, total_points
                    )
                except Exception as e:
                    logger.warning("Live-only mgh update failed", extra={"manager_id": manager_id, "error": str(e)})
                    any_failed = True
        return not any_failed

    async def refresh_manager_gameweek_points_from_live_data(
        self,
        manager_ids: List[int],
        gameweek: int,
        live_data: Dict[str, Any],
        fixtures_by_fixture_id: Dict[int, Dict[str, Any]],
    ) -> bool:
        """
        Update manager_gameweek_history gameweek_points and total_points from live_data in memory.
        Uses 4 batched DB reads + in-memory computation + parallel writes. No per-manager/per-player DB loops.
        Call when event-live payload is available (e.g. fast cycle during live matches).

        fixtures_by_fixture_id: fpl_fixture_id -> fixture dict with team_h, team_a, finished, finished_provisional.

        Returns:
            True if all managers were updated successfully; False if any failed.
        """
        if not manager_ids or not live_data or not live_data.get("elements"):
            return False

        elements = live_data.get("elements", [])
        live_elements = {int(e["id"]): e for e in elements if "id" in e}

        # 1. Batched picks
        picks_result = self.db_client.client.table("manager_picks").select(
            "manager_id, player_id, position, multiplier"
        ).eq("gameweek", gameweek).in_("manager_id", manager_ids).execute()
        picks_all = picks_result.data or []

        if not picks_all:
            return True

        # 2. Batched history (current gw)
        history_result = self.db_client.client.table("manager_gameweek_history").select(
            "manager_id, baseline_total_points, transfer_cost, active_chip"
        ).eq("gameweek", gameweek).in_("manager_id", manager_ids).execute()
        history_by_manager = {r["manager_id"]: r for r in (history_result.data or [])}

        # Previous gameweek totals for managers with no baseline
        need_prev = [mid for mid in manager_ids if (history_by_manager.get(mid) or {}).get("baseline_total_points") is None]
        prev_by_manager: Dict[int, int] = {}
        if need_prev and gameweek > 1:
            prev_result = self.db_client.client.table("manager_gameweek_history").select(
                "manager_id, total_points"
            ).eq("gameweek", gameweek - 1).in_("manager_id", need_prev).execute()
            prev_by_manager = {r["manager_id"]: r["total_points"] for r in (prev_result.data or [])}

        # 3. Players: position and team_id for all picked player_ids
        player_ids = list(set(p["player_id"] for p in picks_all))
        players_result = self.db_client.client.table("players").select(
            "fpl_player_id, position, team_id"
        ).in_("fpl_player_id", player_ids).execute()
        players_list = players_result.data or []
        position_by_player_id = {p["fpl_player_id"]: p["position"] for p in players_list}
        team_id_by_player_id = {p["fpl_player_id"]: p["team_id"] for p in players_list}

        # 4. Build player_minutes and player_fixtures from live_data + fixtures_by_fixture_id
        player_minutes: Dict[int, int] = {}
        player_fixtures: Dict[int, Dict[str, Any]] = {}
        for pid in player_ids:
            elem = live_elements.get(pid)
            player_minutes[pid] = 0
            if elem and elem.get("stats") is not None:
                player_minutes[pid] = int(elem.get("stats", {}).get("minutes") or 0)
            team_id = team_id_by_player_id.get(pid)
            if team_id is not None and fixtures_by_fixture_id:
                matching = [
                    f for f in fixtures_by_fixture_id.values()
                    if f.get("team_h") == team_id or f.get("team_a") == team_id
                ]
                if matching:
                    all_finished = all(m.get("finished", False) for m in matching)
                    any_provisional = any(m.get("finished_provisional", False) for m in matching)
                    player_fixtures[pid] = {
                        "finished": all_finished and not any_provisional,
                        "finished_provisional": any_provisional and all_finished,
                    }
                else:
                    player_fixtures[pid] = {"finished": False, "finished_provisional": False}
            else:
                player_fixtures[pid] = {"finished": False, "finished_provisional": False}

        # Group picks by manager
        picks_by_manager: Dict[int, List[Dict]] = {}
        for p in picks_all:
            mid = p["manager_id"]
            if mid not in picks_by_manager:
                picks_by_manager[mid] = []
            picks_by_manager[mid].append(dict(p))

        # Compute and write per manager (sync work run in thread pool for parallel writes)
        def update_one(manager_id: int) -> None:
            manager_picks = picks_by_manager.get(manager_id, [])
            if not manager_picks:
                return
            hist = history_by_manager.get(manager_id) or {}
            transfer_cost = int(hist.get("transfer_cost") or 0)
            active_chip = hist.get("active_chip")
            baseline = hist.get("baseline_total_points")
            prev_total = prev_by_manager.get(manager_id)

            adjusted_picks = self.points_calculator.apply_automatic_subs(
                manager_picks,
                [],
                player_minutes,
                player_fixtures,
                position_by_player_id=position_by_player_id,
            )
            starters = [p for p in adjusted_picks if p["position"] <= 11]
            bench = [p for p in adjusted_picks if p["position"] > 11]

            raw_points = 0
            for pick in starters:
                pid = pick["player_id"]
                mult = int(pick.get("multiplier") or 1)
                pts = 0
                if pid in live_elements and live_elements[pid].get("stats") is not None:
                    pts = int(live_elements[pid].get("stats", {}).get("total_points") or 0)
                raw_points += pts * mult
            if active_chip == "bboost":
                for pick in bench:
                    pid = pick["player_id"]
                    pts = 0
                    if pid in live_elements and live_elements[pid].get("stats") is not None:
                        pts = int(live_elements[pid].get("stats", {}).get("total_points") or 0)
                    raw_points += pts

            gameweek_points = max(0, raw_points - transfer_cost)
            if baseline is not None:
                total_points = baseline + gameweek_points
            elif prev_total is not None:
                total_points = prev_total + gameweek_points
            else:
                total_points = gameweek_points

            self.db_client.update_manager_gameweek_history_points(
                manager_id, gameweek, gameweek_points, total_points
            )

        try:
            loop = asyncio.get_event_loop()
            await asyncio.gather(*[loop.run_in_executor(None, lambda m=mid: update_one(m)) for mid in manager_ids])
            return True
        except Exception as e:
            logger.warning(
                "Manager points from live_data update failed",
                extra={"gameweek": gameweek, "error": str(e)},
                exc_info=True,
            )
            return False

    async def refresh_manager_gameweek_history(
        self,
        manager_id: int,
        gameweek: int,
        pre_fetched_history: Optional[Dict[str, Any]] = None,
        is_finished: Optional[bool] = None
    ):
        """
        Refresh manager gameweek history.
        
        OPTIMIZATION: For finished gameweeks, uses FPL API data directly
        instead of calculating points (much faster for backfills).
        
        Args:
            manager_id: Manager ID
            gameweek: Gameweek number
            pre_fetched_history: Optional pre-fetched history dict (avoids redundant API call)
            is_finished: Optional pre-fetched finished status (avoids redundant DB query)
        """
        try:
            # Check if gameweek is finished (use pre-fetched if available)
            if is_finished is None:
                gameweek_data = self.db_client.client.table("gameweeks").select(
                    "finished"
                ).eq("id", gameweek).execute().data
                is_finished = gameweek_data[0]["finished"] if gameweek_data else False
            
            # Get entry history (use pre-fetched if available, otherwise fetch)
            if pre_fetched_history:
                history = pre_fetched_history
            else:
                history = await self.fpl_client.get_entry_history(manager_id)
            gw_history = next(
                (h for h in history.get("current", []) if h.get("event") == gameweek),
                {}
            )
            
            # Get existing history with baseline data (preserve baselines and deadline-only fields during live)
            existing_history = self.db_client.client.table("manager_gameweek_history").select(
                "baseline_total_points, total_points, previous_mini_league_rank, previous_overall_rank, mini_league_rank, "
                "team_value_tenths, bank_tenths, active_chip"
            ).eq("manager_id", manager_id).eq("gameweek", gameweek).execute().data
            
            existing = existing_history[0] if existing_history else {}
            baseline_total = existing.get("baseline_total_points")
            existing_mini_league_rank = existing.get("mini_league_rank")
            
            # Always use our calculated points (includes auto-subs, no double count) so we never overwrite with lower API values.
            # For finished gameweeks we still fetch ranks from API; points come from our calc.
            if is_finished:
                points_data_finished = await self.calculate_manager_points(manager_id, gameweek)
                gameweek_points = points_data_finished.get("gameweek_points", 0)
                transfer_cost = points_data_finished.get("transfer_cost", 0)
                active_chip = points_data_finished.get("active_chip")
                if baseline_total is not None:
                    current_total = baseline_total + gameweek_points
                else:
                    previous_gw = gameweek - 1
                    previous_history = self.db_client.client.table("manager_gameweek_history").select(
                        "total_points"
                    ).eq("manager_id", manager_id).eq("gameweek", previous_gw).execute().data
                    previous_total = previous_history[0]["total_points"] if previous_history else None
                    current_total = (previous_total + gameweek_points) if previous_total is not None else (gw_history.get("total_points") or gameweek_points)
                # Ranks from API
                gameweek_rank = None
                overall_rank = gw_history.get("overall_rank")
                try:
                    picks_data = await self.fpl_client.get_entry_picks(manager_id, gameweek)
                    entry_history = picks_data.get("entry_history", {})
                    gameweek_rank = entry_history.get("rank")
                    if overall_rank is None:
                        overall_rank = gw_history.get("overall_rank")
                except Exception as e:
                    logger.warning("Failed to fetch picks for finished gameweek", extra={
                        "manager_id": manager_id,
                        "gameweek": gameweek,
                        "error": str(e)
                    })
                    existing_ranks = self.db_client.client.table("manager_gameweek_history").select(
                        "gameweek_rank, overall_rank, active_chip"
                    ).eq("manager_id", manager_id).eq("gameweek", gameweek).execute().data
                    if existing_ranks:
                        gameweek_rank = existing_ranks[0].get("gameweek_rank")
                        overall_rank = overall_rank or existing_ranks[0].get("overall_rank")
                        if active_chip is None:
                            active_chip = existing_ranks[0].get("active_chip")
                logger.debug("Using calculated points for finished gameweek (includes auto-subs)", extra={
                    "manager_id": manager_id,
                    "gameweek": gameweek,
                    "gameweek_points": gameweek_points,
                    "total_points": current_total
                })
            else:
                # Live gameweek: Calculate points (needed for real-time updates)
                points_data = await self.calculate_manager_points(manager_id, gameweek)
                gameweek_points = points_data["gameweek_points"]
                transfer_cost = points_data.get("transfer_cost", 0)
                active_chip = points_data.get("active_chip")
                
                # Always try to fetch ranks from FPL for live gameweeks (available after each matchday)
                gameweek_rank = None
                overall_rank = None
                try:
                    picks_data = await self.fpl_client.get_entry_picks(manager_id, gameweek)
                    entry_history = picks_data.get("entry_history", {}) or {}
                    gameweek_rank = entry_history.get("rank")
                    overall_rank = gw_history.get("overall_rank")
                    if gameweek_rank is not None or overall_rank is not None:
                        logger.debug("Ranks from API (live)", extra={
                            "manager_id": manager_id,
                            "gameweek": gameweek,
                            "gameweek_rank": gameweek_rank,
                            "overall_rank": overall_rank
                        })
                except Exception as e:
                    logger.debug("Ranks fetch failed, preserving existing", extra={
                        "manager_id": manager_id,
                        "gameweek": gameweek,
                        "error": str(e)
                    })
                if gameweek_rank is None and overall_rank is None:
                    existing_ranks = self.db_client.client.table("manager_gameweek_history").select(
                        "gameweek_rank, overall_rank"
                    ).eq("manager_id", manager_id).eq("gameweek", gameweek).execute().data
                    if existing_ranks:
                        gameweek_rank = existing_ranks[0].get("gameweek_rank")
                        overall_rank = existing_ranks[0].get("overall_rank")
                
                # For live gameweeks, determine total_points from baseline + gameweek_points
                if baseline_total is not None:
                    # Baseline exists - use it as foundation
                    current_total = baseline_total + gameweek_points
                else:
                    # No baseline - try to establish from previous gameweek
                    previous_gw = gameweek - 1
                    previous_history = self.db_client.client.table("manager_gameweek_history").select(
                        "total_points"
                    ).eq("manager_id", manager_id).eq("gameweek", previous_gw).execute().data
                    
                    previous_total = previous_history[0]["total_points"] if previous_history else None
                    if previous_total is not None:
                        current_total = previous_total + gameweek_points
                    else:
                        # Last resort: use FPL API or calculated
                        fpl_total = gw_history.get("total_points")
                        current_total = fpl_total if fpl_total is not None else gameweek_points
            
            # Backfill previous_overall_rank when missing (e.g. missed post-deadline capture or freeze just lifted)
            previous_overall_rank = existing.get("previous_overall_rank")
            if previous_overall_rank is None and gameweek > 1:
                prev_gw_rows = self.db_client.client.table("manager_gameweek_history").select(
                    "overall_rank"
                ).eq("manager_id", manager_id).eq("gameweek", gameweek - 1).limit(1).execute().data
                if prev_gw_rows and prev_gw_rows[0].get("overall_rank") is not None:
                    previous_overall_rank = prev_gw_rows[0]["overall_rank"]
                    logger.debug("Backfilled previous_overall_rank from previous GW", extra={
                        "manager_id": manager_id,
                        "gameweek": gameweek,
                        "previous_overall_rank": previous_overall_rank
                    })

            # Calculate overall rank change from baseline
            overall_rank_change = None
            if previous_overall_rank is not None and overall_rank is not None:
                overall_rank_change = previous_overall_rank - overall_rank

            # Team value and bank: for current gameweek prefer entry endpoint (last_deadline_value/bank)
            # so we get the latest value after price changes; fallback to history then existing.
            # FPL API returns value in tenths (e.g. 1005 = £100.5m); sometimes returns float (100.5) - normalize to int tenths.
            def _to_tenths(v):
                if v is None:
                    return None
                try:
                    n = float(v)
                    if n <= 0:
                        return None
                    # If value looks like "full" units (e.g. 100.5 for £100.5m), convert to tenths
                    if n < 200 and isinstance(v, float):
                        return int(round(n * 10))
                    return int(round(n))
                except (TypeError, ValueError):
                    return None

            _team_value = _to_tenths(gw_history.get("value"))
            _bank = _to_tenths(gw_history.get("bank"))
            is_current_gw = False
            try:
                gw_row = self.db_client.client.table("gameweeks").select("is_current").eq("id", gameweek).limit(1).execute().data
                is_current_gw = bool(gw_row and gw_row[0].get("is_current"))
            except Exception:
                pass
            if is_current_gw:
                try:
                    entry = await self.fpl_client.get_entry(manager_id)
                    if entry.get("last_deadline_value") is not None:
                        _team_value = _to_tenths(entry["last_deadline_value"])
                    if entry.get("last_deadline_bank") is not None:
                        _bank = _to_tenths(entry["last_deadline_bank"])
                except Exception as e:
                    logger.debug("get_entry for team value failed", extra={"manager_id": manager_id, "error": str(e)})
            if _team_value is None:
                _team_value = existing.get("team_value_tenths")
            if _bank is None:
                _bank = existing.get("bank_tenths")

            # Build history data - preserve baseline columns and mini_league_rank if they exist.
            if is_finished:
                _chip = active_chip
            else:
                # For live gameweeks, use API active_chip when available so chip is persisted after deadline
                _chip = active_chip if active_chip is not None else existing.get("active_chip")
            history_data = {
                "manager_id": manager_id,
                "gameweek": gameweek,
                "gameweek_points": gameweek_points,
                "transfer_cost": transfer_cost,
                "total_points": current_total,
                "overall_rank": overall_rank,
                "overall_rank_change": overall_rank_change,
                "gameweek_rank": gameweek_rank,
                "transfers_made": gw_history.get("event_transfers", 0),
                "active_chip": _chip,
                "updated_at": datetime.now(timezone.utc).isoformat()
            }
            # Only set team value/bank when we have a value (don't overwrite with None)
            if _team_value is not None:
                history_data["team_value_tenths"] = _team_value
            if _bank is not None:
                history_data["bank_tenths"] = _bank

            # Preserve baseline columns if they exist (don't overwrite with None)
            if baseline_total is not None:
                history_data["baseline_total_points"] = baseline_total
            if existing.get("previous_mini_league_rank") is not None:
                history_data["previous_mini_league_rank"] = existing["previous_mini_league_rank"]
            if previous_overall_rank is not None:
                history_data["previous_overall_rank"] = previous_overall_rank
            
            # Preserve mini_league_rank if it exists (calculated separately)
            if existing_mini_league_rank is not None:
                history_data["mini_league_rank"] = existing_mini_league_rank
            
            self.db_client.upsert_manager_gameweek_history(history_data)
            if overall_rank is not None or gameweek_rank is not None:
                self.db_client.update_gameweek_fpl_ranks_updated(gameweek, True)
            
            # Sync inferred auto-sub flags to manager_picks so UI shows sub indicators
            # proactively (when starter 0 mins + match finished), not only after deadline batch
            if not is_finished:
                self.sync_auto_sub_flags_to_picks(manager_id, gameweek)
            
            logger.debug("Refreshed manager gameweek history", extra={
                "manager_id": manager_id,
                "gameweek": gameweek,
                "is_finished": is_finished,
                "gameweek_points": gameweek_points,
                "total_points": current_total,
                "method": "FPL_API" if is_finished else "CALCULATED"
            })
            
        except Exception as e:
            logger.error("Error refreshing manager gameweek history", extra={
                "manager_id": manager_id,
                "gameweek": gameweek,
                "error": str(e)
            }, exc_info=True)

    def seed_manager_gameweek_history_from_previous(
        self,
        manager_ids: List[int],
        target_gw_id: int,
        picks_metadata: Dict[int, Dict[str, Any]],
    ) -> None:
        """
        Create manager_gameweek_history rows for the new current GW by copying from previous GW.
        No FPL API calls - used at deadline batch when GW just became is_current (pre-kickoff).
        picks_metadata: manager_id -> {"active_chip": ..., "gameweek_rank": ...} from picks phase.
        """
        if target_gw_id < 1:
            return
        prev_gw = target_gw_id - 1
        now_iso = datetime.now(timezone.utc).isoformat()
        for manager_id in manager_ids:
            try:
                prev_rows = self.db_client.client.table("manager_gameweek_history").select(
                    "total_points, team_value_tenths, bank_tenths, overall_rank, mini_league_rank"
                ).eq("manager_id", manager_id).eq("gameweek", prev_gw).limit(1).execute().data
                meta = picks_metadata.get(manager_id) or {}
                active_chip = meta.get("active_chip")
                gameweek_rank = meta.get("gameweek_rank")
                if not prev_rows:
                    # No previous GW (e.g. GW1): create minimal row with zeros
                    self.db_client.upsert_manager_gameweek_history({
                        "manager_id": manager_id,
                        "gameweek": target_gw_id,
                        "gameweek_points": 0,
                        "transfer_cost": 0,
                        "total_points": 0,
                        "transfers_made": 0,
                        "active_chip": active_chip,
                        "gameweek_rank": gameweek_rank,
                        "updated_at": now_iso,
                    })
                    continue
                prev = prev_rows[0]
                # Count transfers for this manager+GW (we just wrote them in picks+transfers phase)
                trans = self.db_client.client.table("manager_transfers").select("id").eq(
                    "manager_id", manager_id
                ).eq("gameweek", target_gw_id).execute()
                transfers_made = len(trans.data or [])
                # Preserve gameweek_points and total_points if row exists and matches have been played
                # (live refresh already updated them; don't overwrite with 0 / prev cumulative)
                existing = self.db_client.client.table("manager_gameweek_history").select(
                    "gameweek_points, total_points"
                ).eq("manager_id", manager_id).eq("gameweek", target_gw_id).limit(1).execute().data
                gameweek_points = 0
                total_points = prev["total_points"]
                if existing and (existing[0].get("gameweek_points") or 0) > 0:
                    gameweek_points = existing[0]["gameweek_points"]
                    total_points = existing[0].get("total_points") or prev["total_points"]
                history_data = {
                    "manager_id": manager_id,
                    "gameweek": target_gw_id,
                    "gameweek_points": gameweek_points,
                    "transfer_cost": 0,
                    "total_points": total_points,
                    "team_value_tenths": prev.get("team_value_tenths"),
                    "bank_tenths": prev.get("bank_tenths"),
                    "previous_overall_rank": prev.get("overall_rank"),
                    "previous_mini_league_rank": prev.get("mini_league_rank"),
                    "baseline_total_points": prev["total_points"],
                    "transfers_made": transfers_made,
                    "active_chip": active_chip,
                    "gameweek_rank": gameweek_rank,
                    "updated_at": now_iso,
                }
                self.db_client.upsert_manager_gameweek_history(history_data)
            except Exception as e:
                logger.warning("Seed history from previous failed", extra={
                    "manager_id": manager_id, "gameweek": target_gw_id, "error": str(e)
                })
        logger.info("Seeded manager_gameweek_history from previous GW", extra={
            "gameweek": target_gw_id, "prev_gw": prev_gw, "count": len(manager_ids)
        })

    async def calculate_mini_league_ranks(
        self,
        league_id: int,
        gameweek: int
    ):
        """
        Calculate mini league ranks for a gameweek.
        
        Args:
            league_id: League ID
            gameweek: Gameweek number
        """
        try:
            # Get all managers in league with their totals
            managers = self.db_client.client.table("mini_league_managers").select(
                "manager_id"
            ).eq("league_id", league_id).execute().data
            
            # Get previous gameweek for rank change calculation
            previous_gw = gameweek - 1
            
            manager_totals = []
            for manager in managers:
                manager_id = manager["manager_id"]
                
                # Get current gameweek data
                history = self.db_client.client.table("manager_gameweek_history").select(
                    "total_points, mini_league_rank"
                ).eq("manager_id", manager_id).eq("gameweek", gameweek).execute().data
                
                if not history:
                    continue
                
                # Get previous rank from baseline column (preserved at deadline)
                previous_rank = history[0].get("previous_mini_league_rank")
                
                # Fallback: if baseline not set, try to get from previous gameweek
                if previous_rank is None:
                    previous_history = self.db_client.client.table("manager_gameweek_history").select(
                        "mini_league_rank"
                    ).eq("manager_id", manager_id).eq("gameweek", previous_gw).execute().data
                    previous_rank = previous_history[0]["mini_league_rank"] if previous_history else None
                
                manager_totals.append({
                    "manager_id": manager_id,
                    "total_points": history[0]["total_points"],
                    "previous_rank": previous_rank,
                    "existing_rank": history[0].get("mini_league_rank")  # Current stored rank
                })
            
            # Sort by total points descending, then manager_id ascending (matches mv_mini_league_standings tie-break)
            manager_totals.sort(key=lambda x: (-x["total_points"], x["manager_id"]))
            
            # Update ranks with proper tie handling
            # When managers have the same total_points, they get the same rank
            # The next rank after a tie skips accordingly (e.g., if 2 managers tied for rank 1, next is rank 3)
            current_rank = 1
            previous_points = None
            
            for i, manager_data in enumerate(manager_totals):
                total_points = manager_data["total_points"]
                
                # If this manager has different points than previous, assign rank based on position
                # If same points as previous, they get the same rank (tied)
                if previous_points is not None and total_points != previous_points:
                    # Points changed - use position in list (1-indexed)
                    current_rank = i + 1
                elif previous_points is None:
                    # First manager - rank 1
                    current_rank = 1
                # else: same points as previous - keep same rank (tied)
                
                # Calculate rank change: previous_rank - current_rank
                # Positive = moved up (better rank, lower number)
                # Negative = moved down (worse rank, higher number)
                rank_change = None
                if manager_data["previous_rank"] is not None:
                    rank_change = manager_data["previous_rank"] - current_rank
                
                # Calculate rank change from baseline (previous_rank is from baseline column)
                # Only update if we have a valid previous_rank to calculate from
                # CRITICAL: previous_mini_league_rank is preserved at deadline, never overwritten
                
                self.db_client.client.table("manager_gameweek_history").update({
                    "mini_league_rank": current_rank,
                    "mini_league_rank_change": rank_change  # Calculated from baseline
                }).eq("manager_id", manager_data["manager_id"]).eq(
                    "gameweek", gameweek
                ).execute()
                
                previous_points = total_points
            
            logger.info("League ranks updated", extra={"league_id": league_id, "gameweek": gameweek, "count": len(manager_totals)})
            
        except Exception as e:
            logger.error("League ranks failed", extra={"league_id": league_id, "gameweek": gameweek, "error": str(e)}, exc_info=True)
