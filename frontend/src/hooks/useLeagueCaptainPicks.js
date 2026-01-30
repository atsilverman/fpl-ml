import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useConfiguration } from '../contexts/ConfigurationContext'

/**
 * Hook to fetch captain and vice-captain picks for all managers in the configured league
 * for the current gameweek. Returns array of { manager_id, rank, manager_team_name, captain_name, vice_captain_name }
 * sorted by rank ascending (same shape as expanded league rank).
 */
export function useLeagueCaptainPicks(gameweek = null) {
  const { config } = useConfiguration()
  const LEAGUE_ID = config?.leagueId || import.meta.env.VITE_LEAGUE_ID || null

  const { data: leagueCaptainData, isLoading, error } = useQuery({
    queryKey: ['league-captain-picks', LEAGUE_ID, gameweek],
    queryFn: async () => {
      if (!LEAGUE_ID || !gameweek) return []

      const { data: standings, error: standingsError } = await supabase
        .from('mv_mini_league_standings')
        .select('manager_id, manager_name, manager_team_name, mini_league_rank')
        .eq('league_id', LEAGUE_ID)
        .eq('gameweek', gameweek)
        .order('mini_league_rank', { ascending: true })

      if (standingsError) throw standingsError
      if (!standings?.length) return []

      const managerIds = standings.map(s => s.manager_id)

      const { data: picks, error: picksError } = await supabase
        .from('manager_picks')
        .select('manager_id, player_id, is_captain, is_vice_captain, players(web_name)')
        .in('manager_id', managerIds)
        .eq('gameweek', gameweek)
        .or('is_captain.eq.true,is_vice_captain.eq.true')

      if (picksError) throw picksError

      const byManager = {}
      ;(picks || []).forEach(p => {
        if (!byManager[p.manager_id]) byManager[p.manager_id] = { captain_name: null, vice_captain_name: null }
        const name = p.players?.web_name ?? '—'
        if (p.is_captain) byManager[p.manager_id].captain_name = name
        if (p.is_vice_captain) byManager[p.manager_id].vice_captain_name = name
      })

      return standings.map(s => {
        const caps = byManager[s.manager_id] || { captain_name: null, vice_captain_name: null }
        const displayName = (s.manager_team_name && s.manager_team_name.trim())
          ? s.manager_team_name
          : (s.manager_name || `Manager ${s.manager_id}`)
        return {
          manager_id: s.manager_id,
          rank: s.mini_league_rank ?? null,
          manager_team_name: displayName,
          captain_name: caps.captain_name ?? '—',
          vice_captain_name: caps.vice_captain_name ?? '—'
        }
      })
    },
    enabled: !!LEAGUE_ID && !!gameweek,
    staleTime: 60000,
    refetchInterval: 60000
  })

  return {
    leagueCaptainData: leagueCaptainData ?? [],
    loading: isLoading,
    error
  }
}
