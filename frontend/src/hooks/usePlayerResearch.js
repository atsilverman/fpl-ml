import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export function usePlayerResearch(gameweek) {
  const { data: players = [], isLoading, error } = useQuery({
    queryKey: ['playerResearch', gameweek],
    queryFn: async () => {
      if (!gameweek) return []

      const { data, error } = await supabase
        .from('mv_player_gameweek_performance')
        .select(`
          *,
          player:players(fpl_player_id, web_name, position, team_id)
        `)
        .eq('gameweek', gameweek)
        .order('total_points', { ascending: false })
        .limit(100)

      if (error) throw error
      return data || []
    },
    enabled: !!gameweek, // Only run if we have a gameweek
    staleTime: 30000, // Shared data - cache for 30 seconds
    refetchInterval: 30000, // Poll every 30 seconds (automatic background refetch)
  })

  return { players, loading: isLoading, error }
}
