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
        .lte('position', 11)

      if (err) throw err

      const ids = (data || []).map((r) => r.manager_id)
      return [...new Set(ids)]
    },
    enabled: playerId != null && !!gameweek,
    staleTime: 60000
  })

  return { managerIdsOwningPlayer: managerIds, loading: isLoading, error }
}

/**
 * Returns manager_ids that own at least one of the given players in the given gameweek.
 * Used to filter league standings when multiple players are selected.
 * leagueManagerIds: when provided, only counts managers in this list (current league).
 */
export function useLeaguePlayerOwnershipMultiple(playerIds, gameweek, leagueManagerIds = null) {
  const ids = Array.isArray(playerIds) ? playerIds.filter((id) => id != null) : []
  const leagueIds = Array.isArray(leagueManagerIds) ? leagueManagerIds : []
  const enabled = ids.length > 0 && !!gameweek && (leagueManagerIds == null || leagueIds.length > 0)

  const { data: managerIds = [], isLoading, error } = useQuery({
    queryKey: ['league-player-ownership-multiple', ids.slice().sort((a, b) => a - b), gameweek, leagueIds.length ? leagueIds.slice().sort((a, b) => Number(a) - Number(b)) : null],
    queryFn: async () => {
      if (!enabled) return []

      let query = supabase
        .from('manager_picks')
        .select('manager_id')
        .in('player_id', ids)
        .eq('gameweek', gameweek)
        .lte('position', 11)
      if (leagueIds.length > 0) {
        query = query.in('manager_id', leagueIds)
      }
      const { data, error: err } = await query

      if (err) throw err

      const unique = [...new Set((data || []).map((r) => r.manager_id))]
      return unique
    },
    enabled,
    staleTime: 60000
  })

  return { managerIdsOwningAny: managerIds, loading: isLoading, error }
}
