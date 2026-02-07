import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useConfiguration } from '../contexts/ConfigurationContext'

/**
 * Fetches active_chip for the current gameweek for all managers in the configured league.
 * Returns a map: manager_id -> active_chip (wildcard | freehit | bboost | 3xc | null).
 */
export function useLeagueActiveChips(gameweek) {
  const { config } = useConfiguration()
  const LEAGUE_ID = config?.leagueId ?? import.meta.env.VITE_LEAGUE_ID ?? null

  const { data: activeChipByManager = {}, isLoading, error } = useQuery({
    queryKey: ['league-active-chips', LEAGUE_ID, gameweek],
    queryFn: async () => {
      if (!LEAGUE_ID || gameweek == null) return {}

      const { data: leagueManagers, error: leagueError } = await supabase
        .from('mini_league_managers')
        .select('manager_id')
        .eq('league_id', LEAGUE_ID)

      if (leagueError) throw leagueError
      if (!leagueManagers?.length) return {}

      const managerIds = leagueManagers.map(m => m.manager_id)

      const { data: rows, error: mghError } = await supabase
        .from('manager_gameweek_history')
        .select('manager_id, active_chip')
        .eq('gameweek', gameweek)
        .in('manager_id', managerIds)

      if (mghError) throw mghError

      const map = {}
      ;(rows || []).forEach(row => {
        const chip = row.active_chip != null ? String(row.active_chip).toLowerCase() : null
        map[row.manager_id] = chip
      })
      return map
    },
    enabled: !!LEAGUE_ID && gameweek != null,
    staleTime: 30000,
    refetchInterval: 30000
  })

  return { activeChipByManager, loading: isLoading, error }
}
