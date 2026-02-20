import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useConfiguration } from '../contexts/ConfigurationContext'

const SECOND_HALF_START_GW = 20

/**
 * Fetches chip usage in the second half of the season (GW >= 20) for all league managers.
 * Returns a map: manager_id -> { wc2: gw | null, tc2: gw | null, bb2: gw | null, fh2: gw | null }.
 */
export function useLeagueChipUsage() {
  const { config } = useConfiguration()
  const LEAGUE_ID = config?.leagueId ?? import.meta.env.VITE_LEAGUE_ID ?? null

  const { data: chipUsageByManager = {}, isLoading, error } = useQuery({
    queryKey: ['league-chip-usage', LEAGUE_ID],
    queryFn: async () => {
      if (!LEAGUE_ID) return {}

      const { data: leagueManagers, error: leagueError } = await supabase
        .from('mini_league_managers')
        .select('manager_id')
        .eq('league_id', LEAGUE_ID)

      if (leagueError) throw leagueError
      if (!leagueManagers?.length) return {}

      const managerIds = leagueManagers.map(m => m.manager_id)

      const { data: rows, error: mghError } = await supabase
        .from('manager_gameweek_history')
        .select('manager_id, gameweek, active_chip')
        .gte('gameweek', SECOND_HALF_START_GW)
        .in('manager_id', managerIds)
        .not('active_chip', 'is', null)

      if (mghError) throw mghError

      const map = {}
      for (const id of managerIds) {
        map[id] = { wc2: null, tc2: null, bb2: null, fh2: null }
      }
      ;(rows || []).forEach(row => {
        const chip = String(row.active_chip).toLowerCase()
        const gw = row.gameweek
        if (!map[row.manager_id]) map[row.manager_id] = { wc2: null, tc2: null, bb2: null, fh2: null }
        if (chip === 'wildcard') map[row.manager_id].wc2 = gw
        else if (chip === '3xc') map[row.manager_id].tc2 = gw
        else if (chip === 'bboost') map[row.manager_id].bb2 = gw
        else if (chip === 'freehit') map[row.manager_id].fh2 = gw
      })
      return map
    },
    enabled: !!LEAGUE_ID,
    staleTime: 60000,
  })

  return { chipUsageByManager, loading: isLoading, error }
}
