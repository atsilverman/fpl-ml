import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export function useFixtures(gameweek) {
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
    staleTime: 30000, // Shared data - cache for 30 seconds
    refetchInterval: 30000, // Poll every 30 seconds (automatic background refetch)
    refetchIntervalInBackground: true,
  })

  return { fixtures, loading: isLoading, error }
}
