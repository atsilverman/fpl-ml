"""
Supabase client for database operations.

Provides optimized queries with column selection and WHERE clauses
to minimize egress usage.
"""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Union

from supabase import create_client, Client
from supabase.lib.client_options import ClientOptions

from config import Config

logger = logging.getLogger(__name__)


class SupabaseClient:
    """Client for interacting with Supabase database."""
    
    def __init__(self, config: Config):
        self.config = config
        self.client: Optional[Client] = None
        self._initialize_client()
    
    def _initialize_client(self):
        """Initialize Supabase client."""
        if not self.config.supabase_url or not self.config.supabase_key:
            raise ValueError("Supabase URL and key are required")
        
        # Use service key if available for admin operations, otherwise use anon key
        key = self.config.supabase_service_key or self.config.supabase_key
        
        # Create client without options to avoid version compatibility issues
        self.client = create_client(
            self.config.supabase_url,
            key
        )
        
        logger.info("Initialized Supabase client", extra={
            "url": self.config.supabase_url,
            "using_service_key": bool(self.config.supabase_service_key)
        })
    
    def _select_columns(self, columns: List[str]) -> str:
        """Format column list for SELECT statement."""
        return ", ".join(columns)
    
    async def execute_query(
        self,
        query: str,
        params: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """
        Execute a raw SQL query.
        
        Note: Supabase Python client doesn't support raw SQL directly.
        This is a placeholder for future implementation using PostgREST
        or direct PostgreSQL connection.
        
        Args:
            query: SQL query string
            params: Query parameters
            
        Returns:
            List of result dictionaries
        """
        # TODO: Implement raw SQL execution if needed
        # For now, use Supabase client methods
        raise NotImplementedError("Raw SQL queries not yet implemented")
    
    def refresh_materialized_view(self, view_name: str):
        """
        Refresh a materialized view.
        
        Args:
            view_name: Name of the materialized view
        """
        # Call the refresh function
        function_name = f"refresh_{view_name.replace('mv_', '')}"
        result = self.client.rpc(function_name).execute()
        
        logger.info("Refreshed materialized view", extra={
            "view_name": view_name,
            "function_name": function_name
        })
        
        return result
    
    def refresh_all_materialized_views(self):
        """Refresh all materialized views."""
        result = self.client.rpc("refresh_all_materialized_views").execute()
        
        logger.info("Materialized views refreshed")
        
        return result
    
    def refresh_materialized_views_for_live(self):
        """Refresh MVs used by UI during live matches (skips mv_manager_gameweek_summary)."""
        result = self.client.rpc("refresh_materialized_views_for_live").execute()
        
        logger.info("Materialized views for live refreshed")
        
        return result

    def refresh_league_transfer_aggregation(self):
        """Refresh mv_league_transfer_aggregation (ML Top Transfers). Call after deadline batch writes manager_transfers."""
        result = self.client.rpc("refresh_league_transfer_aggregation").execute()
        logger.debug("League transfer aggregation refreshed")
        return result
    
    # Table access methods (using Supabase client)
    
    def get_gameweeks(
        self,
        gameweek_id: Optional[int] = None,
        is_current: Optional[bool] = None,
        is_next: Optional[bool] = None,
        limit: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """
        Get gameweeks with optional filtering.

        Args:
            gameweek_id: Filter by gameweek id
            is_current: Filter by is_current flag
            is_next: Filter by is_next flag (next gameweek)
            limit: Limit number of results

        Returns:
            List of gameweek dictionaries
        """
        query = self.client.table("gameweeks").select("*")

        if gameweek_id is not None:
            query = query.eq("id", gameweek_id)
        if is_current is not None:
            query = query.eq("is_current", is_current)
        if is_next is not None:
            query = query.eq("is_next", is_next)

        if limit:
            query = query.limit(limit)

        result = query.execute()
        return result.data
    
    def upsert_gameweek(self, gameweek_data: Dict[str, Any]):
        """
        Upsert a gameweek.
        
        Args:
            gameweek_data: Gameweek data dictionary
        """
        result = self.client.table("gameweeks").upsert(
            gameweek_data,
            on_conflict="id"
        ).execute()
        
        return result.data
    
    def update_gameweek_fpl_ranks_updated(self, gameweek_id: int, value: bool):
        """
        Set fpl_ranks_updated for a gameweek (e.g. when FPL API rank values have been detected as updated).
        """
        self.client.table("gameweeks").update(
            {"fpl_ranks_updated": value, "updated_at": datetime.now(timezone.utc).isoformat()}
        ).eq("id", gameweek_id).execute()
    
    def upsert_fpl_global(self, global_data: Dict[str, Any]):
        """
        Upsert FPL global stats (e.g. total_managers from bootstrap-static).
        
        Args:
            global_data: Must include id (e.g. 'current_season'), total_managers, updated_at
        """
        result = self.client.table("fpl_global").upsert(
            global_data,
            on_conflict="id"
        ).execute()
        return result.data
    
    def get_fpl_global(self) -> Optional[Dict[str, Any]]:
        """Get FPL global stats (total_managers). Returns single row or None."""
        result = self.client.table("fpl_global").select("*").eq("id", "current_season").maybe_single().execute()
        return result.data

    def insert_refresh_event(self, path: str):
        """
        Record that a refresh cycle completed (for frontend lag monitoring).
        path must be 'fast' or 'slow'. Called at end of _fast_cycle and _run_slow_loop.
        """
        if path not in ("fast", "slow"):
            raise ValueError("path must be 'fast' or 'slow'")
        self.client.table("refresh_events").insert({
            "path": path,
            "occurred_at": datetime.now(timezone.utc).isoformat(),
        }).execute()

    def insert_refresh_duration_log(self, source: str, path: str, state: str, duration_ms: int):
        """
        Record duration of a refresh phase for monitoring/plotting.
        source: gameweeks, fixtures, gw_players, manager_points, mvs
        path: fast or slow
        """
        try:
            self.client.table("refresh_duration_log").insert({
                "source": source,
                "path": path,
                "state": state,
                "duration_ms": duration_ms,
            }).execute()
        except Exception as e:
            logger.debug("Refresh duration log insert failed", extra={
                "source": source, "path": path, "error": str(e)
            })

    def has_successful_deadline_batch_for_gameweek(self, gameweek: int) -> bool:
        """
        Return True if we already have a successful deadline batch run for this gameweek.
        Used to avoid re-running the batch after restart or state re-entry.
        """
        result = (
            self.client.table("deadline_batch_runs")
            .select("id")
            .eq("gameweek", gameweek)
            .eq("success", True)
            .limit(1)
            .execute()
        )
        return bool(result.data and len(result.data) > 0)

    def insert_deadline_batch_start(self, gameweek: int) -> Optional[int]:
        """
        Record that the deadline batch started (when is_current changed for this gameweek).
        Returns the inserted row id for later update_deadline_batch_finish.
        """
        now_iso = datetime.now(timezone.utc).isoformat()
        result = self.client.table("deadline_batch_runs").insert({
            "gameweek": gameweek,
            "started_at": now_iso,
        }).execute()
        if result.data and len(result.data) > 0:
            return result.data[0].get("id")
        return None

    def update_deadline_batch_finish(
        self,
        run_id: int,
        finished_at: str,
        duration_seconds: float,
        manager_count: int,
        league_count: int,
        success: bool,
        phase_breakdown: Optional[Dict[str, Any]] = None,
    ):
        """Update a deadline batch run with finish time, duration, counts, and phase breakdown."""
        payload = {
            "finished_at": finished_at,
            "duration_seconds": duration_seconds,
            "manager_count": manager_count,
            "league_count": league_count,
            "success": success,
        }
        if phase_breakdown is not None:
            payload["phase_breakdown"] = phase_breakdown
        self.client.table("deadline_batch_runs").update(payload).eq("id", run_id).execute()

    def get_first_kickoff_for_gameweek(self, gameweek: int) -> Optional[str]:
        """Earliest kickoff_time for the gameweek (ISO string or None). Used for 'be prepared by' logging."""
        result = (
            self.client.table("fixtures")
            .select("kickoff_time")
            .eq("gameweek", gameweek)
            .order("kickoff_time", desc=False)
            .limit(1)
            .execute()
        )
        if result.data and len(result.data) > 0 and result.data[0].get("kickoff_time"):
            return result.data[0]["kickoff_time"]
        return None

    def get_next_kickoff_for_gameweek(self, gameweek: int) -> Optional[str]:
        """Earliest kickoff_time for the gameweek that is still in the future (ISO string or None).
        Used to cap idle sleep so we run at least once before/during the kickoff window."""
        now_iso = datetime.now(timezone.utc).isoformat()
        result = (
            self.client.table("fixtures")
            .select("kickoff_time")
            .eq("gameweek", gameweek)
            .gt("kickoff_time", now_iso)
            .order("kickoff_time", desc=False)
            .limit(1)
            .execute()
        )
        if result.data and len(result.data) > 0 and result.data[0].get("kickoff_time"):
            return result.data[0]["kickoff_time"]
        return None

    def get_next_matchday_info(
        self, gameweek: int, now_utc: Optional[datetime] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Next matchday (earliest future date with at least one fixture) for this gameweek.
        Returns { matchday_sequence, matchday_date, first_kickoff_at } or None.
        Used by per-matchday baseline capture (window check done by caller).
        """
        now = now_utc or datetime.now(timezone.utc)
        now_iso = now.isoformat()
        result = (
            self.client.table("fixtures")
            .select("kickoff_time, started")
            .eq("gameweek", gameweek)
            .gt("kickoff_time", now_iso)
            .order("kickoff_time", desc=False)
            .execute()
        )
        if not result.data:
            return None
        # Build (date, first_kickoff) per matchday for full GW to get sequence
        all_fixtures = (
            self.client.table("fixtures")
            .select("kickoff_time")
            .eq("gameweek", gameweek)
            .order("kickoff_time", desc=False)
            .execute()
        )
        if not all_fixtures.data:
            return None
        date_to_first_kickoff: Dict[str, str] = {}
        for row in all_fixtures.data:
            k = row.get("kickoff_time")
            if not k:
                continue
            try:
                dt = datetime.fromisoformat(k.replace("Z", "+00:00"))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                d = dt.date().isoformat()
                if d not in date_to_first_kickoff or k < date_to_first_kickoff[d]:
                    date_to_first_kickoff[d] = k
            except (ValueError, TypeError):
                continue
        ordered_dates = sorted(date_to_first_kickoff.keys())
        for idx, d in enumerate(ordered_dates):
            first_kickoff = date_to_first_kickoff[d]
            if first_kickoff > now_iso:
                return {
                    "matchday_sequence": idx + 1,
                    "matchday_date": d,
                    "first_kickoff_at": first_kickoff,
                }
        return None

    def matchday_baseline_already_captured(
        self, gameweek: int, matchday_sequence: int
    ) -> bool:
        """True if any row exists for this (gameweek, matchday_sequence)."""
        result = (
            self.client.table("manager_gameweek_matchday_baselines")
            .select("id")
            .eq("gameweek", gameweek)
            .eq("matchday_sequence", matchday_sequence)
            .limit(1)
            .execute()
        )
        return bool(result.data)

    def upsert_matchday_baselines(self, rows: List[Dict[str, Any]]) -> None:
        """Upsert rows into manager_gameweek_matchday_baselines (ON CONFLICT DO UPDATE)."""
        if not rows:
            return
        self.client.table("manager_gameweek_matchday_baselines").upsert(
            rows,
            on_conflict="manager_id,gameweek,matchday_sequence",
        ).execute()

    def insert_feed_events(self, events: List[Dict[str, Any]]):
        """
        Bulk-insert gameweek feed events (point-impacting timeline events).
        Each dict: gameweek, player_id, fixture_id?, event_type, points_delta, total_points_after, occurred_at, metadata?.
        """
        if not events:
            return
        rows = []
        for e in events:
            row = {
                "gameweek": e["gameweek"],
                "player_id": e["player_id"],
                "fixture_id": e.get("fixture_id"),
                "event_type": e["event_type"],
                "points_delta": e["points_delta"],
                "total_points_after": e["total_points_after"],
                "occurred_at": e["occurred_at"],
            }
            if e.get("metadata") is not None:
                row["metadata"] = e["metadata"]
            rows.append(row)
        self.client.table("gameweek_feed_events").insert(rows).execute()

    def mark_feed_events_reversed(self, reversals: List[Dict[str, Any]]):
        """
        Mark the latest (by occurred_at, id) unreversed feed event for each
        (gameweek, player_id, fixture_id, event_type) as reversed.
        Used when a stat is removed (e.g. goal/assist ruled out); no new row is inserted.
        """
        if not reversals:
            return
        for r in reversals:
            gameweek = r["gameweek"]
            player_id = r["player_id"]
            fixture_id = r.get("fixture_id")
            event_type = r["event_type"]
            q = (
                self.client.table("gameweek_feed_events")
                .select("id, metadata")
                .eq("gameweek", gameweek)
                .eq("player_id", player_id)
                .eq("event_type", event_type)
                .order("occurred_at", desc=True)
                .order("id", desc=True)
                .limit(50)
            )
            if fixture_id is not None:
                q = q.eq("fixture_id", fixture_id)
            else:
                q = q.is_("fixture_id", "null")
            result = q.execute()
            rows = result.data or []
            for row in rows:
                if row.get("metadata") and row["metadata"].get("reversed"):
                    continue
                meta = dict(row["metadata"]) if row.get("metadata") else {}
                meta["reversed"] = True
                self.client.table("gameweek_feed_events").update({"metadata": meta}).eq("id", row["id"]).execute()
                break

    def upsert_player(self, player_data: Dict[str, Any]):
        """
        Upsert a player.
        
        Args:
            player_data: Player data dictionary
        """
        result = self.client.table("players").upsert(
            player_data,
            on_conflict="fpl_player_id"
        ).execute()
        
        return result.data
    
    def upsert_player_gameweek_stats(self, stats_data: Union[Dict[str, Any], List[Dict[str, Any]]]):
        """
        Upsert player gameweek stats (single row or batch).
        
        Args:
            stats_data: Single player stats dict or list of dicts
        """
        rows = stats_data if isinstance(stats_data, list) else [stats_data]
        if not rows:
            return None
        result = self.client.table("player_gameweek_stats").upsert(
            rows,
            on_conflict="player_id,gameweek,fixture_id"
        ).execute()
        return result.data
    
    def upsert_fixture(self, fixture_data: Dict[str, Any]):
        """
        Upsert a fixture.
        
        Args:
            fixture_data: Fixture data dictionary
        """
        result = self.client.table("fixtures").upsert(
            fixture_data,
            on_conflict="fpl_fixture_id"
        ).execute()
        
        return result.data

    def update_fixture_scores(
        self,
        fpl_fixture_id: int,
        home_score: Optional[int],
        away_score: Optional[int],
        minutes: Optional[int] = None,
    ):
        """
        Update home_score, away_score and optionally minutes for a fixture (e.g. from event-live).
        Used during live matches so the matches page stays in sync with GW points and match clock.
        """
        payload = {
            "home_score": home_score,
            "away_score": away_score,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        if minutes is not None:
            payload["minutes"] = minutes
        result = self.client.table("fixtures").update(payload).eq(
            "fpl_fixture_id", fpl_fixture_id
        ).execute()
        return result.data

    def get_manager(self, manager_id: int) -> Optional[Dict[str, Any]]:
        """
        Get a manager by ID (manager_name, manager_team_name for preserving backfilled data).
        """
        result = self.client.table("managers").select(
            "manager_id, manager_name, manager_team_name"
        ).eq("manager_id", manager_id).maybe_single().execute()
        return result.data

    def upsert_manager(self, manager_data: Dict[str, Any]):
        """
        Upsert a manager.
        
        Args:
            manager_data: Manager data dictionary
        """
        result = self.client.table("managers").upsert(
            manager_data,
            on_conflict="manager_id"
        ).execute()
        
        return result.data
    
    def upsert_manager_gameweek_history(self, history_data: Dict[str, Any]):
        """
        Upsert manager gameweek history.
        
        Args:
            history_data: Manager history data dictionary
        """
        result = self.client.table("manager_gameweek_history").upsert(
            history_data,
            on_conflict="manager_id,gameweek"
        ).execute()
        
        return result.data

    def update_manager_gameweek_history_points(
        self,
        manager_id: int,
        gameweek: int,
        gameweek_points: int,
        total_points: int,
    ):
        """Update only gameweek_points and total_points for a manager/gameweek (live-only path; preserves other columns)."""
        result = self.client.table("manager_gameweek_history").update({
            "gameweek_points": gameweek_points,
            "total_points": total_points,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("manager_id", manager_id).eq("gameweek", gameweek).execute()
        return result.data
    
    def upsert_manager_pick(self, pick_data: Dict[str, Any]):
        """
        Upsert a manager pick.
        
        Args:
            pick_data: Manager pick data dictionary
        """
        result = self.client.table("manager_picks").upsert(
            pick_data,
            on_conflict="manager_id,gameweek,position"
        ).execute()
        
        return result.data
    
    def upsert_manager_transfer(self, transfer_data: Dict[str, Any]):
        """
        Upsert a manager transfer.
        
        Args:
            transfer_data: Manager transfer data dictionary
        """
        result = self.client.table("manager_transfers").upsert(
            transfer_data,
            on_conflict="manager_id,gameweek,player_in_id,player_out_id"
        ).execute()
        
        return result.data
    
    def get_last_known_prices(
        self,
        before_date: str,
        gameweek: int
    ) -> Dict[int, int]:
        """
        Get each player's price from the most recent snapshot before before_date.
        Prefers same gameweek; if none (e.g. first day of new GW), uses previous gameweek.
        Used to set prior_price_tenths when writing the next snapshot (e.g. 5:40pm daily).

        Args:
            before_date: ISO date string (e.g. today); we take latest recorded_date < this.
            gameweek: Gameweek to match (and fallback to gameweek - 1 if no same-GW snapshot).

        Returns:
            Dict mapping player_id -> price_tenths from that snapshot. Empty if no prior snapshot.
        """
        # Try same gameweek first
        date_result = (
            self.client.table("player_prices")
            .select("recorded_date")
            .lt("recorded_date", before_date)
            .eq("gameweek", gameweek)
            .order("recorded_date", desc=True)
            .limit(1)
            .execute()
        )
        if date_result.data and len(date_result.data) > 0:
            last_date = date_result.data[0].get("recorded_date")
            if last_date:
                rows = (
                    self.client.table("player_prices")
                    .select("player_id, price_tenths")
                    .eq("recorded_date", last_date)
                    .eq("gameweek", gameweek)
                    .execute()
                )
                return {r["player_id"]: r["price_tenths"] for r in (rows.data or [])}

        # First day of gameweek: no prior snapshot for this GW; use previous gameweek's latest snapshot
        prev_gw = gameweek - 1
        if prev_gw < 1:
            return {}
        date_result = (
            self.client.table("player_prices")
            .select("recorded_date")
            .lt("recorded_date", before_date)
            .eq("gameweek", prev_gw)
            .order("recorded_date", desc=True)
            .limit(1)
            .execute()
        )
        if not date_result.data or len(date_result.data) == 0:
            return {}
        last_date = date_result.data[0].get("recorded_date")
        if not last_date:
            return {}
        rows = (
            self.client.table("player_prices")
            .select("player_id, price_tenths")
            .eq("recorded_date", last_date)
            .eq("gameweek", prev_gw)
            .execute()
        )
        return {r["player_id"]: r["price_tenths"] for r in (rows.data or [])}

    def get_today_prior_prices(self, today_iso: str, gameweek: int) -> Dict[int, int]:
        """
        Get prior_price_tenths for today's snapshot (so sync can preserve them and not overwrite).
        Returns dict player_id -> prior_price_tenths for rows that already have prior set.
        """
        rows = (
            self.client.table("player_prices")
            .select("player_id, prior_price_tenths")
            .eq("recorded_date", today_iso)
            .eq("gameweek", gameweek)
            .not_.is_("prior_price_tenths", "null")
            .execute()
        )
        data = rows.data or []
        return {r["player_id"]: r["prior_price_tenths"] for r in data if r.get("prior_price_tenths") is not None}

    def upsert_player_price(self, price_data: Dict[str, Any]):
        """
        Upsert a player price.
        
        Args:
            price_data: Player price data dictionary (may include prior_price_tenths for snapshot).
        """
        result = self.client.table("player_prices").upsert(
            price_data,
            on_conflict="player_id,gameweek,recorded_date"
        ).execute()
        
        return result.data

    def update_player_cost_tenths(self, fpl_player_id: int, cost_tenths: int) -> None:
        """
        Update a player's cost_tenths (current price fallback on players table).
        """
        self.client.table("players").update({"cost_tenths": cost_tenths}).eq(
            "fpl_player_id", fpl_player_id
        ).execute()
    
    def clear_price_change_predictions(self) -> None:
        """
        Delete all rows from price_change_predictions. Call after the price change
        window closes so the next scraper run (LiveFPL) fills fresh data for the new day.
        """
        self.client.table("price_change_predictions").delete().neq(
            "id", "00000000-0000-0000-0000-000000000000"
        ).execute()
    
    def upsert_team(self, team_data: Dict[str, Any]):
        """
        Upsert a team.
        
        Args:
            team_data: Team data dictionary with team_id, team_name, short_name
        """
        result = self.client.table("teams").upsert(
            team_data,
            on_conflict="team_id"
        ).execute()
        
        return result.data
    
    def get_mini_league_standings(
        self,
        league_id: int,
        gameweek: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """
        Get mini league standings from materialized view.
        
        Args:
            league_id: League ID
            gameweek: Optional gameweek filter
            
        Returns:
            List of standings dictionaries
        """
        query = self.client.table("mv_mini_league_standings").select("*").eq(
            "league_id", league_id
        )
        
        if gameweek:
            query = query.eq("gameweek", gameweek)
        
        result = query.order("total_points", desc=True).execute()
        return result.data
