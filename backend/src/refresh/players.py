"""
Player data refresh module.

Handles refreshing player stats, prices, and fixtures data.
"""

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

from database.supabase_client import SupabaseClient
from fpl_api.client import FPLAPIClient

logger = logging.getLogger(__name__)


def _parse_selected_by_percent(value: Any) -> Optional[float]:
    """Parse FPL selected_by_percent (string e.g. '34.7') to float, or None if missing/invalid."""
    if value is None:
        return None
    try:
        s = str(value).strip()
        if not s:
            return None
        return float(s)
    except (TypeError, ValueError):
        return None


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
        Calculate provisional bonus from BPS ranking with official FPL tie rules.

        Official rules (Premier League):
        - Tie for first: Players 1 & 2 get 3 each, Player 3 gets 1 (skip 2).
        - Tie for second: Player 1 gets 3, Players 2 & 3 get 2 each (skip 1).
        - Tie for third: Player 1 gets 3, Player 2 gets 2, Players 3 & 4 get 1 each.

        Args:
            player_id: Player ID
            player_bps: Player's BPS score
            fixture_id: Fixture ID
            all_players_in_fixture: All players in the fixture with BPS (and optionally id)

        Returns:
            Provisional bonus points (0-3)
        """
        if not all_players_in_fixture:
            return 0
        # Sort by BPS descending, then by id ascending for deterministic tiebreaker
        sorted_players = sorted(
            all_players_in_fixture,
            key=lambda p: (-(p.get("bps") or 0), p.get("id") or 0),
        )
        # Group consecutive players with the same BPS
        groups: List[List[Dict]] = []
        for p in sorted_players:
            bps = p.get("bps") or 0
            if groups and (groups[-1][0].get("bps") or 0) == bps:
                groups[-1].append(p)
            else:
                groups.append([p])
        # Assign bonus by group per official FPL tie rules
        slot = 0  # 0=3pts, 1=2pts, 2=1pt
        bonus_per_slot = [3, 2, 1]
        for group in groups:
            if slot >= len(bonus_per_slot):
                break
            points = bonus_per_slot[slot]
            for p in group:
                if p.get("id") == player_id:
                    return points
            if slot == 0 and len(group) > 1:
                slot = 2  # Tie for first: skip 2, next group gets 1
            elif slot == 1 and len(group) > 1:
                slot = 3  # Tie for second: no 1pt left
            else:
                slot += 1
        return 0
    
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

    # DEFCON thresholds by position (1=GK, 2=DEF, 3=MID, 4=FWD). GK 999 = never achieve.
    _DEFCON_THRESHOLDS = {1: 999, 2: 10, 3: 12, 4: 12}

    def _feed_events_from_deltas(
        self,
        existing_stat: Dict[str, Any],
        new_stats: Dict[str, Any],
        gameweek: int,
        player_id: int,
        fixture_id: Optional[int],
        position: int,
        occurred_at: str,
    ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        """
        Compare previous vs new stats and return point-impacting feed events plus reversals.
        Only emits when a stat change actually changes FPL points.
        Reversals (e.g. goal/assist ruled out) are returned so the caller can mark the
        latest matching feed event as reversed (no separate removal row).
        """
        events: List[Dict[str, Any]] = []
        reversals: List[Dict[str, Any]] = []  # {"gameweek", "player_id", "fixture_id", "event_type"}
        total_after = new_stats.get("total_points", 0)

        def _old(key: str, default: int = 0) -> int:
            v = existing_stat.get(key, default)
            return int(v) if v is not None else default

        def _new(key: str, default: int = 0) -> int:
            v = new_stats.get(key, default)
            return int(v) if v is not None else default

        # Goal: +4 FWD, +5 MID, +6 DEF/GK
        goal_pts = {1: 6, 2: 6, 3: 5, 4: 4}.get(position, 4)
        if _new("goals_scored") > _old("goals_scored"):
            events.append({
                "gameweek": gameweek,
                "player_id": player_id,
                "fixture_id": fixture_id,
                "event_type": "goal",
                "points_delta": goal_pts,
                "total_points_after": total_after,
                "occurred_at": occurred_at,
                "metadata": None,
            })
        elif _new("goals_scored") < _old("goals_scored"):
            for _ in range(_old("goals_scored") - _new("goals_scored")):
                reversals.append({
                    "gameweek": gameweek,
                    "player_id": player_id,
                    "fixture_id": fixture_id,
                    "event_type": "goal",
                })

        if _new("assists") > _old("assists"):
            events.append({
                "gameweek": gameweek,
                "player_id": player_id,
                "fixture_id": fixture_id,
                "event_type": "assist",
                "points_delta": 3,
                "total_points_after": total_after,
                "occurred_at": occurred_at,
                "metadata": None,
            })
        elif _new("assists") < _old("assists"):
            for _ in range(_old("assists") - _new("assists")):
                reversals.append({
                    "gameweek": gameweek,
                    "player_id": player_id,
                    "fixture_id": fixture_id,
                    "event_type": "assist",
                })

        if _new("own_goals") > _old("own_goals"):
            events.append({
                "gameweek": gameweek,
                "player_id": player_id,
                "fixture_id": fixture_id,
                "event_type": "own_goal",
                "points_delta": -2,
                "total_points_after": total_after,
                "occurred_at": occurred_at,
                "metadata": None,
            })

        if _new("penalties_missed") > _old("penalties_missed"):
            events.append({
                "gameweek": gameweek,
                "player_id": player_id,
                "fixture_id": fixture_id,
                "event_type": "penalty_missed",
                "points_delta": -2,
                "total_points_after": total_after,
                "occurred_at": occurred_at,
                "metadata": None,
            })

        if _new("penalties_saved") > _old("penalties_saved"):
            events.append({
                "gameweek": gameweek,
                "player_id": player_id,
                "fixture_id": fixture_id,
                "event_type": "penalty_saved",
                "points_delta": 5,
                "total_points_after": total_after,
                "occurred_at": occurred_at,
                "metadata": None,
            })

        old_bonus = _old("bonus")
        new_bonus = _new("bonus")
        if new_bonus != old_bonus:
            delta = new_bonus - old_bonus
            events.append({
                "gameweek": gameweek,
                "player_id": player_id,
                "fixture_id": fixture_id,
                "event_type": "bonus_change",
                "points_delta": delta,
                "total_points_after": total_after,
                "occurred_at": occurred_at,
                "metadata": {"from_bonus": old_bonus, "to_bonus": new_bonus},
            })

        if _new("yellow_cards") > _old("yellow_cards"):
            events.append({
                "gameweek": gameweek,
                "player_id": player_id,
                "fixture_id": fixture_id,
                "event_type": "yellow_card",
                "points_delta": -1,
                "total_points_after": total_after,
                "occurred_at": occurred_at,
                "metadata": None,
            })

        if _new("red_cards") > _old("red_cards"):
            events.append({
                "gameweek": gameweek,
                "player_id": player_id,
                "fixture_id": fixture_id,
                "event_type": "red_card",
                "points_delta": -3,
                "total_points_after": total_after,
                "occurred_at": occurred_at,
                "metadata": None,
            })

        if _new("clean_sheets") > _old("clean_sheets"):
            events.append({
                "gameweek": gameweek,
                "player_id": player_id,
                "fixture_id": fixture_id,
                "event_type": "clean_sheet",
                "points_delta": 1,
                "total_points_after": total_after,
                "occurred_at": occurred_at,
                "metadata": None,
            })

        # Saves: +1 pt per 3 saves
        old_save_pts = _old("saves") // 3
        new_save_pts = _new("saves") // 3
        for _ in range(new_save_pts - old_save_pts):
            events.append({
                "gameweek": gameweek,
                "player_id": player_id,
                "fixture_id": fixture_id,
                "event_type": "saves_point",
                "points_delta": 1,
                "total_points_after": total_after,
                "occurred_at": occurred_at,
                "metadata": None,
            })

        # Goals conceded (GK): -1 per 2 goals
        if position == 1:
            old_penalty = _old("goals_conceded") // 2
            new_penalty = _new("goals_conceded") // 2
            for _ in range(new_penalty - old_penalty):
                events.append({
                    "gameweek": gameweek,
                    "player_id": player_id,
                    "fixture_id": fixture_id,
                    "event_type": "goals_conceded",
                    "points_delta": -1,
                    "total_points_after": total_after,
                    "occurred_at": occurred_at,
                    "metadata": None,
                })

        # DEFCON: +2 when crossing threshold, -2 when dropping below
        threshold = self._DEFCON_THRESHOLDS.get(position, 999)
        old_dc = _old("defensive_contribution")
        new_dc = _new("defensive_contribution")
        old_achieved = old_dc >= threshold
        new_achieved = new_dc >= threshold
        if not old_achieved and new_achieved:
            events.append({
                "gameweek": gameweek,
                "player_id": player_id,
                "fixture_id": fixture_id,
                "event_type": "defcon_achieved",
                "points_delta": 2,
                "total_points_after": total_after,
                "occurred_at": occurred_at,
                "metadata": None,
            })
        elif old_achieved and not new_achieved:
            events.append({
                "gameweek": gameweek,
                "player_id": player_id,
                "fixture_id": fixture_id,
                "event_type": "defcon_removed",
                "points_delta": -2,
                "total_points_after": total_after,
                "occurred_at": occurred_at,
                "metadata": None,
            })

        # 60+ minutes: +1 pt when crossing 60
        old_mins = _old("minutes")
        new_mins = _new("minutes")
        if old_mins < 60 <= new_mins:
            events.append({
                "gameweek": gameweek,
                "player_id": player_id,
                "fixture_id": fixture_id,
                "event_type": "sixty_plus_minutes",
                "points_delta": 1,
                "total_points_after": total_after,
                "occurred_at": occurred_at,
                "metadata": None,
            })

        return (events, reversals)

    def _sync_players_ownership_from_bootstrap(self, bootstrap: Dict, players_map: Dict[int, Dict]) -> None:
        """Update selected_by_percent (overall ownership) and cost_tenths (current price) for all players from bootstrap-static API data."""
        elements = bootstrap.get("elements", [])
        if not elements:
            return
        now = datetime.now(timezone.utc).isoformat()
        for elem in elements:
            try:
                now_cost = elem.get("now_cost")
                try:
                    cost_tenths = int(now_cost) if now_cost is not None else None
                except (TypeError, ValueError):
                    cost_tenths = None
                player_data = {
                    "fpl_player_id": elem["id"],
                    "first_name": elem.get("first_name", ""),
                    "second_name": elem.get("second_name", ""),
                    "web_name": elem.get("web_name", ""),
                    "team_id": elem.get("team", 0),
                    "position": elem.get("element_type", 0),
                    "selected_by_percent": _parse_selected_by_percent(elem.get("selected_by_percent")),
                    "updated_at": now,
                }
                if cost_tenths is not None:
                    player_data["cost_tenths"] = cost_tenths
                self.db_client.upsert_player(player_data)
            except Exception as e:
                logger.warning("Sync player ownership failed", extra={"player_id": elem.get("id"), "error": str(e)})
        logger.debug("Synced overall ownership for players", extra={"count": len(elements)})

    def sync_players_ownership_from_bootstrap(self, bootstrap: Dict) -> None:
        """Update selected_by_percent (overall ownership) and cost_tenths (current price) for all players from bootstrap-static. Call on every refresh cycle so player detail modal always has API-backed ownership and price."""
        elements = bootstrap.get("elements", [])
        if not elements:
            return
        players_map = {e["id"]: e for e in elements if "id" in e}
        self._sync_players_ownership_from_bootstrap(bootstrap, players_map)

    async def refresh_player_gameweek_stats(
        self,
        gameweek: int,
        active_player_ids: Set[int],
        live_data: Optional[Dict] = None,
        fixtures: Optional[Dict[int, Dict]] = None,
        bootstrap: Optional[Dict] = None,
        live_only: bool = False,
        expect_live_unavailable: bool = False,
    ):
        """
        Refresh player gameweek stats for active players.
        
        Optimized to use live endpoint data directly when available, avoiding
        300+ element-summary API calls. "Live data" is the FPL API response from
        /event/{gameweek}/live; it is often unavailable for past/finished gameweeks
        or outside match windows, in which case we fall back to element-summary calls.
        
        Args:
            gameweek: Gameweek number
            active_player_ids: Set of active player IDs to refresh
            live_data: Optional live endpoint data (from /event/{gameweek}/live)
            fixtures: Optional fixtures dict keyed by fixture_id for fixture context
            bootstrap: Optional bootstrap-static data (avoids refetch when e.g. backfilling)
            live_only: If True, skip updating expected stats and ICT stats (static per match)
            expect_live_unavailable: If True, log fallback to element-summary at debug (e.g. backfill)
        """
        if not active_player_ids:
            logger.debug("No active players to refresh", extra={"gameweek": gameweek})
            return
        
        logger.info("Refreshing player stats", extra={
            "gameweek": gameweek,
            "player_count": len(active_player_ids),
            "using_live_data": live_data is not None
        })
        
        # Use provided bootstrap or fetch
        if bootstrap is not None:
            players_map = {p["id"]: p for p in bootstrap.get("elements", [])}
        else:
            bootstrap = await self.fpl_client.get_bootstrap_static()
            players_map = {p["id"]: p for p in bootstrap.get("elements", [])}
        
        # Get fixtures if not provided
        if fixtures is None:
            fixtures_api = await self.fpl_client.get_fixtures()
            fixtures = {f["id"]: f for f in fixtures_api if f.get("event") == gameweek}
        
        fixtures_by_id = fixtures
        
        # Ensure all active players exist in players table (avoids FK violation for new FPL players e.g. mid-season signings).
        if not live_only:
            # Full refresh: sync overall ownership for all players from bootstrap, then upsert active players.
            self._sync_players_ownership_from_bootstrap(bootstrap, players_map)
            for player_id in active_player_ids:
                elem = players_map.get(player_id)
                if elem:
                    player_data = {
                        "fpl_player_id": elem["id"],
                        "first_name": elem.get("first_name", ""),
                        "second_name": elem.get("second_name", ""),
                        "web_name": elem.get("web_name", ""),
                        "team_id": elem.get("team", 0),
                        "position": elem.get("element_type", 0),
                        "selected_by_percent": _parse_selected_by_percent(elem.get("selected_by_percent")),
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    }
                    try:
                        self.db_client.upsert_player(player_data)
                    except Exception as e:
                        logger.warning("Upsert player failed", extra={"player_id": player_id, "error": str(e)})
        else:
            # Live-only: still ensure any player we write stats for exists (e.g. new mid-season FPL ID 808).
            existing_players = self.db_client.client.table("players").select("fpl_player_id").in_(
                "fpl_player_id", list(active_player_ids)
            ).execute().data or []
            existing_ids = {r["fpl_player_id"] for r in existing_players}
            missing_ids = active_player_ids - existing_ids
            if missing_ids:
                logger.info("Upserting missing players for FK", extra={"gameweek": gameweek, "count": len(missing_ids), "player_ids": list(missing_ids)[:10]})
                for player_id in missing_ids:
                    elem = players_map.get(player_id)
                    if elem:
                        player_data = {
                            "fpl_player_id": elem["id"],
                            "first_name": elem.get("first_name", ""),
                            "second_name": elem.get("second_name", ""),
                            "web_name": elem.get("web_name", ""),
                            "team_id": elem.get("team", 0),
                            "position": elem.get("element_type", 0),
                            "selected_by_percent": _parse_selected_by_percent(elem.get("selected_by_percent")),
                            "updated_at": datetime.now(timezone.utc).isoformat(),
                        }
                        try:
                            self.db_client.upsert_player(player_data)
                        except Exception as e:
                            logger.warning("Upsert player failed", extra={"player_id": player_id, "error": str(e)})
        
        # Get existing player_gameweek_stats for fixture context and for feed-event deltas.
        # (live endpoint doesn't have fixture_id, opponent_team, etc.)
        # Include stat fields so _feed_events_from_deltas sees previous values and only emits on real change.
        select_fields = (
            "player_id, fixture_id, opponent_team_id, was_home, kickoff_time, team_id, "
            "minutes, goals_scored, assists, own_goals, penalties_missed, penalties_saved, "
            "bonus, provisional_bonus, yellow_cards, red_cards, clean_sheets, saves, goals_conceded, "
            "defensive_contribution, total_points"
        )
        if live_only:
            select_fields += ", expected_goals, expected_assists, expected_goal_involvements, expected_goals_conceded, influence, creativity, threat, ict_index"
        
        existing_stats = self.db_client.client.table("player_gameweek_stats").select(
            select_fields
        ).eq("gameweek", gameweek).in_("player_id", list(active_player_ids)).execute().data
        
        # Key by (player_id, fixture_id) so we support multiple rows per player (DGW)
        existing_stats_by_player_fixture = {
            (stat["player_id"], stat.get("fixture_id")): stat for stat in existing_stats
        }
        
        # Use live endpoint data directly if available (optimization)
        if live_data:
            live_elements = {elem["id"]: elem for elem in live_data.get("elements", [])}
            batch_stats = []
            feed_events: List[Dict[str, Any]] = []
            feed_reversals: List[Dict[str, Any]] = []
            occurred_at = datetime.now(timezone.utc).isoformat()

            # Build fixture_id -> list of {id, bps, minutes} for provisional bonus (MP > 45 = second half)
            fixture_players: Dict[int, List[Dict]] = {}
            for player_id in active_player_ids:
                team_id = players_map.get(player_id, {}).get("team", 0)
                if not fixtures_by_id:
                    continue
                live_elem = live_elements.get(player_id)
                if not live_elem:
                    continue
                st = live_elem.get("stats", {})
                for f_id, fixture in fixtures_by_id.items():
                    if fixture.get("team_h") == team_id or fixture.get("team_a") == team_id:
                        if f_id not in fixture_players:
                            fixture_players[f_id] = []
                        fixture_players[f_id].append({"id": player_id, "bps": st.get("bps", 0), "minutes": st.get("minutes", 0)})
            fixture_past_threshold = {
                fid: max((p["minutes"] for p in plist), default=0) > 45
                for fid, plist in fixture_players.items()
            }

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
                
                # Get all fixtures for this team in this gameweek (1 = single GW, 2 = DGW)
                player_fixtures = []
                if fixtures_by_id:
                    for f_id, fixture in fixtures_by_id.items():
                        if fixture.get("team_h") == team_id or fixture.get("team_a") == team_id:
                            player_fixtures.append((f_id, fixture))
                    player_fixtures.sort(key=lambda x: x[1].get("kickoff_time") or "")
                
                if not player_fixtures:
                    player_fixtures = [(0, {})]
                
                # One row per fixture; first row gets full live stats, rest get 0 (DGW: two opponents, points on first)
                for idx, (f_id, fixture) in enumerate(player_fixtures):
                    fixture_id = f_id if f_id else 0
                    was_home = fixture.get("team_h") == team_id if fixture else False
                    opponent_team_id = fixture.get("team_a") if was_home else fixture.get("team_h") if fixture else None
                    kickoff_time = fixture.get("kickoff_time") if fixture else None
                    
                    existing_stat = existing_stats_by_player_fixture.get((player_id, fixture_id), {})
                    if not existing_stat and fixture_id and fixture_id != 0:
                        existing_stat = existing_stats_by_player_fixture.get((player_id, None), {})
                    
                    match_finished = False
                    match_finished_provisional = False
                    team_h_score = None
                    team_a_score = None
                    if fixture_id and fixture_id in fixtures_by_id:
                        f = fixtures_by_id[fixture_id]
                        match_finished = f.get("finished", False)
                        match_finished_provisional = f.get("finished_provisional", False)
                        team_h_score = f.get("team_h_score")
                        team_a_score = f.get("team_a_score")
                    
                    bonus = stats.get("bonus", 0)
                    bonus_status = "confirmed" if bonus > 0 else "provisional"
                    provisional_bonus_val = 0
                    if bonus_status == "provisional" and bonus == 0 and fixture_id and fixture_past_threshold.get(fixture_id, False):
                        all_in_fixture = fixture_players.get(fixture_id, [])
                        provisional_bonus_val = self._calculate_provisional_bonus(
                            player_id,
                            stats.get("bps", 0),
                            fixture_id,
                            all_in_fixture,
                        )
                    
                    stats_for_defcon = {
                        "defensive_contribution": stats.get("defensive_contribution", 0),
                        "clearances_blocks_interceptions": stats.get("clearances_blocks_interceptions", 0),
                        "tackles": stats.get("tackles", 0),
                        "recoveries": stats.get("recoveries", 0)
                    }
                    defcon = self._calculate_defcon(stats_for_defcon, position)
                    
                    is_first_row = idx == 0
                    existing_expected_goals = existing_stat.get("expected_goals", 0) if live_only else None
                    existing_expected_assists = existing_stat.get("expected_assists", 0) if live_only else None
                    existing_expected_goal_involvements = existing_stat.get("expected_goal_involvements", 0) if live_only else None
                    existing_expected_goals_conceded = existing_stat.get("expected_goals_conceded", 0) if live_only else None
                    existing_influence = existing_stat.get("influence", 0) if live_only else None
                    existing_creativity = existing_stat.get("creativity", 0) if live_only else None
                    existing_threat = existing_stat.get("threat", 0) if live_only else None
                    existing_ict_index = existing_stat.get("ict_index", 0) if live_only else None
                    
                    def _float_from(v):
                        if v is None or v == "":
                            return None
                        try:
                            return float(v)
                        except (TypeError, ValueError):
                            return None
                    def _expected_or_existing(key: str, existing: Optional[float]) -> float:
                        from_live = _float_from(stats.get(key))
                        if from_live is not None:
                            return from_live
                        if live_only and not match_finished and existing is not None:
                            return float(existing)
                        return 0.0
                    
                    stats_data = {
                        "player_id": player_id,
                        "gameweek": gameweek,
                        "fixture_id": fixture_id,
                        "team_id": team_id,
                        "opponent_team_id": opponent_team_id,
                        "was_home": was_home,
                        "kickoff_time": kickoff_time,
                        "minutes": stats.get("minutes", 0) if is_first_row else 0,
                        "started": (stats.get("minutes", 0) > 0) if is_first_row else False,
                        "total_points": stats.get("total_points", 0) if is_first_row else 0,
                        "bonus": bonus if (is_first_row or provisional_bonus_val == bonus) else 0,  # DGW: also on row where he earned it
                        "provisional_bonus": provisional_bonus_val,  # per-fixture so DGW shows bonus on correct match
                        "bps": stats.get("bps", 0) if is_first_row else 0,
                        "bonus_status": bonus_status,
                        "goals_scored": stats.get("goals_scored", 0) if is_first_row else 0,
                        "assists": stats.get("assists", 0) if is_first_row else 0,
                        "own_goals": stats.get("own_goals", 0) if is_first_row else 0,
                        "penalties_missed": stats.get("penalties_missed", 0) if is_first_row else 0,
                        "tackles": stats.get("tackles", 0) if is_first_row else 0,
                        "clearances_blocks_interceptions": stats.get("clearances_blocks_interceptions", 0) if is_first_row else 0,
                        "recoveries": stats.get("recoveries", 0) if is_first_row else 0,
                        "defensive_contribution": defcon if is_first_row else 0,
                        "saves": stats.get("saves", 0) if is_first_row else 0,
                        "clean_sheets": stats.get("clean_sheets", 0) if is_first_row else 0,
                        "goals_conceded": stats.get("goals_conceded", 0) if is_first_row else 0,
                        "penalties_saved": stats.get("penalties_saved", 0) if is_first_row else 0,
                        "yellow_cards": stats.get("yellow_cards", 0) if is_first_row else 0,
                        "red_cards": stats.get("red_cards", 0) if is_first_row else 0,
                        "team_h_score": team_h_score,
                        "team_a_score": team_a_score,
                        "match_finished": match_finished,
                        "match_finished_provisional": match_finished_provisional,
                        "updated_at": datetime.now(timezone.utc).isoformat()
                    }
                    stats_data["expected_goals"] = _expected_or_existing("expected_goals", existing_expected_goals) if is_first_row else 0.0
                    stats_data["expected_assists"] = _expected_or_existing("expected_assists", existing_expected_assists) if is_first_row else 0.0
                    stats_data["expected_goal_involvements"] = _expected_or_existing("expected_goal_involvements", existing_expected_goal_involvements) if is_first_row else 0.0
                    stats_data["expected_goals_conceded"] = _expected_or_existing("expected_goals_conceded", existing_expected_goals_conceded) if is_first_row else 0.0
                    stats_data["influence"] = _expected_or_existing("influence", existing_influence) if is_first_row else 0.0
                    stats_data["creativity"] = _expected_or_existing("creativity", existing_creativity) if is_first_row else 0.0
                    stats_data["threat"] = _expected_or_existing("threat", existing_threat) if is_first_row else 0.0
                    stats_data["ict_index"] = _expected_or_existing("ict_index", existing_ict_index) if is_first_row else 0.0
                    
                    batch_stats.append(stats_data)

                    if is_first_row:
                        effective_new_bonus = bonus if (match_finished or bonus > 0) else provisional_bonus_val
                        effective_old_bonus = (
                            existing_stat.get("bonus", 0)
                            if match_finished
                            else existing_stat.get("provisional_bonus", existing_stat.get("bonus", 0))
                        )
                        existing_stat_for_feed = {**existing_stat, "bonus": effective_old_bonus}
                        base_total = stats.get("total_points", 0)
                        effective_total = base_total + (effective_new_bonus - bonus)
                        stats_for_feed = {**stats, "bonus": effective_new_bonus, "total_points": effective_total}
                        events_for_player, reversals_for_player = self._feed_events_from_deltas(
                            existing_stat_for_feed,
                            stats_for_feed,
                            gameweek,
                            player_id,
                            fixture_id,
                            position,
                            occurred_at,
                        )
                        feed_events.extend(events_for_player)
                        feed_reversals.extend(reversals_for_player)
            
            if batch_stats:
                self.db_client.upsert_player_gameweek_stats(batch_stats)
            if feed_events:
                try:
                    self.db_client.insert_feed_events(feed_events)
                except Exception as e:
                    logger.warning("Feed events insert failed", extra={"gameweek": gameweek, "count": len(feed_events), "error": str(e)})
            if feed_reversals:
                try:
                    self.db_client.mark_feed_events_reversed(feed_reversals)
                except Exception as e:
                    logger.warning("Feed reversals update failed", extra={"gameweek": gameweek, "count": len(feed_reversals), "error": str(e)})
        
        else:
            # Fallback to element-summary calls when /event/{gw}/live is unavailable
            # (e.g. past gameweeks, backfill, or outside match window)
            if expect_live_unavailable:
                logger.debug("Live data not available, using element-summary calls", extra={
                    "gameweek": gameweek
                })
            else:
                logger.warning("Live data unavailable, using element-summary", extra={"gameweek": gameweek})
            
            # Load existing stats with stat fields so we can emit feed events from deltas
            existing_stat_fields = (
                "player_id, fixture_id, goals_scored, assists, minutes, bonus, own_goals, "
                "penalties_missed, penalties_saved, yellow_cards, red_cards, defensive_contribution, "
                "clean_sheets, saves, goals_conceded, total_points"
            )
            existing_stats_full = self.db_client.client.table("player_gameweek_stats").select(
                existing_stat_fields
            ).eq("gameweek", gameweek).in_("player_id", list(active_player_ids)).execute().data
            existing_stats_by_player_fixture = {(s["player_id"], s.get("fixture_id")): s for s in (existing_stats_full or [])}
            feed_events: List[Dict[str, Any]] = []
            feed_reversals: List[Dict[str, Any]] = []
            occurred_at = datetime.now(timezone.utc).isoformat()
            
            # Refresh players in batches to avoid overwhelming API
            batch_size = 10
            player_list = list(active_player_ids)
            
            for i in range(0, len(player_list), batch_size):
                batch = player_list[i:i + batch_size]
                batch_stats = []
                
                # Fetch player summaries in parallel
                tasks = [
                    self.fpl_client.get_element_summary(player_id)
                    for player_id in batch
                ]
                
                summaries = await asyncio.gather(*tasks, return_exceptions=True)
                
                for player_id, summary in zip(batch, summaries):
                    if isinstance(summary, Exception):
                        logger.error("Player summary failed", extra={
                            "player_id": player_id,
                            "error": str(summary)
                        })
                        continue
                    
                    # History can have 1 or 2 entries per gameweek (DGW)
                    history = summary.get("history", [])
                    gw_data_list = [h for h in history if h.get("round") == gameweek]
                    gw_data_list.sort(key=lambda h: h.get("kickoff_time") or "")
                    
                    if not gw_data_list:
                        continue
                    
                    player_info = players_map.get(player_id, {})
                    position = player_info.get("element_type", 0)
                    
                    for gw_data in gw_data_list:
                        bonus = gw_data.get("bonus", 0)
                        bonus_status = "confirmed" if bonus > 0 else "provisional"
                        defcon = self._calculate_defcon(gw_data, position)
                        fixture_id = gw_data.get("fixture") or 0
                        match_finished = False
                        match_finished_provisional = False
                        if fixture_id and fixtures_by_id and fixture_id in fixtures_by_id:
                            fixture = fixtures_by_id.get(fixture_id)
                            if fixture:
                                match_finished = fixture.get("finished", False)
                                match_finished_provisional = fixture.get("finished_provisional", False)
                        
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
                            "provisional_bonus": 0,
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
                        batch_stats.append(stats_data)
                        
                        existing_stat = existing_stats_by_player_fixture.get((player_id, fixture_id), {})
                        if not existing_stat and fixture_id:
                            existing_stat = existing_stats_by_player_fixture.get((player_id, None), {})
                        new_stats_for_feed = {
                            "goals_scored": gw_data.get("goals_scored", 0),
                            "assists": gw_data.get("assists", 0),
                            "minutes": gw_data.get("minutes", 0),
                            "bonus": bonus,
                            "total_points": gw_data.get("total_points", 0),
                            "own_goals": gw_data.get("own_goals", 0),
                            "penalties_missed": gw_data.get("penalties_missed", 0),
                            "penalties_saved": gw_data.get("penalties_saved", 0),
                            "yellow_cards": gw_data.get("yellow_cards", 0),
                            "red_cards": gw_data.get("red_cards", 0),
                            "defensive_contribution": defcon,
                            "clean_sheets": gw_data.get("clean_sheets", 0),
                            "saves": gw_data.get("saves", 0),
                            "goals_conceded": gw_data.get("goals_conceded", 0),
                        }
                        events_for_player, reversals_for_player = self._feed_events_from_deltas(
                            existing_stat,
                            new_stats_for_feed,
                            gameweek,
                            player_id,
                            fixture_id,
                            position,
                            occurred_at,
                        )
                        feed_events.extend(events_for_player)
                        feed_reversals.extend(reversals_for_player)
                
                if batch_stats:
                    self.db_client.upsert_player_gameweek_stats(batch_stats)
                
                # Small delay between batches
                if i + batch_size < len(player_list):
                    await asyncio.sleep(0.5)
            
            # Compute and persist provisional_bonus for provisional fixtures (BPS rank 3/2/1)
            # so the frontend can show correct points when bonus not yet in API
            provisional_fixture_ids = [
                fid for fid, f in fixtures_by_id.items()
                if f.get("finished_provisional") and not f.get("finished")
            ]
            if provisional_fixture_ids:
                try:
                    rows = self.db_client.client.table("player_gameweek_stats").select(
                        "*"
                    ).eq("gameweek", gameweek).in_(
                        "fixture_id", provisional_fixture_ids
                    ).execute().data or []
                    to_update = [
                        r for r in rows
                        if (r.get("bonus_status") == "provisional" and (r.get("bonus") or 0) == 0)
                    ]
                    if to_update:
                        fixture_players: Dict[int, List[Dict]] = {}
                        for r in to_update:
                            fid = r.get("fixture_id")
                            if fid not in fixture_players:
                                fixture_players[fid] = []
                            fixture_players[fid].append({
                                "id": r["player_id"],
                                "bps": r.get("bps") or 0
                            })
                        for r in to_update:
                            fid = r.get("fixture_id")
                            plist = fixture_players.get(fid, [])
                            r["provisional_bonus"] = self._calculate_provisional_bonus(
                                r["player_id"],
                                r.get("bps") or 0,
                                fid,
                                plist,
                            )
                        self.db_client.upsert_player_gameweek_stats(to_update)
                except Exception as e:
                    logger.warning(
                        "Provisional bonus update failed (element-summary path)",
                        extra={"gameweek": gameweek, "error": str(e)}
                    )
            
            if feed_events:
                try:
                    self.db_client.insert_feed_events(feed_events)
                except Exception as e:
                    logger.warning("Feed events insert failed (element-summary path)", extra={"gameweek": gameweek, "count": len(feed_events), "error": str(e)})
            if feed_reversals:
                try:
                    self.db_client.mark_feed_events_reversed(feed_reversals)
                except Exception as e:
                    logger.warning("Feed reversals update failed (element-summary path)", extra={"gameweek": gameweek, "count": len(feed_reversals), "error": str(e)})
        
        logger.info("Player stats done", extra={"gameweek": gameweek, "count": len(active_player_ids)})
    
    async def refresh_player_prices(self, gameweek: int):
        """
        Refresh player prices (5:40pm-style snapshot). Fetches last known prices from DB
        to set prior_price_tenths so price_change views and backfill work.
        """
        logger.info("Refreshing player prices", extra={"gameweek": gameweek})
        
        try:
            bootstrap = await self.fpl_client.get_bootstrap_static()
            players = bootstrap.get("elements", [])
            today_iso = datetime.now(timezone.utc).date().isoformat()

            # Last snapshot before today (same gameweek) for prior_price_tenths
            last_prices = self.db_client.get_last_known_prices(today_iso, gameweek)
            prior_count = len(last_prices)
            if prior_count == 0:
                logger.warning(
                    "No prior price snapshot for prior_price_tenths; Actual changes will be empty until we have a previous run",
                    extra={"gameweek": gameweek, "today_iso": today_iso},
                )

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
                    "recorded_date": today_iso,
                }
                if last_price is not None:
                    price_data["prior_price_tenths"] = last_price

                self.db_client.upsert_player_price(price_data)
                self.db_client.update_player_cost_tenths(player_id, current_price)

                if last_price is not None and current_price != last_price:
                    price_changes.append({
                        "player_id": player_id,
                        "old_price": last_price,
                        "new_price": current_price,
                        "change": current_price - last_price,
                    })

            if price_changes:
                logger.info("Price changes", extra={"gameweek": gameweek, "count": len(price_changes)})
                try:
                    self.db_client.clear_price_change_predictions()
                    logger.info(
                        "Cleared price_change_predictions after detecting actual changes; next LiveFPL run will repopulate",
                        extra={"gameweek": gameweek},
                    )
                except Exception as e:
                    logger.warning(
                        "Clear price_change_predictions failed",
                        extra={"gameweek": gameweek, "error": str(e)},
                        exc_info=True,
                    )

            logger.info(
                "Player prices done",
                extra={
                    "gameweek": gameweek,
                    "count": len(players),
                    "prior_snapshot_players": prior_count,
                    "price_changes_detected": len(price_changes),
                },
            )

        except Exception as e:
            logger.error("Player prices failed", extra={"gameweek": gameweek, "error": str(e)}, exc_info=True)

    def sync_player_prices_from_bootstrap(self, bootstrap: Dict[str, Any], gameweek: int) -> None:
        """
        Upsert current prices for all players from bootstrap so player_prices always has
        at least one row per player for the current gameweek. Preserves existing
        prior_price_tenths for today so we never overwrite the price-window snapshot.
        """
        if not gameweek:
            return
        try:
            elements = bootstrap.get("elements", [])
            today_iso = datetime.now(timezone.utc).date().isoformat()
            existing_priors = self.db_client.get_today_prior_prices(today_iso, gameweek)
            for player in elements:
                player_id = player.get("id")
                if player_id is None:
                    continue
                current_price = player.get("now_cost", 0)
                prior = existing_priors.get(player_id)
                price_data = {
                    "player_id": player_id,
                    "gameweek": gameweek,
                    "price_tenths": current_price,
                    "price_change_tenths": (current_price - prior) if prior is not None else 0,
                    "recorded_at": datetime.now(timezone.utc).isoformat(),
                    "recorded_date": today_iso,
                }
                if prior is not None:
                    price_data["prior_price_tenths"] = prior
                self.db_client.upsert_player_price(price_data)
                self.db_client.update_player_cost_tenths(player_id, current_price)
            logger.debug(
                "Player prices synced from bootstrap",
                extra={"gameweek": gameweek, "count": len(elements), "preserved_priors": len(existing_priors)},
            )
        except Exception as e:
            logger.warning(
                "Sync player prices from bootstrap failed",
                extra={"gameweek": gameweek, "error": str(e)},
                exc_info=True,
            )

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
