import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Poll every 2 min so the list refreshes automatically after the deadline window writes new snapshot
const REFETCH_MS = 2 * 60 * 1000

function formatPriceTenths(tenths) {
  if (tenths == null) return null
  return `£${(tenths / 10).toFixed(1)}`
}

function mapRow(row) {
  return {
    playerName: row.web_name ?? 'Unknown',
    teamShortName: row.team_short_name ?? null,
    price: formatPriceTenths(row.price_tenths),
    priorPrice: formatPriceTenths(row.prior_price_tenths),
    changeTenths: row.change_tenths ?? 0,
  }
}

/**
 * Fetches actual price changes (rises/falls) from the latest post-deadline snapshot.
 * Uses player_price_changes_latest view. Auto-refreshes so the list updates after the deadline window.
 */
export function usePlayerPriceChangesLatest() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['player-price-changes-latest'],
    queryFn: async () => {
      const { data: rows, error: err } = await supabase
        .from('player_price_changes_latest')
        .select('recorded_date, recorded_at, prior_price_tenths, price_tenths, change_tenths, is_rise, web_name, team_short_name')
        .order('change_tenths', { ascending: false })

      if (err) throw err
      const list = rows ?? []
      const snapshotDate = list.length > 0 ? list[0].recorded_date : null
      const rises = list.filter((r) => r.is_rise === true).map(mapRow)
      const falls = list.filter((r) => r.is_rise === false).map(mapRow)

      return {
        rises,
        falls,
        snapshotDate,
        recordedAt: list.length > 0 ? list[0].recorded_at : null,
      }
    },
    staleTime: REFETCH_MS,
    refetchInterval: REFETCH_MS,
  })

  return {
    rises: data?.rises ?? [],
    falls: data?.falls ?? [],
    snapshotDate: data?.snapshotDate ?? null,
    recordedAt: data?.recordedAt ?? null,
    loading: isLoading,
    error,
  }
}
