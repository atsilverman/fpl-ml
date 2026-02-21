import { useQuery } from '@tanstack/react-query'
import { useGameweekData } from './useGameweekData'
import { useRefreshState } from './useRefreshState'
import { supabase } from '../lib/supabase'


/** Composite key for per-fixture row: "playerId-fixtureId" so DGW players are ranked per game. */
function rowKey(row) {
  const pid = row.player_id != null ? Number(row.player_id) : 0
  const fid = row.fixture_id != null && row.fixture_id !== 0 ? Number(row.fixture_id) : 0
  return `${pid}-${fid}`
}

/**
 * For each stat column, returns the set of "playerId-fixtureId" in the top 10 for that stat.
 * Per-fixture: no aggregation; each (player, fixture) row is ranked separately for DGW.
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
      out[statKey].add(rowKey(row))
    })
  }

  return out
}

/**
 * Returns { top10ByStat } where each value is a Set of "playerId-fixtureId" in the top 10 for that stat (per-fixture, no DGW aggregation).
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
          'player_id, fixture_id, total_points, bonus_status, provisional_bonus, bonus, goals_scored, assists, clean_sheets, saves, bps, defensive_contribution, yellow_cards, red_cards, expected_goals, expected_assists, expected_goal_involvements, expected_goals_conceded'
        )
        .eq('gameweek', gameweek)

      if (error) {
        console.error('Error fetching gameweek stats for top 10 by stat:', error)
        return computeTop10ByStat([])
      }

      const rows = (data || []).map((r) => {
        const totalPoints = Number(r.total_points) || 0
        const bonusStatus = r.bonus_status ?? 'provisional'
        const officialBonus = Number(r.bonus) ?? 0
        const isBonusConfirmed = bonusStatus === 'confirmed'
        const provisionalBonus = Number(r.provisional_bonus) ?? 0
        const bonusToAdd = provisionalBonus || officialBonus
        return {
          ...r,
          effective_total_points: isBonusConfirmed ? totalPoints : totalPoints + bonusToAdd
        }
      })
      return computeTop10ByStat(rows)
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
