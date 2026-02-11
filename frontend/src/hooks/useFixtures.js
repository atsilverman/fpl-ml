import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useRefreshState } from './useRefreshState'

export function useFixtures(gameweek) {
  const { state } = useRefreshState()
  const isLive = state === 'live_matches' || state === 'bonus_pending'

  const { data: fixtures = [], isLoading, error } = useQuery({
    queryKey: ['fixtures', gameweek],
    queryFn: async () => {
      if (!gameweek) return []

      const { data, error } = await supabase
        .from('fixtures')
        .select('*')
        .eq('gameweek', gameweek)
        .order('kickoff_time', { ascending: true })

      if (error) throw error
      return data || []
    },
    enabled: !!gameweek, // Only run if we have a gameweek
    staleTime: isLive ? 10_000 : 30_000, // 10s when live so minutes/score stay current
    refetchInterval: isLive ? 12_000 : 30_000, // 12s when live, 30s otherwise
    refetchIntervalInBackground: true,
  })

  return { fixtures, loading: isLoading, error }
}
