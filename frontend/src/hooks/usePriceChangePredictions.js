import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Short-term: set VITE_PRICE_CHANGES_POLL_MS=1000 in .env to poll every second (screenshot-to-UI testing)
const POLL_MS = Number(import.meta.env.VITE_PRICE_CHANGES_POLL_MS) || 60_000

function mapRow(row) {
  return {
    playerName: row.player_name ?? 'Unknown',
    teamShortName: row.team_short_name ?? null,
    price: row.price ?? null,
  }
}

/**
 * Fetches the latest price change predictions (rises/falls) from screenshot OCR pipeline.
 * Returns rises and falls as arrays of { playerName, teamShortName, price } for display.
 */
export function usePriceChangePredictions() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['price-change-predictions'],
    queryFn: async () => {
      const { data: row, error: err } = await supabase
        .from('price_change_predictions')
        .select('id, captured_at, rises, falls')
        .order('captured_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (err) throw err
      if (!row) return { rises: [], falls: [], capturedAt: null }

      const rises = (row.rises ?? []).map(mapRow)
      const falls = (row.falls ?? []).map(mapRow)
      return {
        rises,
        falls,
        capturedAt: row.captured_at ?? null,
      }
    },
    staleTime: POLL_MS,
    refetchInterval: POLL_MS,
  })

  return {
    rises: data?.rises ?? [],
    falls: data?.falls ?? [],
    capturedAt: data?.capturedAt ?? null,
    loading: isLoading,
    error,
  }
}
