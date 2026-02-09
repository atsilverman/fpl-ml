import { useQuery } from '@tanstack/react-query'
import { useGameweekData } from './useGameweekData'
import { useConfiguration } from '../contexts/ConfigurationContext'
import { useRefreshState } from './useRefreshState'
import { supabase } from '../lib/supabase'

/**
 * Shared fetcher for current gameweek players for a given manager.
 * Used by useCurrentGameweekPlayers and useCurrentGameweekPlayersForManager.
 */
async function fetchCurrentGameweekPlayersForManager(MANAGER_ID, gameweek) {
  if (!MANAGER_ID || !gameweek) {
    return []
  }

  // Fetch manager picks for current gameweek (all 15 positions)
  const picksResult = await supabase
        .from('manager_picks')
        .select(`
          position,
          player_id,
          is_captain,
          is_vice_captain,
          multiplier,
          was_auto_subbed_in,
          auto_sub_replaced_player_id
        `)
        .eq('manager_id', MANAGER_ID)
        .eq('gameweek', gameweek)
        .order('position', { ascending: true })

      if (picksResult.error) {
        console.error('Error fetching manager picks:', picksResult.error)
        throw picksResult.error
      }

      const picks = picksResult.data || []
      if (picks.length === 0) {
        return []
      }

      // Get all unique player IDs (including auto-sub replacements)
      const playerIds = new Set()
      picks.forEach(pick => {
        playerIds.add(pick.player_id)
        if (pick.auto_sub_replaced_player_id) {
          playerIds.add(pick.auto_sub_replaced_player_id)
        }
      })

      // Fetch player gameweek stats (default: MP, OPP, PTS; extra for horizontal scroll: G, A, CS, S, BPS, B, DEF)
      const statsResult = await supabase
        .from('player_gameweek_stats')
        .select(`
          player_id,
          fixture_id,
          total_points,
          minutes,
          opponent_team_id,
          was_home,
          started,
          kickoff_time,
          match_finished,
          match_finished_provisional,
          goals_scored,
          assists,
          clean_sheets,
          saves,
          bps,
          bonus,
          bonus_status,
          provisional_bonus,
          defensive_contribution,
          yellow_cards,
          red_cards,
          defcon_points_achieved,
          expected_goals,
          expected_assists,
          expected_goal_involvements,
          expected_goals_conceded
        `)
        .eq('gameweek', gameweek)
        .in('player_id', Array.from(playerIds))

      if (statsResult.error) {
        console.error('Error fetching player stats:', statsResult.error)
        throw statsResult.error
      }

      // player_id -> array of stats (1 or 2 for DGW), sorted by kickoff
      const statsByPlayer = {}
      ;(statsResult.data || []).forEach(stat => {
        const pid = stat.player_id
        if (!statsByPlayer[pid]) statsByPlayer[pid] = []
        statsByPlayer[pid].push(stat)
      })
      Object.keys(statsByPlayer).forEach(pid => {
        statsByPlayer[pid].sort((a, b) => {
          const tA = a.kickoff_time ? new Date(a.kickoff_time).getTime() : 0
          const tB = b.kickoff_time ? new Date(b.kickoff_time).getTime() : 0
          return tA - tB
        })
      })

      // Fetch player info and team info
      const playerInfoResult = await supabase
        .from('players')
        .select(`
          fpl_player_id,
          web_name,
          position,
          team_id,
          teams(short_name)
        `)
        .in('fpl_player_id', Array.from(playerIds))

      if (playerInfoResult.error) {
        console.error('Error fetching player info:', playerInfoResult.error)
        throw playerInfoResult.error
      }

      // Create a map for quick lookup: player_id -> player info
      const playerInfoMap = {}
      ;(playerInfoResult.data || []).forEach(player => {
        playerInfoMap[player.fpl_player_id] = player
      })

      // Fetch opponent team info
      const opponentTeamIds = new Set()
      Object.values(statsByPlayer).flat().forEach(stat => {
        if (stat.opponent_team_id) opponentTeamIds.add(stat.opponent_team_id)
      })

      let opponentTeamsMap = {}
      if (opponentTeamIds.size > 0) {
        const opponentTeamsResult = await supabase
          .from('teams')
          .select('team_id, short_name')
          .in('team_id', Array.from(opponentTeamIds))

        if (opponentTeamsResult.error) {
          console.error('Error fetching opponent teams:', opponentTeamsResult.error)
          // Don't throw, just continue without opponent badges
        } else {
          ;(opponentTeamsResult.data || []).forEach(team => {
            opponentTeamsMap[team.team_id] = team
          })
        }
      }

      // Who was auto-subbed out? (the starter whose place was taken by the bench player)
      const subbedOutPlayerId = picks.find(p => p.was_auto_subbed_in)?.auto_sub_replaced_player_id || null

      // Fetch fixtures for this gameweek so we can use fixture.finished (same source as debug panel)
      // to decide "match finished" and show official bonus in B column instead of stale provisional
      const fixturesResult = await supabase
        .from('fixtures')
        .select('fpl_fixture_id, finished')
        .eq('gameweek', gameweek)
      const fixturesById = {}
      const fixtureList = fixturesResult.data || []
      fixtureList.forEach(f => {
        const id = f.fpl_fixture_id
        fixturesById[id] = f
        fixturesById[Number(id)] = f
        fixturesById[String(id)] = f
      })
      const allFixturesFinished = fixtureList.length > 0 && fixtureList.every(
        f => f.finished === true || f.finished === 'true'
      )

      // Combine picks with stats: one row per (pick, stats row). DGW = two rows per pick.
      const rows = []
      picks.forEach(pick => {
        const statsPlayerId = pick.player_id
        const statsKey = statsPlayerId != null ? Number(statsPlayerId) : statsPlayerId
        const statsRows = statsByPlayer[statsKey] ?? statsByPlayer[statsPlayerId] ?? statsByPlayer[String(statsPlayerId)] ?? []
        const slotPlayerInfo = playerInfoMap[pick.player_id] || {}
        const slotName = slotPlayerInfo.web_name || 'Unknown'
        const slotTeamShortName = slotPlayerInfo.teams?.short_name || null
        const multiplier = pick.multiplier || 1
        const wasAutoSubbedOut = subbedOutPlayerId != null && pick.player_id === subbedOutPlayerId

        if (statsRows.length === 0) {
          rows.push({
            position: pick.position,
            player_id: pick.player_id,
            effective_player_id: pick.player_id,
            player_name: slotName,
            player_position: slotPlayerInfo.position || 0,
            player_team_id: slotPlayerInfo.team_id || null,
            player_team_short_name: slotTeamShortName,
            is_captain: pick.is_captain,
            is_vice_captain: pick.is_vice_captain,
            multiplier,
            was_auto_subbed_in: pick.was_auto_subbed_in,
            was_auto_subbed_out: wasAutoSubbedOut,
            points: 0,
            contributedPoints: 0,
            minutes: 0,
            match_started: false,
            match_finished: false,
            match_finished_provisional: false,
            fixture_id: null,
            kickoff_time: null,
            opponent_team_id: null,
            opponent_team_short_name: null,
            was_home: false,
            goals_scored: 0,
            assists: 0,
            clean_sheets: 0,
            saves: 0,
            bps: 0,
            bonus: 0,
            bonus_status: 'provisional',
            defensive_contribution: 0,
            yellow_cards: 0,
            red_cards: 0,
            defcon_points_achieved: false,
            expected_goals: 0,
            expected_assists: 0,
            expected_goal_involvements: 0,
            expected_goals_conceded: 0,
            isDgwRow: false,
            dgwRowIndex: 0
          })
          return
        }

        const totalEffectivePoints = statsRows.reduce((sum, stats) => {
          const bonusStatus = stats.bonus_status ?? 'provisional'
          const provisionalBonus = Number(stats.provisional_bonus) || 0
          const officialBonus = Number(stats.bonus) ?? 0
          const isBonusConfirmed = bonusStatus === 'confirmed' || officialBonus > 0
          const fid = stats.fixture_id != null ? stats.fixture_id : null
          const fixture = fid != null ? (fixturesById[fid] ?? fixturesById[Number(fid)] ?? fixturesById[String(fid)]) : null
          const fixtureFinished = fixture != null && (fixture.finished === true || fixture.finished === 'true')
          const matchFinished = fixtureFinished || stats.match_finished === true || (allFixturesFinished && (stats.minutes ?? 0) > 0)
          const effectivePoints = isBonusConfirmed ? (stats.total_points || 0) : (stats.total_points || 0) + provisionalBonus
          return sum + effectivePoints
        }, 0)

        statsRows.forEach((stats, idx) => {
          const opponentTeam = stats.opponent_team_id ? opponentTeamsMap[stats.opponent_team_id] : null
          const bonusStatus = stats.bonus_status ?? 'provisional'
          const provisionalBonus = Number(stats.provisional_bonus) || 0
          const officialBonus = Number(stats.bonus) ?? 0
          const isBonusConfirmed = bonusStatus === 'confirmed' || officialBonus > 0
          const fid = stats.fixture_id != null ? stats.fixture_id : null
          const fixture = fid != null ? (fixturesById[fid] ?? fixturesById[Number(fid)] ?? fixturesById[String(fid)]) : null
          const fixtureFinished = fixture != null && (fixture.finished === true || fixture.finished === 'true')
          const matchFinished = fixtureFinished || stats.match_finished === true || (allFixturesFinished && (stats.minutes ?? 0) > 0)
          const effectivePoints = isBonusConfirmed ? (stats.total_points || 0) : (stats.total_points || 0) + provisionalBonus
          const effectiveBonus = (isBonusConfirmed || matchFinished) ? officialBonus : provisionalBonus
          rows.push({
            position: pick.position,
            player_id: pick.player_id,
            effective_player_id: pick.player_id,
            player_name: slotName,
            player_position: slotPlayerInfo.position || 0,
            player_team_id: slotPlayerInfo.team_id || null,
            player_team_short_name: slotTeamShortName,
            is_captain: pick.is_captain,
            is_vice_captain: pick.is_vice_captain,
            multiplier,
            was_auto_subbed_in: pick.was_auto_subbed_in,
            was_auto_subbed_out: wasAutoSubbedOut,
            points: effectivePoints,
            contributedPoints: idx === 0 ? totalEffectivePoints * multiplier : 0,
            minutes: stats.minutes ?? 0,
            match_started: stats.started ?? false,
            match_finished: stats.match_finished ?? false,
            match_finished_provisional: stats.match_finished_provisional ?? false,
            fixture_id: fid,
            kickoff_time: stats.kickoff_time || null,
            opponent_team_id: stats.opponent_team_id || null,
            opponent_team_short_name: opponentTeam?.short_name || null,
            was_home: stats.was_home || false,
            goals_scored: stats.goals_scored ?? 0,
            assists: stats.assists ?? 0,
            clean_sheets: stats.clean_sheets ?? 0,
            saves: stats.saves ?? 0,
            bps: stats.bps ?? 0,
            bonus: effectiveBonus,
            bonus_status: bonusStatus,
            defensive_contribution: stats.defensive_contribution ?? 0,
            yellow_cards: stats.yellow_cards ?? 0,
            red_cards: stats.red_cards ?? 0,
            defcon_points_achieved: stats.defcon_points_achieved ?? false,
            expected_goals: stats.expected_goals ?? 0,
            expected_assists: stats.expected_assists ?? 0,
            expected_goal_involvements: stats.expected_goal_involvements ?? 0,
            expected_goals_conceded: stats.expected_goals_conceded ?? 0,
            isDgwRow: statsRows.length > 1,
            dgwRowIndex: idx
          })
        })
      })

      const players = rows
  // Sort by position then by dgwRowIndex so DGW second row is right under first
  players.sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position
    return a.dgwRowIndex - b.dgwRowIndex
  })

  return players
}

/**
 * Hook to fetch current gameweek owned players (all 15) with their points and opponent info
 * Uses configured manager from context.
 */
export function useCurrentGameweekPlayers() {
  const { config } = useConfiguration()
  const { gameweek, loading: gwLoading } = useGameweekData()
  const { state: refreshState } = useRefreshState()
  const MANAGER_ID = config?.managerId || import.meta.env.VITE_MANAGER_ID || null

  const isLive = refreshState === 'live_matches' || refreshState === 'bonus_pending'
  const { data: playersData, isLoading, error } = useQuery({
    queryKey: ['current-gameweek-players', MANAGER_ID, gameweek],
    queryFn: () => fetchCurrentGameweekPlayersForManager(MANAGER_ID, gameweek),
    enabled: !!MANAGER_ID && !!gameweek && !gwLoading,
    staleTime: 30 * 1000, // Cache for 30 seconds
    refetchInterval: isLive ? 25 * 1000 : 60 * 1000, // 25s when live, 1 min otherwise
    refetchIntervalInBackground: true,
  })

  return {
    data: playersData || [],
    isLoading: isLoading || gwLoading,
    error
  }
}

/**
 * Hook to fetch current gameweek players for an arbitrary manager (e.g. for manager detail popup).
 * Only runs when managerId is provided.
 */
export function useCurrentGameweekPlayersForManager(managerId) {
  const { gameweek, loading: gwLoading } = useGameweekData()
  const { state: refreshState } = useRefreshState()

  const isLive = refreshState === 'live_matches' || refreshState === 'bonus_pending'
  const { data: playersData, isLoading, error } = useQuery({
    queryKey: ['current-gameweek-players', managerId, gameweek],
    queryFn: () => fetchCurrentGameweekPlayersForManager(managerId, gameweek),
    enabled: !!managerId && !!gameweek && !gwLoading,
    staleTime: 30 * 1000,
    refetchInterval: isLive ? 25 * 1000 : 60 * 1000,
    refetchIntervalInBackground: true,
  })

  return {
    data: playersData || [],
    isLoading: isLoading || gwLoading,
    error
  }
}
