import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

/**
 * @param anchor - 'current' = gameweek with is_current (this GW); 'next' = gameweek with is_next (upcoming GW). Default 'current'.
 */
export function useGameweekData(anchor = 'current') {
  const isNext = anchor === 'next'
  const { data, isLoading, error } = useQuery({
    queryKey: ['gameweek', anchor],
    queryFn: async () => {
      const { data: row, error: err } = await supabase
        .from('gameweeks')
        .select('id, name, is_current, finished, data_checked, fpl_ranks_updated, release_time')
        .eq(isNext ? 'is_next' : 'is_current', true)
        .single()

      if (err) throw err
      return row
    },
    staleTime: 30000, // Shared data - cache for 30 seconds
    refetchInterval: 60000, // Poll every 60 seconds (automatic background refetch)
  })

  return {
    gameweek: data?.id ?? null,
    isCurrent: data?.is_current ?? false,
    dataChecked: data?.data_checked ?? false,
    fplRanksUpdated: data?.fpl_ranks_updated ?? false,
    releaseTime: data?.release_time ?? null,
    loading: isLoading,
    error
  }
}
