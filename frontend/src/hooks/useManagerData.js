import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useConfiguration } from '../contexts/ConfigurationContext'
import { useGameweekData } from './useGameweekData'

export function useManagerData() {
  const { config } = useConfiguration()
  const { gameweek } = useGameweekData()
  const MANAGER_ID = config?.managerId || import.meta.env.VITE_MANAGER_ID || null
  const LEAGUE_ID = config?.leagueId || import.meta.env.VITE_LEAGUE_ID || null

  // Fetch manager data (depends on gameweek, runs queries in parallel)
  const { data: managerData, isLoading, error } = useQuery({
    queryKey: ['manager', MANAGER_ID, gameweek, LEAGUE_ID],
    queryFn: async () => {
      if (!MANAGER_ID || !gameweek) return null

      // OPTIMIZATION: Run queries in parallel instead of sequentially
      const queries = [
        supabase
          .from('manager_gameweek_history')
          .select('*')
          .eq('manager_id', MANAGER_ID)
          .eq('gameweek', gameweek)
          .single(),
        supabase
          .from('manager_gameweek_history')
          .select('overall_rank, total_points, transfers_made')
          .eq('manager_id', MANAGER_ID)
          .eq('gameweek', gameweek - 1)
          .single(),
      ]

      // If we have a league ID, also fetch league-specific rank from materialized view
      if (LEAGUE_ID) {
        queries.push(
          supabase
            .from('mv_mini_league_standings')
            .select('calculated_rank, mini_league_rank, calculated_rank_change, mini_league_rank_change')
            .eq('league_id', LEAGUE_ID)
            .eq('manager_id', MANAGER_ID)
            .eq('gameweek', gameweek)
            .maybeSingle()
        )
      }

      const results = await Promise.all(queries)

      const history = results[0].data
      const historyError = results[0].error
      const prevHistory = results[1].data
      const leagueStanding = LEAGUE_ID ? results[2]?.data : null

      if (historyError && historyError.code !== 'PGRST116') {
        throw historyError
      }

      // Use calculated_rank from MV (correct per league); mini_league_rank can be from another league
      const leagueRank = leagueStanding?.calculated_rank ?? leagueStanding?.mini_league_rank ?? history?.mini_league_rank ?? null
      
      // Use calculated_rank_change from MV (per-league); mini_league_rank_change can be from another league
      let leagueRankChange = 0
      if (LEAGUE_ID && leagueStanding) {
        leagueRankChange = leagueStanding.calculated_rank_change ?? leagueStanding.mini_league_rank_change ?? 0
      } else if (prevHistory && history) {
        leagueRankChange = (prevHistory.mini_league_rank || 0) - (history.mini_league_rank || 0)
      }

      // Free transfers at start of GW: GW1 → 1; else 2 if prev GW used 0, else 1.
      // When Wildcard or Free Hit was played, all transfers that GW are free → show "X of X".
      // Fallback: if active_chip is missing but they made 3+ transfers with 0 cost, they used a chip.
      const chipFromActiveChip = history?.active_chip === 'wildcard' || history?.active_chip === 'freehit'
      const chipFromZeroCost = (history?.transfers_made ?? 0) > 2 && (history?.transfer_cost ?? 0) === 0
      const isChipFreeTransfers = chipFromActiveChip || chipFromZeroCost
      const freeTransfersAvailable = isChipFreeTransfers
        ? (history?.transfers_made ?? 0)
        : gameweek === 1
          ? 1
          : (prevHistory?.transfers_made === 0 ? 2 : 1)

      // Rank change: use computed delta when both ranks exist; else use stored overall_rank_change (don't show prev rank as "gain")
      const hasCurrentRank = history?.overall_rank != null
      const hasPrevRank = prevHistory?.overall_rank != null
      const overallRankChange =
        hasCurrentRank && hasPrevRank
          ? prevHistory.overall_rank - history.overall_rank
          : (history?.overall_rank_change ?? 0)

      return {
        overallRank: history?.overall_rank ?? null,
        overallRankChange,
        gameweekRank: history?.gameweek_rank ?? null,
        totalPoints: history?.total_points || 0,
        gameweekPoints: history?.gameweek_points || 0,
        teamValue: history?.team_value_tenths
          ? (history.team_value_tenths / 10).toFixed(1)
          : null,
        bankValue: history?.bank_tenths
          ? (history.bank_tenths / 10).toFixed(1)
          : null,
        leagueRank: leagueRank,
        leagueRankChange: leagueRankChange,
        transfersMade: history?.transfers_made ?? 0,
        freeTransfersAvailable,
        activeChip: history?.active_chip ?? null,
      }
    },
    enabled: !!MANAGER_ID && !!gameweek, // Only run if we have manager ID and gameweek
    staleTime: 30000, // Cache for 30 seconds
    refetchInterval: 30000, // Poll every 30 seconds (automatic background refetch)
  })

  return { managerData, loading: isLoading, error }
}
