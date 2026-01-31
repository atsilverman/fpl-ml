import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

/**
 * Fetches total FPL managers from fpl_global (populated by backend from bootstrap-static total_players).
 * Used for GW rank percentile display (top 0.1%, 1%, 5%, 10%).
 */
export function useTotalManagers() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['fpl_global', 'total_managers'],
    queryFn: async () => {
      const { data: row, error: err } = await supabase
        .from('fpl_global')
        .select('total_managers')
        .eq('id', 'current_season')
        .maybeSingle()

      if (err) throw err
      return row?.total_managers ?? null
    },
    staleTime: 5 * 60 * 1000, // Cache 5 minutes (updates when gameweeks refresh)
  })

  return { totalManagers: data ?? null, loading: isLoading, error }
}

/**
 * Returns GW rank percentile label when manager is in top 0.1%, 1%, 5%, or 10%.
 * @param {number | null} gameweekRank - Manager's gameweek rank
 * @param {number | null} totalManagers - Total FPL managers from fpl_global
 * @returns {string | undefined} e.g. 'Top 0.1%', 'Top 1%', or undefined
 */
export function getGwRankPercentileLabel(gameweekRank, totalManagers) {
  if (gameweekRank == null || totalManagers == null || totalManagers <= 0) return undefined
  const percentile = gameweekRank / totalManagers
  if (percentile <= 0.001) return 'Top 0.1%'
  if (percentile <= 0.01) return 'Top 1%'
  if (percentile <= 0.05) return 'Top 5%'
  if (percentile <= 0.10) return 'Top 10%'
  return undefined
}
