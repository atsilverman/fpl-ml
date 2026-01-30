import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useConfiguration } from '../contexts/ConfigurationContext'
import { useGameweekData } from './useGameweekData'

/**
 * Hook to fetch player owned performance data (starting position points only)
 * Used for player performance chart visualization
 * @param {string} filter - 'all', 'last12', or 'last6' to filter by gameweeks
 */
export function usePlayerOwnedPerformance(filter = 'all') {
  const { config } = useConfiguration()
  const MANAGER_ID = config?.managerId || import.meta.env.VITE_MANAGER_ID || null
  const { gameweek } = useGameweekData()

  const { data: playerData, isLoading, error } = useQuery({
    queryKey: ['player-owned-performance', MANAGER_ID, filter, gameweek],
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

        // Batch fetch all player_gameweek_stats for the relevant gameweeks and players
        const statsResult = await supabase
          .from('player_gameweek_stats')
          .select('player_id, gameweek, total_points')
          .in('player_id', Array.from(allPlayerIds))
          .in('gameweek', Array.from(allGameweeks))

        if (statsResult.error) {
          console.error('Error fetching player stats:', statsResult.error)
          throw statsResult.error
        }

        // Create a map for quick lookup: player_id + gameweek -> points
        const statsMap = {}
        ;(statsResult.data || []).forEach(stat => {
          const key = `${stat.player_id}_${stat.gameweek}`
          statsMap[key] = stat.total_points || 0
        })

        // Process picks with auto-subs and calculate points
        const picksWithAutoSubs = picks.map((pick) => {
          let points = 0
          let effectivePlayerId = pick.player_id

          if (pick.was_auto_subbed_in && pick.auto_sub_replaced_player_id) {
            // Get substitute player's points
            const subKey = `${pick.auto_sub_replaced_player_id}_${pick.gameweek}`
            points = statsMap[subKey] || 0
            effectivePlayerId = pick.auto_sub_replaced_player_id
          } else {
            // Use original player's points
            const playerKey = `${pick.player_id}_${pick.gameweek}`
            points = statsMap[playerKey] || 0
          }

          return {
            effective_player_id: effectivePlayerId,
            gameweek: pick.gameweek,
            points: points * (pick.multiplier || 1),
            is_captain: pick.is_captain
          }
        })

        // Aggregate points by player
        const playerPointsMap = {}
        for (const pick of picksWithAutoSubs) {
          const playerId = pick.effective_player_id
          if (!playerPointsMap[playerId]) {
            playerPointsMap[playerId] = {
              total_points: 0,
              gameweeks: new Set(),
              captain_weeks: 0
            }
          }
          playerPointsMap[playerId].total_points += pick.points
          playerPointsMap[playerId].gameweeks.add(pick.gameweek)
          if (pick.is_captain) {
            playerPointsMap[playerId].captain_weeks += 1
          }
        }

        // Get player and team information
        const playerIds = Object.keys(playerPointsMap).map(Number)
        if (playerIds.length === 0) {
          return []
        }

        const playersResult = await supabase
          .from('players')
          .select('fpl_player_id, web_name, position, team_id, teams(short_name)')
          .in('fpl_player_id', playerIds)

        if (playersResult.error) {
          console.error('Error fetching player info:', playersResult.error)
          throw playersResult.error
        }

        // Calculate total points for percentage calculation
        const totalFilteredPoints = Object.values(playerPointsMap).reduce(
          (sum, player) => sum + player.total_points,
          0
        )

        // Build chart data
        const chartData = (playersResult.data || [])
          .map(player => {
            const playerStats = playerPointsMap[player.fpl_player_id]
            if (!playerStats) return null

            const gameweeksArray = Array.from(playerStats.gameweeks).sort((a, b) => a - b)
            
            return {
              player_id: player.fpl_player_id,
              player_name: player.web_name,
              total_points: playerStats.total_points,
              gameweeks_owned: playerStats.gameweeks.size,
              ownership_periods: gameweeksArray.length > 0 
                ? gameweeksArray.length === 1 
                  ? `${gameweeksArray[0]}`
                  : `${gameweeksArray[0]}-${gameweeksArray[gameweeksArray.length - 1]}`
                : '',
              player_position: player.position,
              team_id: player.team_id,
              team_short_name: player.teams?.short_name,
              percentage_of_total_points: totalFilteredPoints > 0
                ? Math.round((playerStats.total_points / totalFilteredPoints) * 100 * 100) / 100
                : 0
            }
          })
          .filter(Boolean)
          .sort((a, b) => (b.total_points || 0) - (a.total_points || 0))

        console.log('Filtered player performance data:', chartData, 'Count:', chartData?.length)
        return chartData
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
              .select('fpl_player_id, team_id, teams(short_name)')
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
      const chartData = (data || []).map(row => ({
        player_id: row.player_id,
        player_name: row.player_name,
        total_points: row.total_points || 0,  // Starting position points only
        gameweeks_owned: row.gameweeks_owned || 0,
        ownership_periods: row.ownership_periods || '',
        player_position: row.player_position,
        team_id: row.team_id,
        team_short_name: row.team_short_name,
        percentage_of_total_points: row.percentage_of_total_points || 0
      }))
      
      return chartData
    },
    enabled: !!MANAGER_ID && (filter === 'all' || !!gameweek),
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    refetchInterval: 5 * 60 * 1000, // Poll every 5 minutes
  })

  return { playerData, loading: isLoading, error }
}
