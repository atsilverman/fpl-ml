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
