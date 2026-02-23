import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

const PHASE_SOURCES = [
  'gameweeks',
  'fixtures',
  'gw_players',
  'live_standings',
  'manager_points',
  'mvs',
]

/** Human-readable label for refresh_duration_log source */
export const PHASE_SOURCE_LABELS = {
  gameweeks: 'Gameweeks',
  fixtures: 'Fixtures',
  gw_players: 'GW Players',
  live_standings: 'Live standings',
  manager_points: 'Manager points',
  mvs: 'MVs',
}

/**
 * Fetches latest backend phase timestamps from refresh_duration_log.
 * Used by Updates (debug) to show per-phase "Since backend" and duration (identify slow phases).
 * Falls back gracefully if table is not readable (e.g. RLS).
 */
export function useRefreshPhaseTimestamps(options = {}) {
  const refetchInterval = options.refetchInterval ?? 10_000
  const { data: rawRows = [], isSuccess, error } = useQuery({
    queryKey: ['refresh-duration-log'],
    queryFn: async () => {
      const { data, error: err } = await supabase
        .from('refresh_duration_log')
        .select('source, occurred_at, path, duration_ms')
        .order('occurred_at', { ascending: false })
        .limit(200)
      if (err) throw err
      return data ?? []
    },
    staleTime: 5_000,
    refetchInterval,
    retry: 1,
  })

  // Latest row per source (rawRows are ordered occurred_at desc)
  const phases = {}
  for (const row of rawRows) {
    const src = row?.source
    if (!src || !PHASE_SOURCES.includes(src)) continue
    if (!phases[src]) {
      phases[src] = {
        occurred_at: row.occurred_at,
        path: row.path,
        duration_ms: row.duration_ms,
      }
    }
  }
  const mvsAt = phases.mvs?.occurred_at ? new Date(phases.mvs.occurred_at).getTime() : null

  return {
    phases,
    mvsAt,
    available: isSuccess && !error && rawRows.length > 0,
  }
}
