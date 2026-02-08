import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

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
 * Fetches actual price changes grouped by snapshot date for daily bentos.
 * Uses player_price_changes_by_date view. Returns one entry per date with rises/falls.
 */
export function usePlayerPriceChangesByDate() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['player-price-changes-by-date'],
    queryFn: async () => {
      const { data: rows, error: err } = await supabase
        .from('player_price_changes_by_date')
        .select('recorded_date, prior_price_tenths, price_tenths, change_tenths, is_rise, web_name, team_short_name')
        .order('recorded_date', { ascending: false })

      if (err) throw err
      const list = rows ?? []

      const byDate = new Map()
      for (const r of list) {
        const date = r.recorded_date
        if (!byDate.has(date)) {
          byDate.set(date, { date, rises: [], falls: [] })
        }
        const entry = byDate.get(date)
        const mapped = mapRow(r)
        if (r.is_rise) {
          entry.rises.push(mapped)
        } else {
          entry.falls.push(mapped)
        }
      }

      const byDateList = Array.from(byDate.values()).sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      )

      return { byDate: byDateList }
    },
    staleTime: REFETCH_MS,
    refetchInterval: REFETCH_MS,
  })

  return {
    byDate: data?.byDate ?? [],
    loading: isLoading,
    error,
  }
}
