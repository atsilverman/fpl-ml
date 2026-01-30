import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

/**
 * Fetches league-level top transfers (most transferred out / in) for a gameweek.
 * Uses mv_league_transfer_aggregation (aggregates by player_name, transfer_direction).
 * Optionally uses v_league_transfer_aggregation when available for team_short_name (badges).
 */
export function useLeagueTopTransfers(leagueId = null, gameweek = null) {
  const LIMIT_PER_DIRECTION = 15
  const source = 'v_league_transfer_aggregation' // View includes team_short_name for badges

  const { data, isLoading, error } = useQuery({
    queryKey: ['league-top-transfers', leagueId, gameweek],
    queryFn: async () => {
      if (!leagueId || !gameweek) {
        return { transfersOut: [], transfersIn: [] }
      }

      const select = 'player_name, transfer_count, manager_count, team_short_name'

      const [outRes, inRes] = await Promise.all([
        supabase
          .from(source)
          .select(select)
          .eq('league_id', leagueId)
          .eq('gameweek', gameweek)
          .eq('transfer_direction', 'out')
          .order('transfer_count', { ascending: false })
          .limit(LIMIT_PER_DIRECTION),
        supabase
          .from(source)
          .select(select)
          .eq('league_id', leagueId)
          .eq('gameweek', gameweek)
          .eq('transfer_direction', 'in')
          .order('transfer_count', { ascending: false })
          .limit(LIMIT_PER_DIRECTION),
      ])

      if (outRes.error) throw outRes.error
      if (inRes.error) throw inRes.error

      const mapRow = (row) => ({
        playerName: row.player_name ?? 'Unknown',
        count: row.transfer_count ?? row.manager_count ?? 0,
        teamShortName: row.team_short_name ?? null,
      })

      const transfersOut = (outRes.data || []).map(mapRow)
      const transfersIn = (inRes.data || []).map(mapRow)

      return { transfersOut, transfersIn }
    },
    enabled: !!leagueId && !!gameweek,
    staleTime: 60000,
    refetchInterval: 60000,
  })

  return {
    transfersOut: data?.transfersOut ?? [],
    transfersIn: data?.transfersIn ?? [],
    loading: isLoading,
    error,
  }
}
