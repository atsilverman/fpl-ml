import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

/**
 * Bulk transfer allowance inputs for all league managers:
 * - current GW: transfers_made + transfer_cost
 * - previous GW: transfers_made
 *
 * Remaining FT is derived client-side using the same logic as `useManagerDataForManager`
 * (FT carry depends on whether a free-transfers chip was used).
 */
export function useLeagueManagerTransferAllowance(leagueManagerIds, gameweek, enabled = true) {
  const ids = useMemo(() => {
    const arr = Array.isArray(leagueManagerIds) ? leagueManagerIds : []
    return arr.map((id) => Number(id)).filter((id) => Number.isFinite(id))
  }, [leagueManagerIds])

  const prevGameweek = gameweek != null ? gameweek - 1 : null

  const { data, isLoading } = useQuery({
    queryKey: ['league-transfer-allowance', ids, gameweek],
    queryFn: async () => {
      if (!enabled) return { transfersMadeByManager: {}, transferCostByManager: {}, prevTransfersMadeByManager: {} }
      if (!gameweek || ids.length === 0) return { transfersMadeByManager: {}, transferCostByManager: {}, prevTransfersMadeByManager: {} }

      const [currRes, prevRes] = await Promise.all([
        supabase
          .from('mv_manager_gameweek_summary')
          .select('manager_id, transfers_made, transfer_cost')
          .eq('gameweek', gameweek)
          .in('manager_id', ids),
        supabase
          .from('mv_manager_gameweek_summary')
          .select('manager_id, transfers_made')
          .eq('gameweek', prevGameweek)
          .in('manager_id', ids),
      ])

      if (currRes.error) throw currRes.error
      if (prevRes.error) throw prevRes.error

      const transfersMadeByManager = {}
      const transferCostByManager = {}
      ;(currRes.data || []).forEach((row) => {
        const mid = row.manager_id != null ? Number(row.manager_id) : null
        if (mid == null) return
        transfersMadeByManager[mid] = row.transfers_made ?? 0
        transferCostByManager[mid] = row.transfer_cost ?? 0
      })

      const prevTransfersMadeByManager = {}
      ;(prevRes.data || []).forEach((row) => {
        const mid = row.manager_id != null ? Number(row.manager_id) : null
        if (mid == null) return
        prevTransfersMadeByManager[mid] = row.transfers_made ?? 0
      })

      return { transfersMadeByManager, transferCostByManager, prevTransfersMadeByManager }
    },
    enabled: enabled && ids.length > 0 && gameweek != null,
    staleTime: 30000,
  })

  return {
    transfersMadeByManager: data?.transfersMadeByManager ?? {},
    transferCostByManager: data?.transferCostByManager ?? {},
    prevTransfersMadeByManager: data?.prevTransfersMadeByManager ?? {},
    loading: isLoading,
  }
}

