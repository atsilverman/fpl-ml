import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export function useGameweekData() {
  const { data: gameweek, isLoading, error } = useQuery({
    queryKey: ['gameweek', 'current'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gameweeks')
        .select('id, name, is_current, finished, data_checked')
        .eq('is_current', true)
        .single()

      if (error) throw error
      return data?.id || null
    },
    staleTime: 30000, // Shared data - cache for 30 seconds
    refetchInterval: 60000, // Poll every 60 seconds (automatic background refetch)
  })

  return { gameweek, loading: isLoading, error }
}
