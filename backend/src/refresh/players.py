"""
Player data refresh module.

Handles refreshing player stats, prices, and fixtures data.
"""

import asyncio
import logging
from datetime import datetime, timezone
from typing import Dict, List, Set, Optional

from database.supabase_client import SupabaseClient
from fpl_api.client import FPLAPIClient

logger = logging.getLogger(__name__)


class PlayerDataRefresher:
    """Handles player data refresh operations."""
    
    def __init__(
        self,
        fpl_client: FPLAPIClient,
        db_client: SupabaseClient
    ):
        self.fpl_client = fpl_client
        self.db_client = db_client
    
    def _calculate_provisional_bonus(
        self,
        player_id: int,
        player_bps: int,
        fixture_id: int,
        all_players_in_fixture: List[Dict]
    ) -> int:
        """
        Calculate provisional bonus from BPS ranking.
        
        Args:
            player_id: Player ID
            player_bps: Player's BPS score
            fixture_id: Fixture ID
            all_players_in_fixture: All players in the fixture with BPS
            
        Returns:
            Provisional bonus points (0-3)
        """
        # Sort players by BPS descending
        sorted_players = sorted(
            all_players_in_fixture,
            key=lambda p: p.get("bps", 0),
            reverse=True
        )
        
        # Find player's position
        for idx, player in enumerate(sorted_players):
            if player.get("id") == player_id:
                if idx == 0:
                    return 3  # Top BPS
                elif idx == 1:
                    return 2  # 2nd BPS
                elif idx == 2:
                    return 1  # 3rd BPS
                break
        
        return 0  # No bonus
    
    def _calculate_defcon(
        self,
        stats: Dict,
        position: int
    ) -> int:
        """
        Calculate DEFCON from raw stats if not available.
        
        Args:
            stats: Player stats dictionary
            position: Player position (1=GK, 2=DEF, 3=MID, 4=FWD)
            
        Returns:
            DEFCON value
        """
        # Use official value if available and > 0
        defcon = stats.get("defensive_contribution", 0)
        if defcon and defcon > 0:
            return defcon
        
        # Calculate from raw stats
        cbit = stats.get("clearances_blocks_interceptions", 0)
        tackles = stats.get("tackles", 0)
        recoveries = stats.get("recoveries", 0)
        
        cbit_total = cbit + tackles
        
        # MID/FWD: add recoveries
        if position in [3, 4]:  # MID or FWD
            return cbit_total + recoveries
        
        # DEF/GK: just CBI + tackles
        return cbit_total
    
    async def refresh_player_gameweek_stats(
        self,
        gameweek: int,
        active_player_ids: Set[int],
        live_data: Optional[Dict] = None,
        fixtures: Optional[Dict[int, Dict]] = None,
        live_only: bool = False
    ):
        """
        Refresh player gameweek stats for active players.
        
        Optimized to use live endpoint data directly when available, avoiding
        300+ element-summary API calls.
        
        Args:
            gameweek: Gameweek number
            active_player_ids: Set of active player IDs to refresh
            live_data: Optional live endpoint data (from /event/{gameweek}/live)
            fixtures: Optional fixtures dict keyed by fixture_id for fixture context
            live_only: If True, skip updating expected stats and ICT stats (static per match)
        """
        if not active_player_ids:
            logger.debug("No active players to refresh", extra={"gameweek": gameweek})
            return
        
        logger.info("Refreshing player stats", extra={
            "gameweek": gameweek,
            "player_count": len(active_player_ids),
            "using_live_data": live_data is not None
        })
        
        # Get bootstrap for player positions (only if not using live_data)
        if live_data is None:
            bootstrap = await self.fpl_client.get_bootstrap_static()
            players_map = {p["id"]: p for p in bootstrap.get("elements", [])}
        else:
            # Get bootstrap for player positions (needed for team_id and position)
            bootstrap = await self.fpl_client.get_bootstrap_static()
            players_map = {p["id"]: p for p in bootstrap.get("elements", [])}
        
        # Get fixtures if not provided
        if fixtures is None:
            fixtures_api = await self.fpl_client.get_fixtures()
            fixtures = {f["id"]: f for f in fixtures_api if f.get("event") == gameweek}
        
        fixtures_by_id = fixtures
        
        # Get existing player_gameweek_stats for fixture context
        # (live endpoint doesn't have fixture_id, opponent_team, etc.)
        # If live_only, also fetch expected/ICT stats to preserve them
        select_fields = "player_id, fixture_id, opponent_team_id, was_home, kickoff_time, team_id"
        if live_only:
            select_fields += ", expected_goals, expected_assists, expected_goal_involvements, expected_goals_conceded, influence, creativity, threat, ict_index"
        
        existing_stats = self.db_client.client.table("player_gameweek_stats").select(
            select_fields
        ).eq("gameweek", gameweek).in_("player_id", list(active_player_ids)).execute().data
        
        existing_stats_by_player = {
            stat["player_id"]: stat for stat in existing_stats
        }
        
        # Use live endpoint data directly if available (optimization)
        if live_data:
            live_elements = {elem["id"]: elem for elem in live_data.get("elements", [])}
            
            for player_id in active_player_ids:
                live_elem = live_elements.get(player_id)
                if not live_elem:
                    continue
                
                stats = live_elem.get("stats", {})
                explain = live_elem.get("explain", [])
                
                # Get player info
                player_info = players_map.get(player_id, {})
                position = player_info.get("element_type", 0)
                team_id = player_info.get("team", 0)
                
                # Get fixture context from existing stats or fixtures table
                existing_stat = existing_stats_by_player.get(player_id, {})
                fixture_id = existing_stat.get("fixture_id")
                opponent_team_id = existing_stat.get("opponent_team_id")
                was_home = existing_stat.get("was_home")
                kickoff_time = existing_stat.get("kickoff_time")
                
                # If no existing stat, try to find fixture from fixtures table
                if not fixture_id and fixtures_by_id:
                    # Find fixture where this team is playing
                    for f_id, fixture in fixtures_by_id.items():
                        if fixture.get("team_h") == team_id or fixture.get("team_a") == team_id:
                            fixture_id = f_id
                            was_home = fixture.get("team_h") == team_id
                            opponent_team_id = fixture.get("team_a") if was_home else fixture.get("team_h")
                            kickoff_time = fixture.get("kickoff_time")
                            break
                
                # Get fixture status
                match_finished = False
                match_finished_provisional = False
                team_h_score = None
                team_a_score = None
                
                if fixture_id and fixture_id in fixtures_by_id:
                    fixture = fixtures_by_id[fixture_id]
                    match_finished = fixture.get("finished", False)
                    match_finished_provisional = fixture.get("finished_provisional", False)
                    team_h_score = fixture.get("team_h_score")
                    team_a_score = fixture.get("team_a_score")
                
                # Determine bonus status from stats
                bonus = stats.get("bonus", 0)
                bonus_status = "confirmed" if bonus > 0 else "provisional"
                
                # Calculate DEFCON
                stats_for_defcon = {
                    "defensive_contribution": stats.get("defensive_contribution", 0),
                    "clearances_blocks_interceptions": stats.get("clearances_blocks_interceptions", 0),
                    "tackles": stats.get("tackles", 0),
                    "recoveries": stats.get("recoveries", 0)
                }
                defcon = self._calculate_defcon(stats_for_defcon, position)
                
                # Get existing expected/ICT stats if live_only to preserve them
                existing_stat = existing_stats_by_player.get(player_id, {})
                existing_expected_goals = existing_stat.get("expected_goals", 0) if live_only else None
                existing_expected_assists = existing_stat.get("expected_assists", 0) if live_only else None
                existing_expected_goal_involvements = existing_stat.get("expected_goal_involvements", 0) if live_only else None
                existing_expected_goals_conceded = existing_stat.get("expected_goals_conceded", 0) if live_only else None
                existing_influence = existing_stat.get("influence", 0) if live_only else None
                existing_creativity = existing_stat.get("creativity", 0) if live_only else None
                existing_threat = existing_stat.get("threat", 0) if live_only else None
                existing_ict_index = existing_stat.get("ict_index", 0) if live_only else None
                
                # Prepare stats data from live endpoint
                stats_data = {
                    "player_id": player_id,
                    "gameweek": gameweek,
                    "fixture_id": fixture_id,
                    "team_id": team_id,
                    "opponent_team_id": opponent_team_id,
                    "was_home": was_home,
                    "kickoff_time": kickoff_time,
                    "minutes": stats.get("minutes", 0),
                    "started": stats.get("minutes", 0) > 0,
                    "total_points": stats.get("total_points", 0),
                    "bonus": bonus,
                    "bps": stats.get("bps", 0),
                    "bonus_status": bonus_status,
                    "goals_scored": stats.get("goals_scored", 0),
                    "assists": stats.get("assists", 0),
                    "own_goals": stats.get("own_goals", 0),
                    "penalties_missed": stats.get("penalties_missed", 0),
                    "tackles": stats.get("tackles", 0),
                    "clearances_blocks_interceptions": stats.get("clearances_blocks_interceptions", 0),
                    "recoveries": stats.get("recoveries", 0),
                    "defensive_contribution": defcon,
                    "saves": stats.get("saves", 0),
                    "clean_sheets": stats.get("clean_sheets", 0),
                    "goals_conceded": stats.get("goals_conceded", 0),
                    "penalties_saved": stats.get("penalties_saved", 0),
                    "yellow_cards": stats.get("yellow_cards", 0),
                    "red_cards": stats.get("red_cards", 0),
                    "team_h_score": team_h_score,
                    "team_a_score": team_a_score,
                    "match_finished": match_finished,
                    "match_finished_provisional": match_finished_provisional,
                    "updated_at": datetime.now(timezone.utc).isoformat()
                }
                
                # Only update expected/ICT stats if not live_only or match is finished
                if live_only and not match_finished:
                    # Preserve existing expected/ICT stats during live matches
                    stats_data["expected_goals"] = float(existing_expected_goals or 0)
                    stats_data["expected_assists"] = float(existing_expected_assists or 0)
                    stats_data["expected_goal_involvements"] = float(existing_expected_goal_involvements or 0)
                    stats_data["expected_goals_conceded"] = float(existing_expected_goals_conceded or 0)
                    stats_data["influence"] = float(existing_influence or 0)
                    stats_data["creativity"] = float(existing_creativity or 0)
                    stats_data["threat"] = float(existing_threat or 0)
                    stats_data["ict_index"] = float(existing_ict_index or 0)
                else:
                    # Update expected/ICT stats (full refresh or match finished)
                    stats_data["expected_goals"] = float(stats.get("expected_goals", 0) or 0)
                    stats_data["expected_assists"] = float(stats.get("expected_assists", 0) or 0)
                    stats_data["expected_goal_involvements"] = float(stats.get("expected_goal_involvements", 0) or 0)
                    stats_data["expected_goals_conceded"] = float(stats.get("expected_goals_conceded", 0) or 0)
                    stats_data["influence"] = float(stats.get("influence", 0) or 0)
                    stats_data["creativity"] = float(stats.get("creativity", 0) or 0)
                    stats_data["threat"] = float(stats.get("threat", 0) or 0)
                    stats_data["ict_index"] = float(stats.get("ict_index", 0) or 0)
                
                self.db_client.upsert_player_gameweek_stats(stats_data)
        
        else:
            # Fallback to original method (element-summary calls) if live_data not available
            # This should rarely happen, but kept for backward compatibility
            logger.warning("Live data not available, falling back to element-summary calls", extra={
                "gameweek": gameweek
            })
            
            # Refresh players in batches to avoid overwhelming API
            batch_size = 10
            player_list = list(active_player_ids)
            
            for i in range(0, len(player_list), batch_size):
                batch = player_list[i:i + batch_size]
                
                # Fetch player summaries in parallel
                tasks = [
                    self.fpl_client.get_element_summary(player_id)
                    for player_id in batch
                ]
                
                summaries = await asyncio.gather(*tasks, return_exceptions=True)
                
                for player_id, summary in zip(batch, summaries):
                    if isinstance(summary, Exception):
                        logger.error("Error fetching player summary", extra={
                            "player_id": player_id,
                            "error": str(summary)
                        })
                        continue
                    
                    # Find gameweek data in history
                    history = summary.get("history", [])
                    gw_data = next(
                        (h for h in history if h.get("round") == gameweek),
                        None
                    )
                    
                    if not gw_data:
                        continue
                    
                    # Get player info
                    player_info = players_map.get(player_id, {})
                    position = player_info.get("element_type", 0)
                    
                    # Determine bonus status
                    bonus = gw_data.get("bonus", 0)
                    bonus_status = "confirmed" if bonus > 0 else "provisional"
                    
                    # Calculate DEFCON
                    defcon = self._calculate_defcon(gw_data, position)
                    
                    # Get fixture status for match_finished flags
                    fixture_id = gw_data.get("fixture")
                    match_finished = False
                    match_finished_provisional = False
                    
                    if fixture_id:
                        fixture = fixtures_by_id.get(fixture_id)
                        if fixture:
                            match_finished = fixture.get("finished", False)
                            match_finished_provisional = fixture.get("finished_provisional", False)
                    
                    # Prepare stats data
                    stats_data = {
                        "player_id": player_id,
                        "gameweek": gameweek,
                        "fixture_id": fixture_id,
                        "team_id": player_info.get("team", 0),
                        "opponent_team_id": gw_data.get("opponent_team"),
                        "was_home": gw_data.get("was_home"),
                        "kickoff_time": gw_data.get("kickoff_time"),
                        "minutes": gw_data.get("minutes", 0),
                        "started": gw_data.get("minutes", 0) > 0,
                        "total_points": gw_data.get("total_points", 0),
                        "bonus": bonus,
                        "bps": gw_data.get("bps", 0),
                        "bonus_status": bonus_status,
                        "goals_scored": gw_data.get("goals_scored", 0),
                        "assists": gw_data.get("assists", 0),
                        "own_goals": gw_data.get("own_goals", 0),
                        "penalties_missed": gw_data.get("penalties_missed", 0),
                        "tackles": gw_data.get("tackles", 0),
                        "clearances_blocks_interceptions": gw_data.get("clearances_blocks_interceptions", 0),
                        "recoveries": gw_data.get("recoveries", 0),
                        "defensive_contribution": defcon,
                        "saves": gw_data.get("saves", 0),
                        "clean_sheets": gw_data.get("clean_sheets", 0),
                        "goals_conceded": gw_data.get("goals_conceded", 0),
                        "penalties_saved": gw_data.get("penalties_saved", 0),
                        "yellow_cards": gw_data.get("yellow_cards", 0),
                        "red_cards": gw_data.get("red_cards", 0),
                        "expected_goals": float(gw_data.get("expected_goals", 0) or 0),
                        "expected_assists": float(gw_data.get("expected_assists", 0) or 0),
                        "expected_goal_involvements": float(gw_data.get("expected_goal_involvements", 0) or 0),
                        "expected_goals_conceded": float(gw_data.get("expected_goals_conceded", 0) or 0),
                        "influence": float(gw_data.get("influence", 0) or 0),
                        "creativity": float(gw_data.get("creativity", 0) or 0),
                        "threat": float(gw_data.get("threat", 0) or 0),
                        "ict_index": float(gw_data.get("ict_index", 0) or 0),
                        "team_h_score": gw_data.get("team_h_score"),
                        "team_a_score": gw_data.get("team_a_score"),
                        "match_finished": match_finished,
                        "match_finished_provisional": match_finished_provisional,
                        "updated_at": datetime.now(timezone.utc).isoformat()
                    }
                    
                    self.db_client.upsert_player_gameweek_stats(stats_data)
                
                # Small delay between batches
                if i + batch_size < len(player_list):
                    await asyncio.sleep(0.5)
        
        logger.info("Completed refreshing player stats", extra={
            "gameweek": gameweek,
            "player_count": len(active_player_ids)
        })
    
    async def refresh_player_prices(self, gameweek: int):
        """
        Refresh player prices.
        
        Args:
            gameweek: Gameweek number
        """
        logger.info("Refreshing player prices", extra={"gameweek": gameweek})
        
        try:
            bootstrap = await self.fpl_client.get_bootstrap_static()
            players = bootstrap.get("elements", [])
            
            # Get last known prices from database
            # This would require a query - simplified for now
            last_prices = {}  # TODO: Fetch from database
            
            price_changes = []
            
            for player in players:
                player_id = player["id"]
                current_price = player.get("now_cost", 0)  # Price in tenths
                last_price = last_prices.get(player_id)
                
                price_data = {
                    "player_id": player_id,
                    "gameweek": gameweek,
                    "price_tenths": current_price,
                    "price_change_tenths": current_price - (last_price or current_price),
                    "recorded_at": datetime.now(timezone.utc).isoformat(),
                    "recorded_date": datetime.now(timezone.utc).date().isoformat()
                }
                
                self.db_client.upsert_player_price(price_data)
                
                if last_price and current_price != last_price:
                    price_changes.append({
                        "player_id": player_id,
                        "old_price": last_price,
                        "new_price": current_price,
                        "change": current_price - last_price
                    })
            
            if price_changes:
                logger.info("Detected price changes", extra={
                    "gameweek": gameweek,
                    "changes_count": len(price_changes)
                })
            
            logger.info("Completed refreshing player prices", extra={
                "gameweek": gameweek,
                "players_count": len(players)
            })
            
        except Exception as e:
            logger.error("Error refreshing player prices", extra={
                "gameweek": gameweek,
                "error": str(e)
            }, exc_info=True)
    
    def get_active_player_ids(
        self,
        gameweek: int,
        fixtures: List[Dict]
    ) -> Set[int]:
        """
        Get set of active player IDs from fixtures.
        
        Args:
            gameweek: Gameweek number
            fixtures: List of fixture dictionaries
            
        Returns:
            Set of active player IDs
        """
        active_player_ids = set()
        
        # Get live event data
        # This would fetch from /event/{gameweek}/live
        # For now, return empty set (will be implemented with actual API call)
        
        return active_player_ids
