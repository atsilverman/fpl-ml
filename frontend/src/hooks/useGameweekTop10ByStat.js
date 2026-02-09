import { useQuery } from '@tanstack/react-query'
import { useGameweekData } from './useGameweekData'
import { useRefreshState } from './useRefreshState'
import { supabase } from '../lib/supabase'

/**
 * Aggregate per-fixture rows into one row per player (sum stats across DGW fixtures).
 * So "top 10" is by player gameweek totals, not by single-fixture rows.
 */
function aggregateByPlayer(rows) {
  if (!rows || rows.length === 0) return []
  const byPlayer = new Map()
  for (const row of rows) {
    const id = row.player_id
    if (id == null) continue
    const key = Number(id)
    const existing = byPlayer.get(key)
    if (!existing) {
      const totalPoints = Number(row.total_points) || 0
      const bonusStatus = row.bonus_status ?? 'provisional'
      const officialBonus = Number(row.bonus) ?? 0
      const isBonusConfirmed = bonusStatus === 'confirmed' || officialBonus > 0
      const provisionalBonus = Number(row.provisional_bonus) || 0
      const effective_total_points = isBonusConfirmed ? totalPoints : totalPoints + provisionalBonus
      byPlayer.set(key, {
        player_id: id,
        total_points: totalPoints,
        bonus: officialBonus,
        provisional_bonus: provisionalBonus,
        effective_total_points,
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
      const totalPoints = Number(row.total_points) || 0
      const bonusStatus = row.bonus_status ?? 'provisional'
      const officialBonus = Number(row.bonus) ?? 0
      const isBonusConfirmed = bonusStatus === 'confirmed' || officialBonus > 0
      const provisionalBonus = Number(row.provisional_bonus) || 0
      const rowEffective = isBonusConfirmed ? totalPoints : totalPoints + provisionalBonus
      existing.total_points += totalPoints
      existing.bonus += officialBonus
      existing.provisional_bonus += provisionalBonus
      existing.effective_total_points += rowEffective
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
 * For each stat column, returns the set of player_id that are in the top 10 for that stat in the gameweek.
 * Used so the green "top 10" badge is only shown when the player is actually top 10 for that specific column.
 * For pts we use effective_total_points when present (total_points + provisional_bonus when bonus not confirmed)
 * so the badge matches the displayed points during live/provisional scoring.
 * Expects one row per player (e.g. from aggregateByPlayer).
 */
function computeTop10ByStat(rows) {
  const out = {
    pts: new Set(),
    goals: new Set(),
    assists: new Set(),
    clean_sheets: new Set(),
    saves: new Set(),
    bps: new Set(),
    bonus: new Set(),
    defensive_contribution: new Set(),
    yellow_cards: new Set(),
    red_cards: new Set(),
    expected_goals: new Set(),
    expected_assists: new Set(),
    expected_goal_involvements: new Set(),
    expected_goals_conceded: new Set()
  }
  if (!rows || rows.length === 0) return out

  const keyToCol = {
    pts: 'effective_total_points',
    goals: 'goals_scored',
    assists: 'assists',
    clean_sheets: 'clean_sheets',
    saves: 'saves',
    bps: 'bps',
    bonus: 'bonus',
    defensive_contribution: 'defensive_contribution',
    yellow_cards: 'yellow_cards',
    red_cards: 'red_cards',
    expected_goals: 'expected_goals',
    expected_assists: 'expected_assists',
    expected_goal_involvements: 'expected_goal_involvements',
    expected_goals_conceded: 'expected_goals_conceded'
  }

  const lowerIsBetter = new Set(['expected_goals_conceded'])

  for (const statKey of Object.keys(keyToCol)) {
    const col = keyToCol[statKey]
    const desc = !lowerIsBetter.has(statKey)
    const sorted = [...rows].sort((a, b) => {
      const av = statKey === 'pts'
        ? (Number(a.effective_total_points) || Number(a.total_points) || 0)
        : (Number(a[col]) || 0)
      const bv = statKey === 'pts'
        ? (Number(b.effective_total_points) || Number(b.total_points) || 0)
        : (Number(b[col]) || 0)
      return desc ? bv - av : av - bv
    })
    const top10 = sorted.slice(0, 10)
    top10.forEach((row) => {
      const id = row.player_id
      if (id != null) out[statKey].add(Number(id))
    })
  }

  return out
}

/**
 * Returns { top10ByStat } where each value is a Set of player_id in the top 10 for that stat in the gameweek.
 */
export function useGameweekTop10ByStat() {
  const { gameweek, loading: gwLoading } = useGameweekData()
  const { state: refreshState } = useRefreshState()

  const isLive = refreshState === 'live_matches' || refreshState === 'bonus_pending'

  const { data: top10ByStat, isLoading } = useQuery({
    queryKey: ['gameweek-top10-by-stat', gameweek],
    queryFn: async () => {
      if (!gameweek) return computeTop10ByStat([])

      const { data, error } = await supabase
        .from('player_gameweek_stats')
        .select(
          'player_id, total_points, bonus_status, provisional_bonus, bonus, goals_scored, assists, clean_sheets, saves, bps, defensive_contribution, yellow_cards, red_cards, expected_goals, expected_assists, expected_goal_involvements, expected_goals_conceded'
        )
        .eq('gameweek', gameweek)

      if (error) {
        console.error('Error fetching gameweek stats for top 10 by stat:', error)
        return computeTop10ByStat([])
      }

      // Aggregate by player so DGW players are ranked by gameweek totals, not per-fixture rows
      const aggregated = aggregateByPlayer(data || [])
      return computeTop10ByStat(aggregated)
    },
    enabled: !!gameweek && !gwLoading,
    staleTime: isLive ? 25 * 1000 : 60 * 1000,
    refetchInterval: isLive ? 25 * 1000 : false,
    refetchIntervalInBackground: true
  })

  return {
    top10ByStat: top10ByStat ?? computeTop10ByStat([]),
    isLoading: isLoading || gwLoading
  }
}
