import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useConfiguration } from '../contexts/ConfigurationContext'

/**
 * Hook to fetch all historical team value data for a manager
 * Used for team value chart visualization
 */
export function useTeamValueHistory() {
  const { config } = useConfiguration()
  const MANAGER_ID = config?.managerId || import.meta.env.VITE_MANAGER_ID || null

  const { data: historyData, isLoading, error } = useQuery({
    queryKey: ['team-value-history', MANAGER_ID],
    queryFn: async () => {
      if (!MANAGER_ID) return null

      const { data, error } = await supabase
        .from('manager_gameweek_history')
        .select('gameweek, team_value_tenths, bank_tenths')
        .eq('manager_id', MANAGER_ID)
        .order('gameweek', { ascending: true })

      if (error) {
        throw error
      }

      // Transform to chart-friendly format
      // Filter out rows with null team_value_tenths
      // Convert from tenths to millions (divide by 10)
      const chartData = (data || [])
        .filter(row => row.team_value_tenths != null) // Only include rows with valid team value
        .map(row => ({
          gameweek: row.gameweek,
          teamValue: row.team_value_tenths / 10, // Convert from tenths to millions
          bankValue: row.bank_tenths != null ? row.bank_tenths / 10 : null
        }))
      
      return chartData
    },
    enabled: !!MANAGER_ID,
    staleTime: 60000, // Cache for 1 minute
    refetchInterval: 60000, // Poll every minute
  })

  return { historyData, loading: isLoading, error }
}
