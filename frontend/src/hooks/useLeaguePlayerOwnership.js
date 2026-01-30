import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

/**
 * Returns manager_ids that own the given player in the given gameweek
 * (from manager_picks). Used to filter league standings to "managers who own this player".
 */
export function useLeaguePlayerOwnership(playerId, gameweek) {
  const { data: managerIds = [], isLoading, error } = useQuery({
    queryKey: ['league-player-ownership', playerId, gameweek],
    queryFn: async () => {
      if (playerId == null || !gameweek) return []

      const { data, error: err } = await supabase
        .from('manager_picks')
        .select('manager_id')
        .eq('player_id', playerId)
        .eq('gameweek', gameweek)

      if (err) throw err

      const ids = (data || []).map((r) => r.manager_id)
      return [...new Set(ids)]
    },
    enabled: playerId != null && !!gameweek,
    staleTime: 60000
  })

  return { managerIdsOwningPlayer: managerIds, loading: isLoading, error }
}
