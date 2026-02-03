import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

/**
 * Builds a stable key for a team pair (order-independent).
 */
export function pairKey(teamIdA, teamIdB) {
  if (teamIdA == null || teamIdB == null) return null
  const a = Number(teamIdA)
  const b = Number(teamIdB)
  return `${Math.min(a, b)}-${Math.max(a, b)}`
}

/**
 * Fetches the last head-to-head fixture for each unique team pair in the season.
 * Used to show "last time these teams played" for scheduled fixtures in second half (GW >= 20).
 * Returns a map keyed by pairKey(home_team_id, away_team_id) → { gameweek, home_team_id, away_team_id, home_score, away_score }.
 */
export function useLastH2H(gameweek) {
  const isSecondHalf = gameweek != null && Number(gameweek) >= 20

  const { data: lastH2HMap = {}, isLoading, error } = useQuery({
    queryKey: ['last-h2h', gameweek],
    queryFn: async () => {
      if (!gameweek) return {}

      const { data: fixtures, error: fetchError } = await supabase
        .from('fixtures')
        .select('fpl_fixture_id, gameweek, home_team_id, away_team_id, home_score, away_score')
        .eq('finished', true)
        .lt('gameweek', Number(gameweek))
        .order('gameweek', { ascending: false })

      if (fetchError) throw fetchError
      if (!fixtures?.length) return {}

      const byPair = {}
      for (const f of fixtures) {
        const key = pairKey(f.home_team_id, f.away_team_id)
        if (key && byPair[key] == null) byPair[key] = f
      }
      return byPair
    },
    enabled: !!gameweek,
    staleTime: 5 * 60 * 1000
  })

  return {
    lastH2HMap,
    loading: isLoading,
    error,
    isSecondHalf
  }
}
