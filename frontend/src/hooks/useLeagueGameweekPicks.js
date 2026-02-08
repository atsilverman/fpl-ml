import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

/**
 * Fetches starting XI picks (position <= 11) for all managers in the league for a gameweek.
 * Used to compute per-player "importance" (your share of a player's points vs league average).
 * Returns { picks: [{ manager_id, player_id, multiplier }], managerCount }.
 */
export function useLeagueGameweekPicks(leagueId, gameweek) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['league-gameweek-picks', leagueId, gameweek],
    queryFn: async () => {
      if (!leagueId || !gameweek) return { picks: [], managerCount: 0 }

      const { data: standings, error: standingsError } = await supabase
        .from('mv_mini_league_standings')
        .select('manager_id')
        .eq('league_id', leagueId)
        .eq('gameweek', gameweek)

      if (standingsError) throw standingsError
      if (!standings?.length) return { picks: [], managerCount: 0 }

      const managerIds = standings.map((s) => s.manager_id)
      const managerCount = managerIds.length

      const { data: picks, error: picksError } = await supabase
        .from('manager_picks')
        .select('manager_id, player_id, position, multiplier, is_captain')
        .in('manager_id', managerIds)
        .eq('gameweek', gameweek)
        .lte('position', 11)

      if (picksError) throw picksError

      return {
        picks: (picks || []).map((p) => {
          let mult = p.multiplier ?? 1
          if (mult === 1 && p.is_captain) mult = 2
          return {
            manager_id: p.manager_id,
            player_id: p.player_id,
            multiplier: mult
          }
        }),
        managerCount
      }
    },
    enabled: !!leagueId && !!gameweek,
    staleTime: 60 * 1000
  })

  return {
    picks: data?.picks ?? [],
    managerCount: data?.managerCount ?? 0,
    loading: isLoading,
    error
  }
}
