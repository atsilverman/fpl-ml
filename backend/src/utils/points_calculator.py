"""
Points calculation utilities.

Handles complex FPL points calculation including provisional bonus,
automatic substitutions, multipliers, and transfer costs.
"""

import logging
from typing import Dict, List, Optional, Set

from database.supabase_client import SupabaseClient
from fpl_api.client import FPLAPIClient

logger = logging.getLogger(__name__)


class PointsCalculator:
    """Calculates manager points with all FPL rules."""
    
    def __init__(self, db_client: SupabaseClient, fpl_client: Optional[FPLAPIClient] = None):
        self.db_client = db_client
        self.fpl_client = fpl_client
    
    def get_player_points(
        self,
        player_id: int,
        gameweek: int,
        fixture_id: Optional[int] = None
    ) -> Dict:
        """
        Get player points with provisional bonus logic.
        
        Args:
            player_id: Player ID
            gameweek: Gameweek number
            fixture_id: Optional fixture ID for BPS ranking
            
        Returns:
            Dictionary with points and provisional status
        """
        # Get player stats
        stats_result = self.db_client.client.table("player_gameweek_stats").select(
            "*"
        ).eq("player_id", player_id).eq("gameweek", gameweek).execute()
        
        stats = stats_result.data if stats_result.data else []
        if not stats:
            return {"points": 0, "bonus": 0, "bonus_status": "confirmed"}
        
        stats_data = stats[0]
        points = stats_data.get("total_points", 0)
        bonus = stats_data.get("bonus", 0)
        bonus_status = stats_data.get("bonus_status", "provisional")
        bps = stats_data.get("bps", 0)
        match_finished = stats_data.get("match_finished", False)
        match_finished_provisional = stats_data.get("match_finished_provisional", False)
        
        # Only add provisional when in provisional period; when official, total_points already includes bonus
        if match_finished or match_finished_provisional:
            if bonus_status == "provisional" and bonus == 0:
                provisional_bonus = stats_data.get("provisional_bonus", 0)
                points = points + provisional_bonus
            elif bonus_status == "confirmed" and bonus > 0:
                # Bonus already included in total_points from FPL
                pass
        
        return {
            "points": points,
            "bonus": bonus,
            "bonus_status": bonus_status
        }
    
    def apply_automatic_subs(
        self,
        picks: List[Dict],
        automatic_subs: List[Dict],
        player_minutes: Dict[int, int],
        player_fixtures: Dict[int, Dict]
    ) -> List[Dict]:
        """
        Apply automatic substitutions with match status checks.
        
        Uses FPL API automatic_subs array if available, otherwise calculates
        auto-subs based on FPL rules (0 minutes + match finished).
        
        Args:
            picks: List of pick dictionaries
            automatic_subs: List of automatic substitution dictionaries from FPL API
            player_minutes: Dictionary mapping player_id to minutes
            player_fixtures: Dictionary mapping player_id to fixture data
            
        Returns:
            List of adjusted picks
        """
        # Create substitution map from FPL API (if provided)
        sub_map = {}
        for sub in automatic_subs:
            sub_map[sub.get("element_out")] = sub.get("element_in")
        
        # If FPL API provided auto-subs, use them (but still verify conditions)
        # Otherwise, calculate auto-subs based on rules
        use_fpl_api_subs = len(sub_map) > 0
        
        adjusted_picks = []
        used_bench_positions = set()  # Track which bench positions have been used
        
        for pick in picks:
            player_id = pick["player_id"]
            position = pick["position"]
            
            # Only check starters (position <= 11) for auto-sub
            if position <= 11:
                minutes = player_minutes.get(player_id, 0)
                fixture = player_fixtures.get(player_id, {})
                
                # Check if match is finished
                match_finished = fixture.get("finished") or fixture.get("finished_provisional")
                
                # Check if auto-sub should be applied
                should_substitute = match_finished and minutes == 0
                
                if should_substitute:
                    substitute_id = None
                    
                    if use_fpl_api_subs and player_id in sub_map:
                        # Use FPL API's substitution
                        substitute_id = sub_map[player_id]
                    else:
                        # Calculate auto-sub: find first available bench player
                        # Bench players are ordered by position (12, 13, 14, 15)
                        bench_players = [p for p in picks if p["position"] > 11]
                        bench_players.sort(key=lambda x: x["position"])
                        
                        # Get starter's position type (1=GK, 2=DEF, 3=MID, 4=FWD)
                        starter_position_type = None
                        starter_player = self.db_client.client.table("players").select(
                            "position"
                        ).eq("fpl_player_id", player_id).execute()
                        if starter_player.data:
                            starter_position_type = starter_player.data[0].get("position")
                        
                        for bench_pick in bench_players:
                            bench_player_id = bench_pick["player_id"]
                            bench_position = bench_pick["position"]
                            
                            # Skip if already used
                            if bench_position in used_bench_positions:
                                continue
                            
                            # Check position compatibility
                            # GK (position 1) can only replace GK
                            # Outfield (positions 2/3/4) can replace any outfield
                            bench_player = self.db_client.client.table("players").select(
                                "position"
                            ).eq("fpl_player_id", bench_player_id).execute()
                            
                            if bench_player.data:
                                bench_position_type = bench_player.data[0].get("position")
                                
                                # Position compatibility check
                                if starter_position_type == 1:  # Starter is GK
                                    if bench_position_type != 1:  # Bench must be GK
                                        continue  # Skip non-GK bench players
                                else:  # Starter is outfield (DEF/MID/FWD)
                                    if bench_position_type == 1:  # Bench is GK
                                        continue  # Skip GK bench players (can't replace outfield)
                            
                            # Check if bench player's match is finished and they played
                            bench_minutes = player_minutes.get(bench_player_id, 0)
                            bench_fixture = player_fixtures.get(bench_player_id, {})
                            bench_match_finished = (
                                bench_fixture.get("finished") or
                                bench_fixture.get("finished_provisional")
                            )
                            
                            # Use this bench player if their match finished and they played
                            if bench_match_finished and bench_minutes > 0:
                                substitute_id = bench_player_id
                                used_bench_positions.add(bench_position)
                                break
                    
                    if substitute_id:
                        # Apply substitution
                        adjusted_pick = pick.copy()
                        adjusted_pick["player_id"] = substitute_id
                        adjusted_pick["was_auto_subbed"] = True
                        adjusted_picks.append(adjusted_pick)
                    else:
                        # No valid substitute found, keep original
                        adjusted_picks.append(pick)
                else:
                    # Conditions not met, keep original pick
                    adjusted_picks.append(pick)
            else:
                # Bench player, keep as-is
                adjusted_picks.append(pick)
        
        return adjusted_picks
    
    def infer_automatic_subs_from_db(
        self,
        gameweek: int,
        picks: List[Dict],
    ) -> List[Dict]:
        """
        Infer automatic substitutions from DB when FPL API has not returned them yet.
        Uses same rules as apply_automatic_subs: starter 0 minutes + match finished
        -> first valid bench player (position-compatible, match finished, minutes > 0).
        Returns list of {"element_out": player_id, "element_in": player_id} in API shape.
        """
        if not picks:
            return []
        player_ids = [p["player_id"] for p in picks]
        # Fetch minutes and match status for all picked players (one query)
        stats_result = self.db_client.client.table("player_gameweek_stats").select(
            "player_id, minutes, match_finished, match_finished_provisional"
        ).eq("gameweek", gameweek).in_("player_id", player_ids).execute()
        stats_list = stats_result.data if stats_result.data else []
        player_minutes: Dict[int, int] = {}
        player_fixtures: Dict[int, Dict] = {}
        for row in stats_list:
            pid = row.get("player_id")
            if pid is not None:
                player_minutes[pid] = row.get("minutes", 0)
                player_fixtures[pid] = {
                    "finished": row.get("match_finished", False),
                    "finished_provisional": row.get("match_finished_provisional", False),
                }
        # Fetch position (1=GK, 2=DEF, 3=MID, 4=FWD) for position compatibility
        players_result = self.db_client.client.table("players").select(
            "fpl_player_id, position"
        ).in_("fpl_player_id", player_ids).execute()
        players_list = players_result.data if players_result.data else []
        player_position_type: Dict[int, int] = {
            p["fpl_player_id"]: p.get("position", 0) for p in players_list
        }
        # Infer subs: same logic as apply_automatic_subs but collect (out, in) pairs
        automatic_subs: List[Dict] = []
        used_bench_positions: Set[int] = set()
        bench_players = [p for p in picks if p["position"] > 11]
        bench_players.sort(key=lambda x: x["position"])
        for pick in picks:
            player_id = pick["player_id"]
            position = pick["position"]
            if position > 11:
                continue
            minutes = player_minutes.get(player_id, 0)
            fixture = player_fixtures.get(player_id, {})
            match_finished = fixture.get("finished") or fixture.get("finished_provisional")
            if not (match_finished and minutes == 0):
                continue
            substitute_id = None
            starter_position_type = player_position_type.get(player_id)
            for bench_pick in bench_players:
                bench_player_id = bench_pick["player_id"]
                bench_position = bench_pick["position"]
                if bench_position in used_bench_positions:
                    continue
                bench_position_type = player_position_type.get(bench_player_id)
                if starter_position_type == 1:
                    if bench_position_type != 1:
                        continue
                else:
                    if bench_position_type == 1:
                        continue
                bench_minutes = player_minutes.get(bench_player_id, 0)
                bench_fixture = player_fixtures.get(bench_player_id, {})
                bench_match_finished = (
                    bench_fixture.get("finished") or bench_fixture.get("finished_provisional")
                )
                if bench_match_finished and bench_minutes > 0:
                    substitute_id = bench_player_id
                    used_bench_positions.add(bench_position)
                    break
            if substitute_id is not None:
                automatic_subs.append({
                    "element_out": player_id,
                    "element_in": substitute_id,
                })
        return automatic_subs
    
    async def calculate_manager_gameweek_points(
        self,
        manager_id: int,
        gameweek: int
    ) -> Dict:
        """
        Calculate manager gameweek points.
        
        Args:
            manager_id: Manager ID
            gameweek: Gameweek number
            
        Returns:
            Dictionary with calculated points and metadata
        """
        # Get manager picks
        picks_result = self.db_client.client.table("manager_picks").select(
            "*"
        ).eq("manager_id", manager_id).eq("gameweek", gameweek).execute()
        
        picks = picks_result.data if picks_result.data else []
        
        if not picks:
            return {
                "gameweek_points": 0,
                "transfer_cost": 0,
                "active_chip": None
            }
        
        # OPTIMIZATION: Get transfer_cost and active_chip from database first
        # Only call API if not available in database
        history_result = self.db_client.client.table("manager_gameweek_history").select(
            "transfer_cost, active_chip"
        ).eq("manager_id", manager_id).eq("gameweek", gameweek).execute()
        
        existing_history = history_result.data[0] if history_result.data else {}
        transfer_cost = existing_history.get("transfer_cost")
        active_chip = existing_history.get("active_chip")
        automatic_subs = []  # Will be inferred from player minutes if not provided
        
        # Only call API if transfer_cost or active_chip not in database
        # OPTIMIZATION: Skip API call entirely if we have both values (automatic_subs can be inferred)
        if (transfer_cost is None or active_chip is None) and self.fpl_client:
            try:
                entry_data = await self.fpl_client.get_entry_picks(manager_id, gameweek)
                if transfer_cost is None:
                    transfer_cost = entry_data.get("entry_history", {}).get("event_transfers_cost", 0)
                if active_chip is None:
                    active_chip = entry_data.get("active_chip")
                # Get automatic subs from API if available (will be inferred if not)
                automatic_subs = entry_data.get("automatic_subs", [])
            except Exception as e:
                logger.warning("Failed to fetch entry data from API, using defaults", extra={
                    "manager_id": manager_id,
                    "gameweek": gameweek,
                    "error": str(e)
                })
                if transfer_cost is None:
                    transfer_cost = 0
                if active_chip is None:
                    active_chip = None
        else:
            # Both transfer_cost and active_chip are in database - skip API call
            # Use defaults if None
            if transfer_cost is None:
                transfer_cost = 0
            if active_chip is None:
                active_chip = None
            logger.debug("Using cached transfer_cost and active_chip from database", extra={
                "manager_id": manager_id,
                "gameweek": gameweek
            })
        
        # Get player minutes and fixtures for auto-sub logic
        player_ids = [p["player_id"] for p in picks]
        player_minutes = {}
        player_fixtures = {}
        
        for player_id in player_ids:
            stats_result = self.db_client.client.table("player_gameweek_stats").select(
                "minutes, fixture_id, match_finished, match_finished_provisional"
            ).eq("player_id", player_id).eq("gameweek", gameweek).execute()
            
            stats = stats_result.data if stats_result.data else []
            if stats:
                player_minutes[player_id] = stats[0].get("minutes", 0)
                fixture_id = stats[0].get("fixture_id")
                if fixture_id:
                    fixture_result = self.db_client.client.table("fixtures").select(
                        "*"
                    ).eq("fpl_fixture_id", fixture_id).execute()
                    fixture = fixture_result.data if fixture_result.data else []
                    if fixture:
                        player_fixtures[player_id] = fixture[0]
        
        # Apply automatic substitutions
        adjusted_picks = self.apply_automatic_subs(
            picks,
            automatic_subs,
            player_minutes,
            player_fixtures
        )
        
        # Calculate raw points
        raw_points = 0
        starters = [p for p in adjusted_picks if p["position"] <= 11]
        bench = [p for p in adjusted_picks if p["position"] > 11]
        
        # Calculate starter points with multipliers
        for pick in starters:
            player_points_data = self.get_player_points(
                pick["player_id"],
                gameweek
            )
            points = player_points_data["points"]
            multiplier = pick.get("multiplier", 1)
            raw_points += points * multiplier
        
        # Add bench points if bench boost active
        if active_chip == "bboost":
            for pick in bench:
                player_points_data = self.get_player_points(
                    pick["player_id"],
                    gameweek
                )
                raw_points += player_points_data["points"]
        
        # Subtract transfer costs
        gameweek_points = raw_points - transfer_cost
        
        return {
            "gameweek_points": gameweek_points,
            "transfer_cost": transfer_cost,
            "active_chip": active_chip,
            "raw_points": raw_points
        }
