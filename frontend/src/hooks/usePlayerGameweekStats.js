import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

/**
 * Fetches aggregated gameweek stats for one player in one gameweek.
 * For DGW, sums all fixture rows into one totals object (same shape as a single GW row).
 * Returns { points, minutes, goals_scored, assists, ... } or null.
 */
export function usePlayerGameweekStats(playerId, gameweek) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['player-gameweek-stats', playerId, gameweek],
    queryFn: async () => {
      if (playerId == null || gameweek == null) return null

      const { data: rows, error: err } = await supabase
        .from('player_gameweek_stats')
        .select(
          'total_points, minutes, goals_scored, assists, clean_sheets, saves, bps, bonus, defensive_contribution, yellow_cards, red_cards, expected_goals, expected_assists, expected_goal_involvements, expected_goals_conceded, goals_conceded'
        )
        .eq('player_id', playerId)
        .eq('gameweek', gameweek)

      if (err) throw err
      if (!rows?.length) return null

      const agg = {
        points: 0,
        minutes: 0,
        goals_scored: 0,
        assists: 0,
        clean_sheets: 0,
        saves: 0,
        bps: 0,
        bonus: 0,
        defensive_contribution: 0,
        yellow_cards: 0,
        red_cards: 0,
        expected_goals: 0,
        expected_assists: 0,
        expected_goal_involvements: 0,
        expected_goals_conceded: 0,
        goals_conceded: 0,
      }
      for (const r of rows) {
        agg.points += r.total_points ?? 0
        agg.minutes += r.minutes ?? 0
        agg.goals_scored += r.goals_scored ?? 0
        agg.assists += r.assists ?? 0
        agg.clean_sheets += r.clean_sheets ?? 0
        agg.saves += r.saves ?? 0
        agg.bps += r.bps ?? 0
        agg.bonus += r.bonus ?? 0
        agg.defensive_contribution += r.defensive_contribution ?? 0
        agg.yellow_cards += r.yellow_cards ?? 0
        agg.red_cards += r.red_cards ?? 0
        agg.expected_goals += Number(r.expected_goals) || 0
        agg.expected_assists += Number(r.expected_assists) || 0
        agg.expected_goal_involvements += Number(r.expected_goal_involvements) || 0
        agg.expected_goals_conceded += Number(r.expected_goals_conceded) || 0
        agg.goals_conceded += r.goals_conceded ?? 0
      }
      return agg
    },
    enabled: playerId != null && gameweek != null,
    staleTime: 60000,
  })

  return { stats: data ?? null, loading: isLoading, error }
}

/**
 * Fetches aggregated stats for one player over a range of gameweeks.
 * @param {number|null} playerId
 * @param {number|null} currentGameweek - latest GW to include
 * @param {'all'|'last6'|'last12'} filter
 * @returns {{ stats: object|null, loading: boolean, error: Error|null }}
 */
export function usePlayerGameweekStatsRange(playerId, currentGameweek, filter) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['player-gameweek-stats-range', playerId, currentGameweek, filter],
    queryFn: async () => {
      if (playerId == null || currentGameweek == null) return null
      const gw = Number(currentGameweek)
      let minGw = 1
      if (filter === 'last6') minGw = Math.max(1, gw - 5)
      else if (filter === 'last12') minGw = Math.max(1, gw - 11)

      const { data: rows, error: err } = await supabase
        .from('player_gameweek_stats')
        .select(
          'total_points, minutes, goals_scored, assists, clean_sheets, saves, bps, bonus, defensive_contribution, yellow_cards, red_cards, expected_goals, expected_assists, expected_goal_involvements, expected_goals_conceded, goals_conceded'
        )
        .eq('player_id', playerId)
        .gte('gameweek', minGw)
        .lte('gameweek', gw)

      if (err) throw err
      if (!rows?.length) return null

      const agg = {
        points: 0,
        minutes: 0,
        goals_scored: 0,
        assists: 0,
        clean_sheets: 0,
        saves: 0,
        bps: 0,
        bonus: 0,
        defensive_contribution: 0,
        yellow_cards: 0,
        red_cards: 0,
        expected_goals: 0,
        expected_assists: 0,
        expected_goal_involvements: 0,
        expected_goals_conceded: 0,
        goals_conceded: 0,
      }
      for (const r of rows) {
        agg.points += r.total_points ?? 0
        agg.minutes += r.minutes ?? 0
        agg.goals_scored += r.goals_scored ?? 0
        agg.assists += r.assists ?? 0
        agg.clean_sheets += r.clean_sheets ?? 0
        agg.saves += r.saves ?? 0
        agg.bps += r.bps ?? 0
        agg.bonus += r.bonus ?? 0
        agg.defensive_contribution += r.defensive_contribution ?? 0
        agg.yellow_cards += r.yellow_cards ?? 0
        agg.red_cards += r.red_cards ?? 0
        agg.expected_goals += Number(r.expected_goals) || 0
        agg.expected_assists += Number(r.expected_assists) || 0
        agg.expected_goal_involvements += Number(r.expected_goal_involvements) || 0
        agg.expected_goals_conceded += Number(r.expected_goals_conceded) || 0
        agg.goals_conceded += r.goals_conceded ?? 0
      }
      return agg
    },
    enabled: playerId != null && currentGameweek != null && ['all', 'last6', 'last12'].includes(filter),
    staleTime: 60000,
  })

  return { stats: data ?? null, loading: isLoading, error }
}

/**
 * Fetches stat ranks (1 = best) for one player over a gameweek range.
 * When rankBy is 'per90', ranks are by per-90 rate (players with 90+ minutes only).
 * Returns rank and _tie per stat so UI can show "T-2" for ties.
 * @param {number|null} playerId
 * @param {number|null} currentGameweek
 * @param {'all'|'last6'|'last12'} filter
 * @param {'total'|'per90'} rankBy - rank by totals or per-90 (matches Per 90 toggle when Rank is on)
 * @returns {{ ranks: Record<string, number|boolean>|null, loading: boolean, error: Error|null }}
 */
export function usePlayerCompareStatRanks(playerId, currentGameweek, filter, rankBy = 'total') {
  const { data, isLoading, error } = useQuery({
    queryKey: ['player-compare-stat-ranks', playerId, currentGameweek, filter, rankBy],
    queryFn: async () => {
      if (playerId == null || currentGameweek == null) return null
      const gw = Number(currentGameweek)
      let minGw = 1
      if (filter === 'last6') minGw = Math.max(1, gw - 5)
      else if (filter === 'last12') minGw = Math.max(1, gw - 11)

      const { data: result, error: err } = await supabase.rpc('get_player_compare_stat_ranks', {
        p_player_id: playerId,
        p_gw_min: minGw,
        p_gw_max: gw,
        p_rank_by: rankBy === 'per90' ? 'per90' : 'total',
      })

      if (err) throw err
      if (result == null) return null
      if (Array.isArray(result) && result.length === 1) return result[0]
      if (typeof result === 'object' && !Array.isArray(result)) return result
      return null
    },
    enabled: playerId != null && currentGameweek != null && ['all', 'last6', 'last12'].includes(filter),
    staleTime: 60000,
  })

  return { ranks: data ?? null, loading: isLoading, error }
}
