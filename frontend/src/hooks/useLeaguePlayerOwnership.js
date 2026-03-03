import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

/**
 * Returns manager_ids that own the given player in the given gameweek (from manager_picks).
 * - managerIdsStartingPlayer: managers with player in starting XI (position 1–11)
 * - managerIdsOwningPlayerBench: managers with player on bench only (position 12–15)
 */
export function useLeaguePlayerOwnership(playerId, gameweek) {
  const { data: rows = [], isLoading, error } = useQuery({
    queryKey: ['league-player-ownership', playerId, gameweek],
    queryFn: async () => {
      if (playerId == null || !gameweek) return []

      const { data, error: err } = await supabase
        .from('manager_picks')
        .select('manager_id, position')
        .eq('player_id', playerId)
        .eq('gameweek', gameweek)

      if (err) throw err

      return data || []
    },
    enabled: playerId != null && !!gameweek,
    staleTime: 60000
  })

  const { managerIdsStartingPlayer, managerIdsOwningPlayerBench } = useMemo(() => {
    const starters = []
    const bench = []
    for (const r of rows) {
      const pos = r.position != null ? Number(r.position) : 0
      if (pos <= 11) starters.push(r.manager_id)
      else bench.push(r.manager_id)
    }
    return {
      managerIdsStartingPlayer: [...new Set(starters)],
      managerIdsOwningPlayerBench: [...new Set(bench)]
    }
  }, [rows])

  return {
    managerIdsStartingPlayer,
    managerIdsOwningPlayerBench,
    managerIdsOwningPlayer: [...new Set([...managerIdsStartingPlayer, ...managerIdsOwningPlayerBench])],
    loading: isLoading,
    error
  }
}

/**
 * Returns manager_ids that own all of the given players in the given gameweek (AND).
 * Used to filter league standings when multiple players are selected.
 * leagueManagerIds: when provided, only counts managers in this list (current league).
 */
export function useLeaguePlayerOwnershipMultiple(playerIds, gameweek, leagueManagerIds = null) {
  const ids = Array.isArray(playerIds) ? playerIds.filter((id) => id != null) : []
  const leagueIds = Array.isArray(leagueManagerIds) ? leagueManagerIds : []
  const enabled = ids.length > 0 && !!gameweek && (leagueManagerIds == null || leagueIds.length > 0)
  const idSet = new Set(ids)

  const { data: managerIds = [], isLoading, error } = useQuery({
    queryKey: ['league-player-ownership-multiple', ids.slice().sort((a, b) => a - b), gameweek, leagueIds.length ? leagueIds.slice().sort((a, b) => Number(a) - Number(b)) : null],
    queryFn: async () => {
      if (!enabled) return []

      let query = supabase
        .from('manager_picks')
        .select('manager_id, player_id')
        .in('player_id', ids)
        .eq('gameweek', gameweek)
      if (leagueIds.length > 0) {
        query = query.in('manager_id', leagueIds)
      }
      const { data, error: err } = await query

      if (err) throw err

      const byManager = new Map()
      for (const r of data || []) {
        if (!byManager.has(r.manager_id)) byManager.set(r.manager_id, new Set())
        byManager.get(r.manager_id).add(r.player_id)
      }
      const result = []
      for (const [managerId, playerSet] of byManager.entries()) {
        if (playerSet.size !== idSet.size) continue
        let hasAll = true
        for (const pid of idSet) {
          if (!playerSet.has(pid)) {
            hasAll = false
            break
          }
        }
        if (hasAll) result.push(managerId)
      }
      return result
    },
    enabled,
    staleTime: 60000
  })

  return { managerIdsOwningAny: managerIds, loading: isLoading, error }
}
