import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useConfiguration } from '../contexts/ConfigurationContext'

/**
 * Build chip usage map from manager_gameweek_history rows (same shape as useChipUsage).
 */
function buildChipUsage(rows) {
  const usage = {
    wc1: null,
    wc2: null,
    fh: null,
    fh2: null,
    bb: null,
    bb2: null,
    tc: null,
    tc2: null
  }
  ;(rows || []).forEach(row => {
    const chip = row.active_chip
    const gameweek = row.gameweek
    const isSecondHalf = gameweek > 19
    if (chip === 'wildcard') {
      if (isSecondHalf) usage.wc2 = gameweek
      else usage.wc1 = gameweek
    } else if (chip === 'freehit') {
      if (isSecondHalf) usage.fh2 = gameweek
      else usage.fh = gameweek
    } else if (chip === 'bboost') {
      if (isSecondHalf) usage.bb2 = gameweek
      else usage.bb = gameweek
    } else if (chip === '3xc') {
      if (isSecondHalf) usage.tc2 = gameweek
      else usage.tc = gameweek
    }
  })
  return usage
}

/**
 * Hook to fetch chip usage for all managers in the configured league.
 * Returns array of { manager_id, manager_name, rank, chipUsage } sorted by rank ascending (1, 2, 3...).
 */
export function useLeagueChipUsage(gameweek = null) {
  const { config } = useConfiguration()
  const LEAGUE_ID = config?.leagueId || import.meta.env.VITE_LEAGUE_ID || null

  const { data: leagueChipData, isLoading, error } = useQuery({
    queryKey: ['league-chip-usage', LEAGUE_ID, gameweek],
    queryFn: async () => {
      if (!LEAGUE_ID) return []

      const { data: leagueManagers, error: leagueError } = await supabase
        .from('mini_league_managers')
        .select('manager_id')
        .eq('league_id', LEAGUE_ID)

      if (leagueError) throw leagueError
      if (!leagueManagers?.length) return []

      const managerIds = leagueManagers.map(m => m.manager_id)

      const { data: managerDetails, error: managerError } = await supabase
        .from('managers')
        .select('manager_id, manager_name, manager_team_name')
        .in('manager_id', managerIds)

      if (managerError) throw managerError

      const nameByManager = {}
      ;(managerDetails || []).forEach(m => {
        nameByManager[m.manager_id] = m.manager_team_name || m.manager_name || `Manager ${m.manager_id}`
      })

      const { data: chipRows, error: chipError } = await supabase
        .from('manager_gameweek_history')
        .select('manager_id, gameweek, active_chip')
        .in('manager_id', managerIds)
        .not('active_chip', 'is', null)
        .order('gameweek', { ascending: true })

      if (chipError) throw chipError

      const byManager = {}
      ;(chipRows || []).forEach(row => {
        if (!byManager[row.manager_id]) byManager[row.manager_id] = []
        byManager[row.manager_id].push(row)
      })

      let rankByManager = {}
      if (gameweek != null) {
        const { data: standings, error: standingsError } = await supabase
          .from('mv_mini_league_standings')
          .select('manager_id, calculated_rank, mini_league_rank')
          .eq('league_id', LEAGUE_ID)
          .eq('gameweek', gameweek)

        if (!standingsError && standings?.length) {
          standings.forEach(s => {
            rankByManager[s.manager_id] = s.calculated_rank ?? s.mini_league_rank ?? null
          })
        }
      }

      const rows = managerIds.map(manager_id => ({
        manager_id,
        manager_name: nameByManager[manager_id] ?? `Manager ${manager_id}`,
        rank: rankByManager[manager_id] ?? null,
        chipUsage: buildChipUsage(byManager[manager_id] || [])
      }))

      rows.sort((a, b) => {
        const ra = a.rank ?? 999999
        const rb = b.rank ?? 999999
        return ra - rb
      })

      return rows
    },
    enabled: !!LEAGUE_ID,
    staleTime: 60000,
    refetchInterval: 60000
  })

  return {
    leagueChipData: leagueChipData ?? [],
    loading: isLoading,
    error
  }
}
