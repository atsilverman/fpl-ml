import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useConfiguration } from '../contexts/ConfigurationContext'

export function useMiniLeagueStandings(gameweek = null) {
  const { config } = useConfiguration()
  const LEAGUE_ID = config?.leagueId || import.meta.env.VITE_LEAGUE_ID || null

  const { data: standings = [], isLoading, error, dataUpdatedAt } = useQuery({
    queryKey: ['standings', LEAGUE_ID, gameweek],
    queryFn: async () => {
      if (!LEAGUE_ID) return []

      let query = supabase
        .from('mv_mini_league_standings')
        .select('*')
        .eq('league_id', LEAGUE_ID)
        .order('total_points', { ascending: false })

      if (gameweek) {
        query = query.eq('gameweek', gameweek)
      }

      const { data, error } = await query

      if (error) throw error
      return data || []
    },
    enabled: !!LEAGUE_ID, // Only run if we have a league ID
    staleTime: 30000, // Shared data - cache for 30 seconds
    refetchInterval: 30000, // Poll every 30 seconds (automatic background refetch)
  })

  return { standings, loading: isLoading, error, dataUpdatedAt }
}
