import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

/**
 * Search teams by short_name or team_name for autocomplete.
 * Only runs when query string has at least 2 characters.
 */
export function useLeagueTeamSearch(query) {
  const trimmed = (query || '').trim()
  const enabled = trimmed.length >= 2

  const { data: teams = [], isLoading, error } = useQuery({
    queryKey: ['league-team-search', trimmed],
    queryFn: async () => {
      if (!enabled) return []

      const { data, error: err } = await supabase
        .from('teams')
        .select('team_id, short_name, team_name')
        .or(`short_name.ilike.%${trimmed}%,team_name.ilike.%${trimmed}%`)
        .order('short_name', { ascending: true })
        .limit(15)

      if (err) throw err

      return (data || []).map((t) => ({
        team_id: t.team_id,
        short_name: t.short_name ?? '—',
        team_name: t.team_name ?? t.short_name ?? '—'
      }))
    },
    enabled,
    staleTime: 60000
  })

  return { teams, loading: isLoading, error }
}
