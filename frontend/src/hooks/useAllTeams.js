import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

/**
 * Fetches all teams (team_id, short_name, team_name) for the Research Teams subpage collage.
 */
export function useAllTeams(enabled = true) {
  const { data: teams = [], isLoading } = useQuery({
    queryKey: ['all-teams'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teams')
        .select('team_id, short_name, team_name')
        .order('team_id', { ascending: true })
      if (error) throw error
      return data ?? []
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  })
  return { teams, loading: isLoading }
}
