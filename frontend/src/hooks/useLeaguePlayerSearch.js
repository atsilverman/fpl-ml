import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

/**
 * Search players by name for autocomplete. Returns { fpl_player_id, web_name, team_short_name }.
 * Only runs when query string has at least 2 characters.
 */
export function useLeaguePlayerSearch(query) {
  const trimmed = (query || '').trim()
  const enabled = trimmed.length >= 2

  const { data: players = [], isLoading, error } = useQuery({
    queryKey: ['league-player-search', trimmed],
    queryFn: async () => {
      if (!enabled) return []

      const { data, error: err } = await supabase
        .from('players')
        .select(`
          fpl_player_id,
          web_name,
          teams(short_name)
        `)
        .ilike('web_name', `%${trimmed}%`)
        .order('web_name', { ascending: true })
        .limit(15)

      if (err) throw err

      return (data || []).map((p) => ({
        fpl_player_id: p.fpl_player_id,
        web_name: p.web_name || '—',
        team_short_name: p.teams?.short_name ?? null
      }))
    },
    enabled,
    staleTime: 60000
  })

  return { players, loading: isLoading, error }
}
