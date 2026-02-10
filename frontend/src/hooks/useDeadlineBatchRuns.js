import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

const PHASE_LABELS = {
  bootstrap_check_sec: 'Bootstrap check',
  settle_sec: 'Settle',
  picks_and_transfers_sec: 'Picks + transfers',
  history_refresh_sec: 'History refresh',
  baselines_sec: 'Baselines',
  whitelist_sec: 'Whitelist',
  transfer_aggregation_sec: 'Transfer aggregation',
  materialized_views_sec: 'Materialized views',
}

/**
 * Fetches latest deadline batch run(s) for the Debug panel.
 * Shows when updates started (is_current detected), finished, duration, and phase breakdown.
 */
export function useDeadlineBatchRuns() {
  const { data: runs = [], isLoading, error } = useQuery({
    queryKey: ['deadline-batch-runs'],
    queryFn: async () => {
      const { data, error: err } = await supabase
        .from('deadline_batch_runs')
        .select('id, gameweek, started_at, finished_at, duration_seconds, manager_count, league_count, success, phase_breakdown')
        .order('started_at', { ascending: false })
        .limit(5)
      if (err) throw err
      return data ?? []
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  })

  const latest = runs[0] ?? null
  const phaseRows = latest?.phase_breakdown && typeof latest.phase_breakdown === 'object'
    ? Object.entries(latest.phase_breakdown)
        .filter(([, sec]) => sec != null && typeof sec === 'number')
        .map(([key, sec]) => ({
          label: PHASE_LABELS[key] ?? key,
          durationSec: sec,
        }))
    : []

  return {
    runs,
    latest,
    phaseRows,
    isLoading,
    error,
  }
}

/**
 * Format seconds as "Xs" or "Xm Ys".
 */
export function formatDurationSeconds(sec) {
  if (sec == null || typeof sec !== 'number') return '—'
  const s = Math.round(sec)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const r = s % 60
  return r > 0 ? `${m}m ${r}s` : `${m}m`
}
