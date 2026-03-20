import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { freeTransfersAtStartOfGameweek } from '../utils/freeTransfers'

/**
 * Bulk transfer allowance for all league managers:
 * - Fetches manager_gameweek_history up to current GW (transfers_made, transfer_cost, active_chip)
 * - free transfers at start of current GW = season simulation with max bank 5 (FPL 2024/25+)
 * - Remaining FT for the table = freeAtStart - freeTransfersUsedThisGameweek (see MiniLeaguePage)
 */
export function useLeagueManagerTransferAllowance(leagueManagerIds, gameweek, enabled = true) {
  const ids = useMemo(() => {
    const arr = Array.isArray(leagueManagerIds) ? leagueManagerIds : []
    return arr.map((id) => Number(id)).filter((id) => Number.isFinite(id))
  }, [leagueManagerIds])

  const { data, isLoading } = useQuery({
    queryKey: ['league-transfer-allowance', ids, gameweek],
    queryFn: async () => {
      if (!enabled)
        return { transfersMadeByManager: {}, transferCostByManager: {}, freeAtStartByManager: {} }
      if (!gameweek || ids.length === 0)
        return { transfersMadeByManager: {}, transferCostByManager: {}, freeAtStartByManager: {} }

      const res = await supabase
        .from('manager_gameweek_history')
        .select('manager_id, gameweek, transfers_made, transfer_cost, active_chip')
        .in('manager_id', ids)
        .lte('gameweek', gameweek)

      if (res.error) throw res.error

      const transfersMadeByManager = {}
      const transferCostByManager = {}
      const rowsByManager = new Map()

      for (const row of res.data || []) {
        const mid = row.manager_id != null ? Number(row.manager_id) : null
        if (mid == null) continue
        const gw = row.gameweek != null ? Number(row.gameweek) : null
        if (!Number.isFinite(gw)) continue

        if (!rowsByManager.has(mid)) rowsByManager.set(mid, [])
        rowsByManager.get(mid).push(row)

        if (gw === gameweek) {
          transfersMadeByManager[mid] = row.transfers_made ?? 0
          transferCostByManager[mid] = row.transfer_cost ?? 0
        }
      }

      const freeAtStartByManager = {}
      for (const mid of ids) {
        const rows = rowsByManager.get(mid) || []
        const priorRows = rows.filter((r) => Number(r.gameweek) < gameweek)
        freeAtStartByManager[mid] = freeTransfersAtStartOfGameweek(gameweek, priorRows)
      }

      return { transfersMadeByManager, transferCostByManager, freeAtStartByManager }
    },
    enabled: enabled && ids.length > 0 && gameweek != null,
    staleTime: 30000,
  })

  return {
    transfersMadeByManager: data?.transfersMadeByManager ?? {},
    transferCostByManager: data?.transferCostByManager ?? {},
    freeAtStartByManager: data?.freeAtStartByManager ?? {},
    loading: isLoading,
  }
}
