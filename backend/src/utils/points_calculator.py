"""
Points calculation utilities.

Handles complex FPL points calculation including provisional bonus,
automatic substitutions, multipliers, and transfer costs.
"""

import logging
from collections import defaultdict
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
        
        # DGW: sum total_points and bonus across all fixture rows
        points = 0
        bonus = 0
        any_provisional = False
        for stats_data in stats:
            row_pts = stats_data.get("total_points", 0)
            row_bonus = stats_data.get("bonus", 0)
            bonus_status = stats_data.get("bonus_status", "provisional")
            match_finished = stats_data.get("match_finished", False)
            match_finished_provisional = stats_data.get("match_finished_provisional", False)
            if bonus_status == "provisional":
                any_provisional = True
            if match_finished or match_finished_provisional:
                if bonus_status == "provisional" and row_bonus == 0:
                    provisional_bonus = stats_data.get("provisional_bonus", 0)
                    row_pts = row_pts + provisional_bonus
            points += row_pts
            bonus += row_bonus
        bonus_status = "provisional" if any_provisional else "confirmed"
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
        player_fixtures: Dict[int, Dict],
        position_by_player_id: Optional[Dict[int, int]] = None,
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
            position_by_player_id: Optional map player_id -> position (1=GK,2=DEF,3=MID,4=FWD).
                When provided, no DB calls are made for position lookups.

        Returns:
            List of adjusted picks
        """
        # Create substitution map from FPL API (if provided)
        sub_map = {}
        for sub in automatic_subs:
            sub_map[sub.get("element_out")] = sub.get("element_in")

        use_fpl_api_subs = len(sub_map) > 0
        use_position_map = position_by_player_id is not None and len(position_by_player_id) > 0

        adjusted_picks = []
        used_bench_positions = set()

        for pick in picks:
            player_id = pick["player_id"]
            position = pick["position"]

            if position <= 11:
                minutes = player_minutes.get(player_id, 0)
                fixture = player_fixtures.get(player_id, {})

                match_finished = fixture.get("finished") or fixture.get("finished_provisional")
                should_substitute = match_finished and minutes == 0

                if should_substitute:
                    substitute_id = None

                    if use_fpl_api_subs and player_id in sub_map:
                        substitute_id = sub_map[player_id]
                    else:
                        bench_players = [p for p in picks if p["position"] > 11]
                        bench_players.sort(key=lambda x: x["position"])

                        starter_position_type = None
                        if use_position_map:
                            starter_position_type = position_by_player_id.get(player_id)
                        else:
                            starter_player = self.db_client.client.table("players").select(
                                "position"
                            ).eq("fpl_player_id", player_id).execute()
                            if starter_player.data:
                                starter_position_type = starter_player.data[0].get("position")

                        for bench_pick in bench_players:
                            bench_player_id = bench_pick["player_id"]
                            bench_position = bench_pick["position"]

                            if bench_position in used_bench_positions:
                                continue

                            bench_position_type = None
                            if use_position_map:
                                bench_position_type = position_by_player_id.get(bench_player_id)
                            else:
                                bench_player = self.db_client.client.table("players").select(
                                    "position"
                                ).eq("fpl_player_id", bench_player_id).execute()
                                if bench_player.data:
                                    bench_position_type = bench_player.data[0].get("position")

                            if bench_position_type is None:
                                continue

                            if starter_position_type == 1:
                                if bench_position_type != 1:
                                    continue
                            else:
                                if bench_position_type == 1:
                                    continue

                            bench_minutes = player_minutes.get(bench_player_id, 0)
                            bench_fixture = player_fixtures.get(bench_player_id, {})
                            bench_match_finished = (
                                bench_fixture.get("finished") or
                                bench_fixture.get("finished_provisional")
                            )

                            if bench_match_finished and bench_minutes > 0:
                                substitute_id = bench_player_id
                                used_bench_positions.add(bench_position)
                                break

                    if substitute_id:
                        adjusted_pick = pick.copy()
                        adjusted_pick["player_id"] = substitute_id
                        adjusted_pick["was_auto_subbed"] = True
                        adjusted_picks.append(adjusted_pick)
                    else:
                        adjusted_picks.append(pick)
                else:
                    adjusted_picks.append(pick)
            else:
                adjusted_picks.append(pick)

        return adjusted_picks

    @staticmethod
    def apply_captain_vice_multiplier_after_sub(
        adjusted_picks: List[Dict],
        active_chip: Optional[str],
    ) -> List[Dict]:
        """
        When the captain was auto-subbed out, FPL gives the vice-captain the captain
        multiplier (2x or 3x). Set ex-captain slot to 1x and vice-captain slot to that multiplier.
        Mutates and returns adjusted_picks.
        """
        starters = [p for p in adjusted_picks if p.get("position", 0) <= 11]
        captain_pick = next((p for p in starters if p.get("is_captain")), None)
        vice_pick = next((p for p in starters if p.get("is_vice_captain")), None)
        if not captain_pick or not vice_pick:
            return adjusted_picks
        if not captain_pick.get("was_auto_subbed"):
            return adjusted_picks
        # If vice was also subbed out, no one gets the double (FPL rule)
        if vice_pick.get("was_auto_subbed"):
            captain_pick["multiplier"] = 1
            return adjusted_picks
        captain_mult = 3 if active_chip == "3xc" else 2
        captain_pick["multiplier"] = 1
        vice_pick["multiplier"] = captain_mult
        return adjusted_picks

    def _get_autosub_data(
        self, gameweek: int, picks: List[Dict]
    ) -> tuple[
        List[Dict],
        Dict[int, int],
        Dict[int, Dict],
        Dict[int, int],
    ]:
        """Fetch and return (picks_sorted, player_minutes, player_fixtures, player_position_type)."""
        if not picks:
            return [], {}, {}, {}
        player_ids = [p["player_id"] for p in picks]
        picks_sorted = sorted(picks, key=lambda x: x["position"])
        stats_result = self.db_client.client.table("player_gameweek_stats").select(
            "player_id, minutes, match_finished, match_finished_provisional"
        ).eq("gameweek", gameweek).in_("player_id", player_ids).execute()
        stats_list = stats_result.data if stats_result.data else []
        rows_by_player: Dict[int, List[Dict]] = defaultdict(list)
        for row in stats_list:
            pid = row.get("player_id")
            if pid is not None:
                rows_by_player[pid].append(row)
        player_minutes: Dict[int, int] = {}
        player_fixtures: Dict[int, Dict] = {}
        for pid, rows in rows_by_player.items():
            player_minutes[pid] = sum(r.get("minutes", 0) or 0 for r in rows)
            all_finished = all(
                r.get("match_finished", False) or r.get("match_finished_provisional", False)
                for r in rows
            )
            any_provisional = any(r.get("match_finished_provisional", False) for r in rows)
            player_fixtures[pid] = {
                "finished": all_finished and not any_provisional,
                "finished_provisional": any_provisional and all_finished,
            }
        players_result = self.db_client.client.table("players").select(
            "fpl_player_id, position"
        ).in_("fpl_player_id", player_ids).execute()
        players_list = players_result.data or []
        player_position_type: Dict[int, int] = {
            p["fpl_player_id"]: p.get("position", 0) for p in players_list
        }
        return picks_sorted, player_minutes, player_fixtures, player_position_type

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
        Starters processed in position order (1..11) so bench assignment matches FPL.
        """
        if not picks:
            return []
        (
            picks_sorted,
            player_minutes,
            player_fixtures,
            player_position_type,
        ) = self._get_autosub_data(gameweek, picks)
        automatic_subs: List[Dict] = []
        used_bench_positions: Set[int] = set()
        bench_players = [p for p in picks_sorted if p["position"] > 11]
        bench_players.sort(key=lambda x: x["position"])
        for pick in picks_sorted:
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

    def get_auto_sub_display_subs(
        self,
        gameweek: int,
        picks: List[Dict],
    ) -> List[Dict]:
        """
        Return auto-sub (out, in) pairs for UI display. Uses designated sub (first
        position-compatible bench by order) so the correct name shows even before
        that bench player's match. If designated sub's match is finished and they
        DNP, cascades to the applied sub (first compatible bench who played).
        Returns list of {"element_out": player_id, "element_in": player_id}.
        """
        if not picks:
            return []
        (
            picks_sorted,
            player_minutes,
            player_fixtures,
            player_position_type,
        ) = self._get_autosub_data(gameweek, picks)
        bench_players = [p for p in picks_sorted if p["position"] > 11]
        bench_players.sort(key=lambda x: x["position"])
        display_subs: List[Dict] = []
        used_bench_designated: Set[int] = set()
        used_bench_applied: Set[int] = set()
        for pick in picks_sorted:
            player_id = pick["player_id"]
            position = pick["position"]
            if position > 11:
                continue
            minutes = player_minutes.get(player_id, 0)
            fixture = player_fixtures.get(player_id, {})
            match_finished = fixture.get("finished") or fixture.get("finished_provisional")
            if not (match_finished and minutes == 0):
                continue
            starter_position_type = player_position_type.get(player_id)
            designated_in: Optional[int] = None
            applied_in: Optional[int] = None
            for bench_pick in bench_players:
                bench_player_id = bench_pick["player_id"]
                bench_position = bench_pick["position"]
                bench_position_type = player_position_type.get(bench_player_id)
                if starter_position_type == 1:
                    if bench_position_type != 1:
                        continue
                else:
                    if bench_position_type == 1:
                        continue
                if designated_in is None and bench_position not in used_bench_designated:
                    designated_in = bench_player_id
                    used_bench_designated.add(bench_position)
                bench_minutes = player_minutes.get(bench_player_id, 0)
                bench_fixture = player_fixtures.get(bench_player_id, {})
                bench_finished = (
                    bench_fixture.get("finished") or bench_fixture.get("finished_provisional")
                )
                if (
                    applied_in is None
                    and bench_finished
                    and bench_minutes > 0
                    and bench_position not in used_bench_applied
                ):
                    applied_in = bench_player_id
                    used_bench_applied.add(bench_position)
            if designated_in is None:
                continue
            designated_finished = (
                player_fixtures.get(designated_in, {}).get("finished")
                or player_fixtures.get(designated_in, {}).get("finished_provisional")
            )
            designated_minutes = player_minutes.get(designated_in, 0)
            if not designated_finished or designated_minutes > 0:
                display_in = designated_in
            else:
                display_in = applied_in if applied_in is not None else designated_in
            display_subs.append({"element_out": player_id, "element_in": display_in})
        return display_subs

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
                # DGW: sum minutes across all fixture rows; autosub only when total is 0
                player_minutes[player_id] = sum(s.get("minutes", 0) or 0 for s in stats)
                # Match "finished" for autosub when all of the player's fixtures are finished
                all_finished = all(
                    s.get("match_finished", False) or s.get("match_finished_provisional", False)
                    for s in stats
                )
                any_provisional = any(s.get("match_finished_provisional", False) for s in stats)
                # Use last fixture for fixture dict; set finished from aggregated stats
                fixture_id = stats[-1].get("fixture_id")
                if fixture_id:
                    fixture_result = self.db_client.client.table("fixtures").select(
                        "*"
                    ).eq("fpl_fixture_id", fixture_id).execute()
                    fixture = fixture_result.data if fixture_result.data else []
                    if fixture:
                        f = dict(fixture[0])
                        f["finished"] = all_finished and not any_provisional
                        f["finished_provisional"] = any_provisional and all_finished
                        player_fixtures[player_id] = f
                    else:
                        player_fixtures[player_id] = {
                            "finished": all_finished and not any_provisional,
                            "finished_provisional": any_provisional and all_finished,
                        }
                else:
                    player_fixtures[player_id] = {
                        "finished": all_finished and not any_provisional,
                        "finished_provisional": any_provisional and all_finished,
                    }
        
        # Fallback for players with no stats row (e.g. DNP): derive fixture from team so auto-sub can apply
        missing_fixture_ids = [pid for pid in player_ids if pid not in player_fixtures]
        if missing_fixture_ids:
            fixtures_result = self.db_client.client.table("fixtures").select(
                "*"
            ).eq("gameweek", gameweek).execute()
            gameweek_fixtures = fixtures_result.data if fixtures_result.data else []
            if gameweek_fixtures:
                players_result = self.db_client.client.table("players").select(
                    "fpl_player_id, team_id"
                ).in_("fpl_player_id", missing_fixture_ids).execute()
                players_list = players_result.data if players_result.data else []
                player_to_team = {p["fpl_player_id"]: p.get("team_id") for p in players_list}
                for player_id in missing_fixture_ids:
                    team_id = player_to_team.get(player_id)
                    if team_id is None:
                        continue
                    player_minutes.setdefault(player_id, 0)  # ensure 0 so DNP triggers sub
                    for f in gameweek_fixtures:
                        if f.get("home_team_id") == team_id or f.get("away_team_id") == team_id:
                            player_fixtures[player_id] = f
                            break
        
        # Use display subs (same as UI) when API did not provide subs, so points match 1 sub-off = 1 sub-on
        if not automatic_subs:
            automatic_subs = self.get_auto_sub_display_subs(gameweek, picks)
        
        # Apply automatic substitutions
        adjusted_picks = self.apply_automatic_subs(
            picks,
            automatic_subs,
            player_minutes,
            player_fixtures
        )
        # When captain was subbed out, vice-captain gets captain multiplier (FPL rule)
        adjusted_picks = self.apply_captain_vice_multiplier_after_sub(
            adjusted_picks, active_chip
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
