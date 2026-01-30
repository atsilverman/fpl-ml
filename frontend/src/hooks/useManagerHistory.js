import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useConfiguration } from '../contexts/ConfigurationContext'

/**
 * Hook to fetch all historical gameweek data for a manager
 * Used for performance chart visualization
 */
export function useManagerHistory() {
  const { config } = useConfiguration()
  const MANAGER_ID = config?.managerId || import.meta.env.VITE_MANAGER_ID || null

  const { data: historyData, isLoading, error } = useQuery({
    queryKey: ['manager-history', MANAGER_ID],
    queryFn: async () => {
      if (!MANAGER_ID) return null

      const { data, error } = await supabase
        .from('manager_gameweek_history')
        .select('gameweek, overall_rank, active_chip')
        .eq('manager_id', MANAGER_ID)
        .order('gameweek', { ascending: true })

      if (error) {
        throw error
      }

      // Transform to chart-friendly format
      // Filter out rows with null overall_rank
      const chartData = (data || [])
        .filter(row => row.overall_rank != null) // Only include rows with valid ranks
        .map(row => ({
          gameweek: row.gameweek,
          overallRank: row.overall_rank,
          chip: row.active_chip || null
        }))
      
      return chartData
    },
    enabled: !!MANAGER_ID,
    staleTime: 60000, // Cache for 1 minute
    refetchInterval: 60000, // Poll every minute
  })

  return { historyData, loading: isLoading, error }
}
