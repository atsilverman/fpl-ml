import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useGameweekData } from './useGameweekData'
import { useRefreshState } from './useRefreshState'
import { supabase } from '../lib/supabase'

const PAGE_SIZE = 5000

/**
 * Aggregate per-fixture rows into one row per player (sum stats across DGW fixtures).
 * @param {Array} rows - raw stats rows (must already be filtered by GW range and location if needed)
 * @param {string} locationFilter - 'all' | 'home' | 'away'
 */
function aggregateByPlayer(rows, locationFilter = 'all') {
  if (!rows || rows.length === 0) return []
  const byPlayer = new Map()
  for (const row of rows) {
    if (locationFilter === 'home' && !row.was_home) continue
    if (locationFilter === 'away' && row.was_home) continue
    const id = row.player_id
    if (id == null) continue
    const key = Number(id)
    const existing = byPlayer.get(key)
    const totalPoints = Number(row.total_points) || 0
    const bonusStatus = row.bonus_status ?? 'provisional'
    const officialBonus = Number(row.bonus) ?? 0
    const isBonusConfirmed = bonusStatus === 'confirmed' || officialBonus > 0
    const provisionalBonus = Number(row.provisional_bonus) || 0
    const effective = isBonusConfirmed ? totalPoints : totalPoints + provisionalBonus
    const minutes = Number(row.minutes) || 0
    if (!existing) {
      byPlayer.set(key, {
        player_id: id,
        total_points: totalPoints,
        bonus: officialBonus,
        provisional_bonus: provisionalBonus,
        effective_total_points: effective,
        minutes,
        goals_scored: Number(row.goals_scored) || 0,
        assists: Number(row.assists) || 0,
        clean_sheets: Number(row.clean_sheets) || 0,
        saves: Number(row.saves) || 0,
        bps: Number(row.bps) || 0,
        defensive_contribution: Number(row.defensive_contribution) || 0,
        yellow_cards: Number(row.yellow_cards) || 0,
        red_cards: Number(row.red_cards) || 0,
        expected_goals: Number(row.expected_goals) || 0,
        expected_assists: Number(row.expected_assists) || 0,
        expected_goal_involvements: Number(row.expected_goal_involvements) || 0,
        expected_goals_conceded: Number(row.expected_goals_conceded) || 0
      })
    } else {
      existing.total_points += totalPoints
      existing.bonus += officialBonus
      existing.provisional_bonus += provisionalBonus
      existing.effective_total_points += effective
      existing.minutes += minutes
      existing.goals_scored += Number(row.goals_scored) || 0
      existing.assists += Number(row.assists) || 0
      existing.clean_sheets += Number(row.clean_sheets) || 0
      existing.saves += Number(row.saves) || 0
      existing.bps += Number(row.bps) || 0
      existing.defensive_contribution += Number(row.defensive_contribution) || 0
      existing.yellow_cards += Number(row.yellow_cards) || 0
      existing.red_cards += Number(row.red_cards) || 0
      existing.expected_goals += Number(row.expected_goals) || 0
      existing.expected_assists += Number(row.expected_assists) || 0
      existing.expected_goal_involvements += Number(row.expected_goal_involvements) || 0
      existing.expected_goals_conceded += Number(row.expected_goals_conceded) || 0
    }
  }
  return Array.from(byPlayer.values())
}

/**
 * Fetches full raw stats (GW 1 to current) and players once per gameweek; derives
 * All / Last 6 / Last 12 and location in memory so filter switches are instant.
 * @param {'all'|'last6'|'last12'} gwFilter - GW range
 * @param {'all'|'home'|'away'} locationFilter - filter by was_home
 */
export function useAllPlayersGameweekStats(gwFilter = 'all', locationFilter = 'all') {
  const { gameweek, loading: gwLoading } = useGameweekData()
  const { state: refreshState } = useRefreshState()
  const isLive = refreshState === 'live_matches' || refreshState === 'bonus_pending'

  const { data: cache, isLoading } = useQuery({
    queryKey: ['all-players-gameweek-stats-full', gameweek],
    queryFn: async () => {
      if (!gameweek) return null
      const gw = Number(gameweek)

      const baseQuery = supabase
        .from('player_gameweek_stats')
        .select(
          'gameweek, player_id, was_home, total_points, bonus_status, provisional_bonus, bonus, minutes, goals_scored, assists, clean_sheets, saves, bps, defensive_contribution, yellow_cards, red_cards, expected_goals, expected_assists, expected_goal_involvements, expected_goals_conceded'
        )
        .gte('gameweek', 1)
        .lte('gameweek', gw)
        .order('gameweek', { ascending: true })

      let stats = []
      let offset = 0
      while (true) {
        const { data: page, error: statsError } = await baseQuery.range(offset, offset + PAGE_SIZE - 1)
        if (statsError) {
          console.error('Error fetching gameweek stats for all players:', statsError)
          return null
        }
        const list = page || []
        stats = stats.concat(list)
        if (list.length < PAGE_SIZE) break
        offset += PAGE_SIZE
      }

      const playerIds = [...new Set(stats.map((r) => r.player_id).filter(Boolean))]
      if (playerIds.length === 0) return { rawStats: [], playerMap: {} }

      const { data: players, error: playersError } = await supabase
        .from('players')
        .select('fpl_player_id, web_name, team_id, position, cost_tenths, teams(short_name)')
        .in('fpl_player_id', playerIds)

      if (playersError) {
        console.error('Error fetching players for stats table:', playersError)
        return { rawStats: stats, playerMap: {} }
      }

      const playerMap = {}
      ;(players || []).forEach((p) => {
        playerMap[p.fpl_player_id] = {
          web_name: p.web_name ?? 'Unknown',
          team_short_name: p.teams?.short_name ?? null,
          position: p.position != null ? Number(p.position) : null,
          cost_tenths: p.cost_tenths != null ? Number(p.cost_tenths) : null
        }
      })

      // Fallback: current price from player_prices for this gameweek (when players.cost_tenths is null)
      const needPrice = playerIds.filter((id) => playerMap[id]?.cost_tenths == null)
      if (needPrice.length > 0) {
        const { data: priceRows } = await supabase
          .from('player_prices')
          .select('player_id, price_tenths, recorded_at')
          .eq('gameweek', gw)
          .in('player_id', needPrice)
          .order('recorded_at', { ascending: false })
        if (priceRows?.length) {
          const byPlayer = new Map()
          for (const row of priceRows) {
            if (row.player_id != null && !byPlayer.has(row.player_id) && row.price_tenths != null) {
              byPlayer.set(row.player_id, Number(row.price_tenths))
            }
          }
          byPlayer.forEach((tenths, id) => {
            if (playerMap[id]) playerMap[id].cost_tenths = tenths
          })
        }
      }

      return { rawStats: stats, playerMap }
    },
    enabled: !!gameweek && !gwLoading,
    staleTime: isLive ? 25 * 1000 : 2 * 60 * 1000,
    refetchInterval: isLive ? 25 * 1000 : false,
    refetchIntervalInBackground: true
  })

  const players = useMemo(() => {
    if (!cache?.rawStats?.length) return []
    const gw = Number(gameweek)
    let minGw = 1
    if (gwFilter === 'last6') minGw = Math.max(1, gw - 5)
    else if (gwFilter === 'last12') minGw = Math.max(1, gw - 11)
    const filtered = cache.rawStats.filter(
      (r) => r.gameweek >= minGw && r.gameweek <= gw
    )
    const aggregated = aggregateByPlayer(filtered, locationFilter)
    const { playerMap } = cache
    const mapped = aggregated.map((s) => {
      const info = playerMap[s.player_id] || { web_name: 'Unknown', team_short_name: null, position: null, cost_tenths: null }
      return {
        player_id: s.player_id,
        web_name: info.web_name,
        team_short_name: info.team_short_name,
        position: info.position,
        cost_tenths: info.cost_tenths,
        points: s.effective_total_points ?? s.total_points ?? 0,
        minutes: s.minutes ?? 0,
        goals_scored: s.goals_scored ?? 0,
        assists: s.assists ?? 0,
        clean_sheets: s.clean_sheets ?? 0,
        saves: s.saves ?? 0,
        bps: s.bps ?? 0,
        defensive_contribution: s.defensive_contribution ?? 0,
        yellow_cards: s.yellow_cards ?? 0,
        red_cards: s.red_cards ?? 0,
        expected_goals: s.expected_goals ?? 0,
        expected_assists: s.expected_assists ?? 0,
        expected_goal_involvements: s.expected_goal_involvements ?? 0,
        expected_goals_conceded: s.expected_goals_conceded ?? 0
      }
    })
    // Exclude players with all zero stats (did not play in the period)
    return mapped.filter(
      (p) =>
        (p.points ?? 0) !== 0 ||
        (p.minutes ?? 0) !== 0 ||
        (p.goals_scored ?? 0) !== 0 ||
        (p.assists ?? 0) !== 0 ||
        (p.clean_sheets ?? 0) !== 0 ||
        (p.saves ?? 0) !== 0 ||
        (p.bps ?? 0) !== 0 ||
        (p.defensive_contribution ?? 0) !== 0 ||
        (p.expected_goals ?? 0) !== 0 ||
        (p.expected_assists ?? 0) !== 0
    )
  }, [cache, gameweek, gwFilter, locationFilter])

  return {
    players,
    loading: isLoading || gwLoading
  }
}
