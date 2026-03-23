import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

/**
 * Overall rank history for arbitrary league manager IDs (for compare lines on the performance chart).
 * Returns a plain object: managerId (number) -> [{ gameweek, overallRank, chip }].
 */
export function useLeagueManagersRankHistory(managerIds) {
  const sortedIds = useMemo(
    () => [...new Set((managerIds || []).map((id) => Number(id)).filter((n) => Number.isFinite(n) && n > 0))].sort((a, b) => a - b),
    [managerIds]
  )

  const { data: historyByManagerId = {}, isLoading, error } = useQuery({
    queryKey: ['league-managers-rank-history', sortedIds.join(',')],
    queryFn: async () => {
      if (sortedIds.length === 0) return {}

      const { data, error: qError } = await supabase
        .from('manager_gameweek_history')
        .select('manager_id, gameweek, overall_rank, active_chip')
        .in('manager_id', sortedIds)
        .not('overall_rank', 'is', null)
        .order('gameweek', { ascending: true })

      if (qError) throw qError

      /** @type {Record<number, Array<{ gameweek: number, overallRank: number, chip: string | null }>>} */
      const out = {}
      for (const id of sortedIds) {
        out[id] = []
      }
      for (const row of data || []) {
        const mid = Number(row.manager_id)
        if (!out[mid]) continue
        out[mid].push({
          gameweek: row.gameweek,
          overallRank: row.overall_rank,
          chip: row.active_chip || null,
        })
      }
      return out
    },
    enabled: sortedIds.length > 0,
    staleTime: 60000,
    refetchInterval: 60000,
  })

  return { historyByManagerId, loading: isLoading, error }
}
