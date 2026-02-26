import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useConfiguration } from '../contexts/ConfigurationContext'
import { useGameweekData } from './useGameweekData'

/** Convert sorted gameweeks array to contiguous streaks [[start, end], ...] */
function gameweeksToStreaks(gameweeks) {
  if (!gameweeks || gameweeks.length === 0) return []
  const sorted = [...gameweeks].sort((a, b) => a - b)
  const streaks = []
  let start = sorted[0]
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] !== sorted[i - 1] + 1) {
      streaks.push([start, sorted[i - 1]])
      start = sorted[i]
    }
  }
  streaks.push([start, sorted[sorted.length - 1]])
  return streaks
}

/** Format streaks as "1-5, 8-10" string */
function formatOwnershipPeriods(streaks) {
  if (!streaks || streaks.length === 0) return ''
  return streaks
    .map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`))
    .join(', ')
}

/** Stat keys supported for the bar chart (must match player_gameweek_stats columns for last6/last12) */
export const PLAYER_OWNED_STAT_KEYS = ['total_points', 'bps', 'goals_scored', 'assists']

/**
 * Hook to fetch player owned performance data (starting position points only)
 * Used for player performance chart visualization
 * @param {string} filter - 'all', 'last12', or 'last6' to filter by gameweeks
 * @param {string} statKey - 'total_points', 'bps', 'goals_scored', or 'assists' (only affects last6/last12; 'all' always uses total_points)
 */
export function usePlayerOwnedPerformance(filter = 'all', statKey = 'total_points') {
  const { config } = useConfiguration()
  const MANAGER_ID = config?.managerId || import.meta.env.VITE_MANAGER_ID || null
  const { gameweek } = useGameweekData()

  const { data, isLoading, error } = useQuery({
    queryKey: ['player-owned-performance', MANAGER_ID, filter, gameweek, statKey],
    queryFn: async () => {
      if (!MANAGER_ID) {
        console.log('No manager ID provided')
        return []
      }

      console.log('Fetching player owned performance for manager:', MANAGER_ID, 'filter:', filter)

      // If filtering by gameweeks, we need to query gameweek-level data
      if (filter === 'last12' || filter === 'last6') {
        if (!gameweek) {
          console.log('No gameweek available for filtering')
          return []
        }

        const gameweekCount = filter === 'last12' ? 12 : 6
        const startGameweek = Math.max(1, gameweek - gameweekCount + 1)
        // Only include gameweeks up to the current gameweek
        const gameweekRange = Array.from({ length: gameweekCount }, (_, i) => startGameweek + i)
          .filter(gw => gw <= gameweek)

        console.log('Filtering by gameweeks:', gameweekRange)

        // Query manager_picks for the filtered gameweeks
        const picksResult = await supabase
          .from('manager_picks')
          .select('player_id, gameweek, position, multiplier, is_captain, was_auto_subbed_in, auto_sub_replaced_player_id')
          .eq('manager_id', MANAGER_ID)
          .in('gameweek', gameweekRange)
          .lte('position', 11) // Starting XI only

        if (picksResult.error) {
          console.error('Error fetching filtered picks:', picksResult.error)
          throw picksResult.error
        }

        // Get all unique player IDs and gameweeks for batch fetching stats
        const allPlayerIds = new Set()
        const allGameweeks = new Set(gameweekRange)
        const picks = picksResult.data || []
        
        picks.forEach(pick => {
          allPlayerIds.add(pick.player_id)
          if (pick.auto_sub_replaced_player_id) {
            allPlayerIds.add(pick.auto_sub_replaced_player_id)
          }
        })

        // Batch fetch all player_gameweek_stats for the relevant gameweeks and players (multiple stats for chart stat selector)
        const statsResult = await supabase
          .from('player_gameweek_stats')
          .select('player_id, gameweek, total_points, bps, goals_scored, assists')
          .in('player_id', Array.from(allPlayerIds))
          .in('gameweek', Array.from(allGameweeks))

        if (statsResult.error) {
          console.error('Error fetching player stats:', statsResult.error)
          throw statsResult.error
        }

        // Map: player_id_gameweek -> { total_points, bps, goals_scored, assists }
        const statsMap = {}
        ;(statsResult.data || []).forEach(stat => {
          const key = `${stat.player_id}_${stat.gameweek}`
          statsMap[key] = {
            total_points: stat.total_points ?? 0,
            bps: stat.bps ?? 0,
            goals_scored: stat.goals_scored ?? 0,
            assists: stat.assists ?? 0,
          }
        })

        const getStat = (row, key) => (row && row[key] != null ? row[key] : 0)

        // Process picks with auto-subs: points for pointsByGameweek, and chosen stat for chart (captain multiplier only for total_points)
        const picksWithAutoSubs = picks.map((pick) => {
          let points = 0
          let statValue = 0
          let effectivePlayerId = pick.player_id
          const mult = pick.multiplier || 1

          if (pick.was_auto_subbed_in && pick.auto_sub_replaced_player_id) {
            const subKey = `${pick.auto_sub_replaced_player_id}_${pick.gameweek}`
            const row = statsMap[subKey]
            points = getStat(row, 'total_points')
            statValue = getStat(row, statKey)
            effectivePlayerId = pick.auto_sub_replaced_player_id
          } else {
            const playerKey = `${pick.player_id}_${pick.gameweek}`
            const row = statsMap[playerKey]
            points = getStat(row, 'total_points')
            statValue = getStat(row, statKey)
          }

          return {
            effective_player_id: effectivePlayerId,
            gameweek: pick.gameweek,
            points: points * mult,
            statValue: statKey === 'total_points' ? statValue * mult : statValue,
            is_captain: pick.is_captain
          }
        })

        // Aggregate points by player (for pointsByGameweek) and chosen stat by player (for chart)
        const playerPointsMap = {}
        const playerStatMap = {}
        const pointsByGameweek = {}
        for (const pick of picksWithAutoSubs) {
          const playerId = pick.effective_player_id
          if (!playerPointsMap[playerId]) {
            playerPointsMap[playerId] = {
              total_points: 0,
              gameweeks: new Set(),
              captain_weeks: 0
            }
          }
          if (!playerStatMap[playerId]) playerStatMap[playerId] = 0
          playerPointsMap[playerId].total_points += pick.points
          playerStatMap[playerId] += pick.statValue
          playerPointsMap[playerId].gameweeks.add(pick.gameweek)
          if (pick.is_captain) {
            playerPointsMap[playerId].captain_weeks += 1
          }
          if (!pointsByGameweek[playerId]) pointsByGameweek[playerId] = {}
          pointsByGameweek[playerId][pick.gameweek] = (pointsByGameweek[playerId][pick.gameweek] || 0) + pick.points
        }

        // Get player and team information
        const playerIds = Object.keys(playerPointsMap).map(Number)
        if (playerIds.length === 0) {
          return []
        }

        const playersResult = await supabase
          .from('players')
          .select('fpl_player_id, web_name, position, team_id, teams!fk_players_team(short_name)')
          .in('fpl_player_id', playerIds)

        if (playersResult.error) {
          console.error('Error fetching player info:', playersResult.error)
          throw playersResult.error
        }

        // Total of selected stat for percentage calculation
        const totalStatSum = Object.values(playerStatMap).reduce((sum, v) => sum + v, 0)

        // Build chart data: use playerStatMap for bar value (exposed as total_points for chart component)
        const chartData = (playersResult.data || [])
          .map(player => {
            const playerStats = playerPointsMap[player.fpl_player_id]
            const statSum = playerStatMap[player.fpl_player_id] ?? 0
            if (!playerStats) return null

            const gameweeksArray = Array.from(playerStats.gameweeks).sort((a, b) => a - b)
            const streaks = gameweeksToStreaks(gameweeksArray)
            return {
              player_id: player.fpl_player_id,
              player_name: player.web_name,
              total_points: statSum,
              gameweeks_owned: playerStats.gameweeks.size,
              gameweeks_array: gameweeksArray,
              ownership_periods: formatOwnershipPeriods(streaks),
              player_position: player.position,
              team_id: player.team_id,
              team_short_name: player.teams?.short_name,
              percentage_of_total_points: totalStatSum > 0
                ? Math.round((statSum / totalStatSum) * 100 * 100) / 100
                : 0
            }
          })
          .filter(Boolean)
          .sort((a, b) => (b.total_points || 0) - (a.total_points || 0))

        console.log('Filtered player performance data:', chartData, 'Count:', chartData?.length)
        return { chartData, pointsByGameweek }
      }

      // For 'all' filter, use the existing view
      // Try the extended view first
      let result = await supabase
        .from('v_player_owned_leaderboard_with_bench')
        .select('*')
        .eq('manager_id', MANAGER_ID)
        .order('total_points', { ascending: false })

      let data = result.data
      let error = result.error

      // If the extended view fails or returns no data, try the base view
      if (error || !data || data.length === 0) {
        console.warn('Extended view failed or empty, trying base view. Error:', error)
        
        // Get base view data
        const baseResult = await supabase
          .from('v_player_owned_leaderboard')
          .select('*')
          .eq('manager_id', MANAGER_ID)
          .order('total_points', { ascending: false })

        if (baseResult.error) {
          console.error('Error fetching from base view:', baseResult.error)
          throw baseResult.error
        }

        data = baseResult.data || []
        
        // If we have player IDs, fetch team information separately
        if (data.length > 0) {
          const playerIds = data.map(row => row.player_id).filter(Boolean)
          if (playerIds.length > 0) {
            const playersResult = await supabase
              .from('players')
              .select('fpl_player_id, team_id, teams!fk_players_team(short_name)')
              .in('fpl_player_id', playerIds)
            
            if (!playersResult.error && playersResult.data) {
              const teamMap = {}
              playersResult.data.forEach(p => {
                teamMap[p.fpl_player_id] = {
                  team_id: p.team_id,
                  team_short_name: p.teams?.short_name
                }
              })
              
              // Merge team info into data
              data = data.map(row => ({
                ...row,
                team_id: teamMap[row.player_id]?.team_id,
                team_short_name: teamMap[row.player_id]?.team_short_name
              }))
            }
          }
        }
      }

      if (error && !data) {
        console.error('Error fetching player owned performance:', error)
        throw error
      }

      console.log('Player owned performance data:', data, 'Count:', data?.length)
      // Debug: Check if team data is present
      if (data && data.length > 0) {
        const sampleWithTeam = data.find(d => d.team_short_name)
        const sampleWithoutTeam = data.find(d => !d.team_short_name)
        console.log('Sample with team:', sampleWithTeam)
        console.log('Sample without team:', sampleWithoutTeam)
      }

      // Transform to chart-friendly format (only starting position points)
      // gameweeks_array from Supabase may be array or need parsing
      const chartData = (data || []).map(row => {
        let gameweeksArray = row.gameweeks_array
        if (Array.isArray(gameweeksArray)) {
          gameweeksArray = gameweeksArray.slice().sort((a, b) => a - b)
        } else {
          gameweeksArray = []
        }
        return {
          player_id: row.player_id,
          player_name: row.player_name,
          total_points: row.total_points || 0,
          gameweeks_owned: row.gameweeks_owned || 0,
          gameweeks_array: gameweeksArray,
          ownership_periods: row.ownership_periods || '',
          player_position: row.player_position,
          team_id: row.team_id,
          team_short_name: row.team_short_name,
          percentage_of_total_points: row.percentage_of_total_points || 0
        }
      })

      // Build pointsByGameweek for "All" view from materialized view (single cheap query)
      let pointsByGameweek = {}
      if (chartData.length > 0) {
        const mvResult = await supabase
          .from('mv_manager_player_gameweek_points')
          .select('player_id, gameweek, points')
          .eq('manager_id', MANAGER_ID)

        if (!mvResult.error && mvResult.data?.length) {
          mvResult.data.forEach((row) => {
            const pid = row.player_id
            if (!pointsByGameweek[pid]) pointsByGameweek[pid] = {}
            pointsByGameweek[pid][row.gameweek] = (pointsByGameweek[pid][row.gameweek] || 0) + (row.points || 0)
          })
        }
      }
      
      return { chartData, pointsByGameweek }
    },
    enabled: !!MANAGER_ID && (filter === 'all' || !!gameweek),
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    refetchInterval: 5 * 60 * 1000, // Poll every 5 minutes
  })

  const playerData = Array.isArray(data) ? data : (data?.chartData ?? [])
  const pointsByGameweek = data && !Array.isArray(data) ? (data.pointsByGameweek ?? {}) : {}
  return { playerData, pointsByGameweek, loading: isLoading, error }
}
