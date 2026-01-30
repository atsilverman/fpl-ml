import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export function usePlayerStats(playerId, gameweek) {
  const { data: stats, isLoading, error } = useQuery({
    queryKey: ['playerStats', playerId, gameweek],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('player_gameweek_stats')
        .select('*')
        .eq('player_id', playerId)
        .eq('gameweek', gameweek)
        .single()

      if (error) throw error
      return data
    },
    enabled: !!playerId && !!gameweek, // Only run if we have both playerId and gameweek
    staleTime: 30000, // Shared data - cache for 30 seconds
  })

  return { stats, loading: isLoading, error }
}
