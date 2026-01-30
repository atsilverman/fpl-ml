import { useQuery } from '@tanstack/react-query'
import { useGameweekData } from './useGameweekData'
import { supabase } from '../lib/supabase'

/**
 * Returns the set of player_id that are top 10 scorers in the given gameweek (whole gameweek, all players).
 */
export function useGameweekTopScorers() {
  const { gameweek, loading: gwLoading } = useGameweekData()

  const { data: topScorerIds, isLoading } = useQuery({
    queryKey: ['gameweek-top-scorers', gameweek],
    queryFn: async () => {
      if (!gameweek) return new Set()

      const { data, error } = await supabase
        .from('player_gameweek_stats')
        .select('player_id')
        .eq('gameweek', gameweek)
        .order('total_points', { ascending: false })
        .limit(10)

      if (error) {
        console.error('Error fetching gameweek top scorers:', error)
        return new Set()
      }

      return new Set((data || []).map((row) => row.player_id))
    },
    enabled: !!gameweek && !gwLoading,
    staleTime: 60 * 1000,
  })

  return {
    topScorerPlayerIds: topScorerIds ?? new Set(),
    isLoading: isLoading || gwLoading,
  }
}
