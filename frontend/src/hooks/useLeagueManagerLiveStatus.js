import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useConfiguration } from '../contexts/ConfigurationContext'

/**
 * Fetches left_to_play and in_play counts per manager for the configured league and gameweek.
 * Uses manager_live_status view. Returns a map by manager_id: { left_to_play, in_play }.
 */
export function useLeagueManagerLiveStatus(leagueId, gameweek) {
  const { config } = useConfiguration()
  const LEAGUE_ID = leagueId ?? config?.leagueId ?? import.meta.env.VITE_LEAGUE_ID ?? null

  const { data: liveStatusMap = {}, isLoading, error } = useQuery({
    queryKey: ['league-manager-live-status', LEAGUE_ID, gameweek],
    queryFn: async () => {
      if (!LEAGUE_ID || gameweek == null) return {}

      const { data: leagueManagers, error: leagueError } = await supabase
        .from('mini_league_managers')
        .select('manager_id')
        .eq('league_id', LEAGUE_ID)

      if (leagueError) throw leagueError
      if (!leagueManagers?.length) return {}

      const managerIds = leagueManagers.map(m => m.manager_id)

      const { data: rows, error: statusError } = await supabase
        .from('manager_live_status')
        .select('manager_id, left_to_play, in_play')
        .eq('gameweek', gameweek)
        .in('manager_id', managerIds)

      if (statusError) throw statusError

      const map = {}
      ;(rows || []).forEach(row => {
        map[row.manager_id] = {
          left_to_play: row.left_to_play ?? 0,
          in_play: row.in_play ?? 0
        }
      })
      return map
    },
    enabled: !!LEAGUE_ID && gameweek != null,
    staleTime: 30000,
    refetchInterval: 30000
  })

  return { liveStatusByManager: liveStatusMap, loading: isLoading, error }
}
