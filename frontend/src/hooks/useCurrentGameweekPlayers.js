import { useQuery } from '@tanstack/react-query'
import { useGameweekData } from './useGameweekData'
import { useConfiguration } from '../contexts/ConfigurationContext'
import { supabase } from '../lib/supabase'

/**
 * Hook to fetch current gameweek owned players (all 15) with their points and opponent info
 */
export function useCurrentGameweekPlayers() {
  const { config } = useConfiguration()
  const { gameweek, loading: gwLoading } = useGameweekData()
  const MANAGER_ID = config?.managerId || import.meta.env.VITE_MANAGER_ID || null

  const { data: playersData, isLoading, error } = useQuery({
    queryKey: ['current-gameweek-players', MANAGER_ID, gameweek],
    queryFn: async () => {
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
          total_points,
          minutes,
          opponent_team_id,
          was_home,
          goals_scored,
          assists,
          clean_sheets,
          saves,
          bps,
          bonus,
          defensive_contribution,
          yellow_cards,
          red_cards,
          defcon_points_achieved
        `)
        .eq('gameweek', gameweek)
        .in('player_id', Array.from(playerIds))

      if (statsResult.error) {
        console.error('Error fetching player stats:', statsResult.error)
        throw statsResult.error
      }

      // Create a map for quick lookup: player_id -> stats
      const statsMap = {}
      ;(statsResult.data || []).forEach(stat => {
        statsMap[stat.player_id] = stat
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
      Object.values(statsMap).forEach(stat => {
        if (stat.opponent_team_id) {
          opponentTeamIds.add(stat.opponent_team_id)
        }
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

      // Combine picks with stats and player info
      const players = picks.map(pick => {
        // Stats: always show this slot's player's actual match (minutes, opponent, points)
        // So Palmer's row shows his match (DNP vs CRY, 0); Kroupi Jr's row shows his match (66' vs LIV, 1)
        const statsPlayerId = pick.player_id
        const statsKey = statsPlayerId != null ? Number(statsPlayerId) : statsPlayerId
        const stats = statsMap[statsKey] ?? statsMap[statsPlayerId] ?? statsMap[String(statsPlayerId)] ?? {}
        const opponentTeam = stats.opponent_team_id ? opponentTeamsMap[stats.opponent_team_id] : null

        const slotPlayerInfo = playerInfoMap[pick.player_id] || {}
        const slotName = slotPlayerInfo.web_name || 'Unknown'
        const slotTeamShortName = slotPlayerInfo.teams?.short_name || null

        return {
          position: pick.position,
          player_id: pick.player_id,
          effective_player_id: pick.player_id,
          player_name: slotName,
          player_position: slotPlayerInfo.position || 0,
          player_team_id: slotPlayerInfo.team_id || null,
          player_team_short_name: slotTeamShortName,
          is_captain: pick.is_captain,
          is_vice_captain: pick.is_vice_captain,
          multiplier: pick.multiplier || 1,
          was_auto_subbed_in: pick.was_auto_subbed_in,
          was_auto_subbed_out: subbedOutPlayerId != null && pick.player_id === subbedOutPlayerId,
          points: stats.total_points || 0,
          minutes: stats.minutes ?? 0,
          opponent_team_id: stats.opponent_team_id || null,
          opponent_team_short_name: opponentTeam?.short_name || null,
          was_home: stats.was_home || false,
          goals_scored: stats.goals_scored ?? 0,
          assists: stats.assists ?? 0,
          clean_sheets: stats.clean_sheets ?? 0,
          saves: stats.saves ?? 0,
          bps: stats.bps ?? 0,
          bonus: stats.bonus ?? 0,
          defensive_contribution: stats.defensive_contribution ?? 0,
          yellow_cards: stats.yellow_cards ?? 0,
          red_cards: stats.red_cards ?? 0,
          defcon_points_achieved: stats.defcon_points_achieved ?? false
        }
      })

      // Sort by position (1-15)
      players.sort((a, b) => a.position - b.position)

      return players
    },
    enabled: !!MANAGER_ID && !!gameweek && !gwLoading,
    staleTime: 30 * 1000, // Cache for 30 seconds
    refetchInterval: 60 * 1000, // Refetch every minute during live games
  })

  return {
    data: playersData || [],
    isLoading: isLoading || gwLoading,
    error
  }
}
