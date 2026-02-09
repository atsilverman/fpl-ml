import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Poll for latest predictions (updated every 30 min by backend scraper)
const POLL_MS = Number(import.meta.env.VITE_PRICE_CHANGES_POLL_MS) || 60_000

/** Collapse duplicate or "FullName ShortName" / "Andrey Santos Andrey S" into a single display name. */
function dedupePlayerName(name) {
  if (!name || typeof name !== 'string') return name ?? 'Unknown'
  const trimmed = name.trim()
  const parts = trimmed.split(/\s+/)
  if (parts.length >= 3 && parts[0] === parts[2]) {
    return `${parts[0]} ${parts[1]}`
  }
  if (parts.length === 2) {
    const [a, b] = parts
    if (a === b) return a
    if (a.startsWith(b) || b.startsWith(a)) return a.length >= b.length ? a : b
  }
  const seen = []
  for (const p of parts) {
    if (seen.length && seen[seen.length - 1] === p) continue
    seen.push(p)
  }
  return seen.join(' ').trim() || trimmed
}

function mapRow(row) {
  return {
    playerName: dedupePlayerName(row.player_name) ?? 'Unknown',
    teamShortName: row.team_short_name ?? null,
    price: row.price ?? null,
  }
}

/**
 * Fetches the latest price change predictions (rises/falls) from LiveFPL scraper (and optional screenshot pipeline).
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
      if (!row) return { rises: [], falls: [], capturedAt: null, hasLatestRow: false }

      const rises = (row.rises ?? []).map(mapRow)
      const falls = (row.falls ?? []).map(mapRow)
      return {
        rises,
        falls,
        capturedAt: row.captured_at ?? null,
        hasLatestRow: true,
      }
    },
    staleTime: POLL_MS,
    refetchInterval: POLL_MS,
  })

  return {
    rises: data?.rises ?? [],
    falls: data?.falls ?? [],
    capturedAt: data?.capturedAt ?? null,
    hasLatestRow: data?.hasLatestRow ?? false,
    loading: isLoading,
    error,
  }
}
