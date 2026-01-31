import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

/**
 * Returns the maximum BPS in the gameweek (across all players).
 * Used to scale BPS bar charts so all fixtures use the same scale.
 */
export function useGameweekMaxBps(gameweek) {
  const { data: maxBps, isLoading } = useQuery({
    queryKey: ['gameweek-max-bps', gameweek],
    queryFn: async () => {
      if (!gameweek) return null
      const { data, error } = await supabase
        .from('player_gameweek_stats')
        .select('bps')
        .eq('gameweek', gameweek)
        .order('bps', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data?.bps ?? null
    },
    enabled: !!gameweek,
    staleTime: 60000,
  })
  return { maxBps: maxBps ?? null, loading: isLoading }
}
