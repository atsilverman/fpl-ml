import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export function useGameweekData() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['gameweek', 'current'],
    queryFn: async () => {
      const { data: row, error: err } = await supabase
        .from('gameweeks')
        .select('id, name, is_current, finished, data_checked, fpl_ranks_updated')
        .eq('is_current', true)
        .single()

      if (err) throw err
      return row
    },
    staleTime: 30000, // Shared data - cache for 30 seconds
    refetchInterval: 60000, // Poll every 60 seconds (automatic background refetch)
  })

  return {
    gameweek: data?.id ?? null,
    dataChecked: data?.data_checked ?? false,
    fplRanksUpdated: data?.fpl_ranks_updated ?? false,
    loading: isLoading,
    error
  }
}
