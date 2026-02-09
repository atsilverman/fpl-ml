import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

const POSITION_LABELS = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' }

/**
 * Fetches player detail for the player detail modal: info, price, season points,
 * gameweek-by-gameweek points (for chart), and league ownership.
 * Position/overall rank by points are omitted (would require a heavy or RPC query).
 * leagueManagerIds: when provided, ownership is restricted to these managers (current league only).
 *
 * Current price: from player_prices for the selected gameweek, then latest in player_prices,
 * then players.cost_tenths (synced from bootstrap on refresh). Missing if no refresh has
 * written prices for this player (e.g. new env, or player_prices not yet synced).
 */
export function usePlayerDetail(playerId, gameweek, leagueManagerCount = null, leagueManagerIds = null) {
  const leagueIds = Array.isArray(leagueManagerIds) ? leagueManagerIds : []
  const { data: managerIdsOwningPlayer = [], loading: ownershipLoading } = useQuery({
    queryKey: ['league-player-ownership', playerId, gameweek, leagueIds.length ? leagueIds.slice().sort((a, b) => Number(a) - Number(b)) : null],
    queryFn: async () => {
      if (playerId == null || !gameweek) return []
      let query = supabase
        .from('manager_picks')
        .select('manager_id')
        .eq('player_id', playerId)
        .eq('gameweek', gameweek)
        .lte('position', 11)
      if (leagueIds.length > 0) {
        query = query.in('manager_id', leagueIds)
      }
      const { data, error } = await query
      if (error) throw error
      return [...new Set((data || []).map((r) => r.manager_id))]
    },
    enabled: playerId != null && !!gameweek && (leagueManagerIds == null || leagueIds.length > 0),
    staleTime: 60000,
  })

  const leagueOwnershipPct =
    leagueManagerCount != null &&
    leagueManagerCount > 0 &&
    managerIdsOwningPlayer.length >= 0
      ? Math.round((managerIdsOwningPlayer.length / leagueManagerCount) * 1000) / 10
      : null

  const main = useQuery({
    queryKey: ['player-detail', playerId, gameweek],
    queryFn: async () => {
      if (!playerId || !gameweek) return null

      const [playerRes, priceRes, ranksRes, statsRes, historyRes] = await Promise.all([
        supabase
          .from('players')
          .select('fpl_player_id, web_name, position, team_id, teams(short_name), selected_by_percent')
          .eq('fpl_player_id', playerId)
          .single(),
        supabase
          .from('player_prices')
          .select('price_tenths')
          .eq('player_id', playerId)
          .eq('gameweek', gameweek)
          .order('recorded_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase.rpc('get_player_season_ranks', { p_player_id: playerId, p_gameweek: gameweek }).maybeSingle(),
        supabase
          .from('player_gameweek_stats')
          .select('gameweek, total_points')
          .eq('player_id', playerId)
          .lte('gameweek', gameweek),
        supabase
          .from('player_gameweek_stats')
          .select(
            'gameweek, total_points, goals_scored, assists, clean_sheets, saves, bps, bonus, defensive_contribution, yellow_cards, red_cards, expected_goals, expected_assists, expected_goal_involvements, expected_goals_conceded'
          )
          .eq('player_id', playerId)
          .order('gameweek', { ascending: true }),
      ])

      if (playerRes.error) throw playerRes.error
      if (!playerRes.data) return null

      const player = playerRes.data
      let priceTenths = priceRes.data?.price_tenths ?? null
      if (priceTenths == null) {
        const fallback = await supabase
          .from('player_prices')
          .select('price_tenths')
          .eq('player_id', playerId)
          .order('gameweek', { ascending: false })
          .order('recorded_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        priceTenths = fallback.data?.price_tenths ?? null
      }
      if (priceTenths == null && player.cost_tenths != null) {
        priceTenths = player.cost_tenths
      }
      const currentPrice = priceTenths != null ? priceTenths / 10 : null

      const overallRank = ranksRes.data?.overall_rank ?? null
      const positionRank = ranksRes.data?.position_rank ?? null

      let seasonPoints = 0
      ;(statsRes.data || []).forEach((r) => {
        seasonPoints += r.total_points ?? 0
      })

      const byGw = new Map()
      ;(historyRes.data || []).forEach((r) => {
        const gw = r.gameweek
        const cur = byGw.get(gw) || {
          points: 0,
          goals: 0,
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
        }
        cur.points += r.total_points ?? 0
        cur.goals += r.goals_scored ?? 0
        cur.assists += r.assists ?? 0
        cur.clean_sheets += r.clean_sheets ?? 0
        cur.saves += r.saves ?? 0
        cur.bps += r.bps ?? 0
        cur.bonus += r.bonus ?? 0
        cur.defensive_contribution += r.defensive_contribution ?? 0
        cur.yellow_cards += r.yellow_cards ?? 0
        cur.red_cards += r.red_cards ?? 0
        cur.expected_goals += Number(r.expected_goals) || 0
        cur.expected_assists += Number(r.expected_assists) || 0
        cur.expected_goal_involvements += Number(r.expected_goal_involvements) || 0
        cur.expected_goals_conceded += Number(r.expected_goals_conceded) || 0
        byGw.set(gw, cur)
      })
      const gameweekPoints = Array.from(byGw.entries())
        .map(([gw, cur]) => ({
          gameweek: gw,
          points: cur.points,
          goals: cur.goals,
          assists: cur.assists,
          goal_involvements: cur.goals + cur.assists,
          clean_sheets: cur.clean_sheets,
          saves: cur.saves,
          bps: cur.bps,
          bonus: cur.bonus,
          defensive_contribution: cur.defensive_contribution,
          yellow_cards: cur.yellow_cards,
          red_cards: cur.red_cards,
          expected_goals: cur.expected_goals,
          expected_assists: cur.expected_assists,
          expected_goal_involvements: cur.expected_goal_involvements,
          expected_goals_conceded: cur.expected_goals_conceded,
        }))
        .sort((a, b) => a.gameweek - b.gameweek)

      const overallOwnershipPct =
        player.selected_by_percent != null ? Math.round(Number(player.selected_by_percent) * 10) / 10 : null

      return {
        player: {
          web_name: player.web_name,
          position: player.position,
          positionLabel: POSITION_LABELS[player.position] ?? '—',
          team_short_name: player.teams?.short_name ?? null,
        },
        currentPrice,
        seasonPoints,
        overallRank: overallRank != null ? Number(overallRank) : null,
        positionRank: positionRank != null ? Number(positionRank) : null,
        gameweekPoints,
        overallOwnershipPct,
      }
    },
    enabled: !!playerId && !!gameweek,
    staleTime: 60000,
  })

  const loading = main.isLoading || ownershipLoading
  const detail = main.data

  return {
    ...detail,
    leagueOwnershipPct,
    leagueManagerCount: leagueManagerCount ?? null,
    loading,
    error: main.error,
  }
}
