import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useRefreshState } from './useRefreshState'
import { logRefreshFetchDuration } from '../utils/logRefreshFetchDuration'

/**
 * @param anchor - 'current' = gameweek with is_current (this GW); 'next' = gameweek with is_next (upcoming GW). Default 'current'.
 */
export function useGameweekData(anchor = 'current') {
  const isNext = anchor === 'next'
  const { state } = useRefreshState()
  const { data, isLoading, error } = useQuery({
    queryKey: ['gameweek', anchor],
    queryFn: async () => {
      const start = performance.now()
      const { data: row, error: err } = await supabase
        .from('gameweeks')
        .select('id, name, is_current, finished, data_checked, fpl_ranks_updated, release_time')
        .eq(isNext ? 'is_next' : 'is_current', true)
        .single()

      if (err) throw err
      if (anchor === 'current') logRefreshFetchDuration('Gameweeks', performance.now() - start, state)
      return row
    },
    staleTime: 15000, // 15s when live so GW state stays current
    refetchInterval: 20000, // 20s - backend fast loop is 10s when live
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
