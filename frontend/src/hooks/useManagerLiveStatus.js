import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

/**
 * Fetches left_to_play and in_play for a single manager and gameweek.
 * Used to show "live updating" indicator when the configured manager has players in play.
 */
export function useManagerLiveStatus(managerId, gameweek) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['manager-live-status', managerId, gameweek],
    queryFn: async () => {
      if (managerId == null || gameweek == null) return null

      const { data: rows, error: e } = await supabase
        .from('manager_live_status')
        .select('left_to_play, in_play')
        .eq('manager_id', managerId)
        .eq('gameweek', gameweek)
        .maybeSingle()

      if (e) throw e
      return rows
    },
    enabled: managerId != null && gameweek != null,
    staleTime: 30000,
    refetchInterval: 30000
  })

  return {
    inPlay: data?.in_play ?? 0,
    leftToPlay: data?.left_to_play ?? 0,
    loading: isLoading,
    error
  }
}
