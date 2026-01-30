import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useConfiguration } from '../contexts/ConfigurationContext'

/**
 * Hook to fetch team value history for all managers in the configured league
 * Used for comparison lines in team value chart
 */
export function useLeagueTeamValueHistory() {
  const { config } = useConfiguration()
  const LEAGUE_ID = config?.leagueId || import.meta.env.VITE_LEAGUE_ID || null

  const { data: leagueData, isLoading, error } = useQuery({
    queryKey: ['league-team-value-history', LEAGUE_ID],
    queryFn: async () => {
      if (!LEAGUE_ID) return null

      // First, get all manager IDs in the league
      const { data: leagueManagers, error: leagueError } = await supabase
        .from('mini_league_managers')
        .select('manager_id')
        .eq('league_id', LEAGUE_ID)

      if (leagueError) {
        throw leagueError
      }

      if (!leagueManagers || leagueManagers.length === 0) {
        return []
      }

      const managerIds = leagueManagers.map(m => m.manager_id)

      // Get manager names
      const { data: managers, error: managersError } = await supabase
        .from('managers')
        .select('manager_id, manager_name')
        .in('manager_id', managerIds)

      if (managersError) {
        throw managersError
      }

      const managerNamesMap = new Map(
        (managers || []).map(m => [m.manager_id, m.manager_name || `Manager ${m.manager_id}`])
      )

      // Get team value history for all managers
      const { data: historyData, error: historyError } = await supabase
        .from('manager_gameweek_history')
        .select('manager_id, gameweek, team_value_tenths')
        .in('manager_id', managerIds)
        .not('team_value_tenths', 'is', null)
        .order('manager_id', { ascending: true })
        .order('gameweek', { ascending: true })

      if (historyError) {
        throw historyError
      }

      // Group by manager
      const groupedByManager = new Map()

      for (const row of historyData || []) {
        if (!groupedByManager.has(row.manager_id)) {
          groupedByManager.set(row.manager_id, {
            managerId: row.manager_id,
            managerName: managerNamesMap.get(row.manager_id) || `Manager ${row.manager_id}`,
            data: []
          })
        }

        groupedByManager.get(row.manager_id).data.push({
          gameweek: row.gameweek,
          teamValue: row.team_value_tenths / 10 // Convert from tenths to millions
        })
      }

      // Convert map to array and sort by manager ID
      return Array.from(groupedByManager.values()).sort((a, b) => a.managerId - b.managerId)
    },
    enabled: !!LEAGUE_ID,
    staleTime: 60000, // Cache for 1 minute
    refetchInterval: 60000, // Poll every minute
  })

  return { leagueData, loading: isLoading, error }
}
