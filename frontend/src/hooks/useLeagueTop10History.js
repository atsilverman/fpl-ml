import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useConfiguration } from '../contexts/ConfigurationContext'

/**
 * Hook to fetch overall rank history for the top 10 managers in the configured league
 * (by current league rank). Used for comparison lines on the performance chart.
 * Returns array of { managerId, managerName, leagueRank (1=leader), data: [{ gameweek, overallRank }] }.
 */
export function useLeagueTop10History(gameweek = null) {
  const { config } = useConfiguration()
  const LEAGUE_ID = config?.leagueId || import.meta.env.VITE_LEAGUE_ID || null

  const { data: top10History = [], isLoading, error } = useQuery({
    queryKey: ['league-top10-history', LEAGUE_ID, gameweek],
    queryFn: async () => {
      if (!LEAGUE_ID) return []

      // Resolve gameweek: use provided or latest in MV
      let gw = gameweek
      if (gw == null) {
        const { data: latest } = await supabase
          .from('mv_mini_league_standings')
          .select('gameweek')
          .eq('league_id', LEAGUE_ID)
          .order('gameweek', { ascending: false })
          .limit(1)
          .maybeSingle()
        gw = latest?.gameweek ?? null
      }
      if (gw == null) return []

      // Get top 10 by league rank for this gameweek
      const { data: standings, error: standingsError } = await supabase
        .from('mv_mini_league_standings')
        .select('manager_id, manager_name, manager_team_name, calculated_rank, total_points')
        .eq('league_id', LEAGUE_ID)
        .eq('gameweek', gw)
        .order('total_points', { ascending: false })
        .limit(10)

      if (standingsError) throw standingsError
      if (!standings?.length) return []

      const managerIds = standings.map(s => s.manager_id)
      const nameByManager = new Map(
        standings.map(s => [
          s.manager_id,
          s.manager_team_name || s.manager_name || `Manager ${s.manager_id}`
        ])
      )

      // Fetch overall rank history for those managers
      const { data: historyData, error: historyError } = await supabase
        .from('manager_gameweek_history')
        .select('manager_id, gameweek, overall_rank')
        .in('manager_id', managerIds)
        .not('overall_rank', 'is', null)
        .order('gameweek', { ascending: true })

      if (historyError) throw historyError

      // Group by manager (preserve top-10 order); leagueRank 1 = leader
      const byManager = new Map()
      managerIds.forEach((mid, idx) => {
        byManager.set(mid, {
          managerId: mid,
          managerName: nameByManager.get(mid) || `Manager ${mid}`,
          leagueRank: idx + 1,
          data: []
        })
      })
      for (const row of historyData || []) {
        if (byManager.has(row.manager_id)) {
          byManager.get(row.manager_id).data.push({
            gameweek: row.gameweek,
            overallRank: row.overall_rank
          })
        }
      }

      return managerIds
        .map(mid => byManager.get(mid))
        .filter(Boolean)
        .filter(m => m.data.length > 0)
    },
    enabled: !!LEAGUE_ID,
    staleTime: 60000,
    refetchInterval: 60000,
  })

  return { top10History, loading: isLoading, error }
}
