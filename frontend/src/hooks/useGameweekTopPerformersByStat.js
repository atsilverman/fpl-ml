import { useQuery } from '@tanstack/react-query'
import { useGameweekData } from './useGameweekData'
import { useRefreshState } from './useRefreshState'
import { supabase } from '../lib/supabase'

const TOP_LIMIT = 5

const POSITION_LABELS = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' }

/** Order: Points, xG, xA, BPS, DEFCON (5 pages). Goals/Assists omitted – too many players with 1G/1A. */
export const TOP_PERFORMERS_STAT_KEYS = [
  { key: 'points', label: 'Points', col: 'total_points' },
  { key: 'xg', label: 'xG', col: 'expected_goals' },
  { key: 'xa', label: 'xA', col: 'expected_assists' },
  { key: 'bps', label: 'BPS', col: 'bps' },
  { key: 'defcon', label: 'DEFCON', col: 'defensive_contribution' }
]

function formatExpected(v) {
  const n = Number(v)
  if (n === 0) return '0'
  return n.toFixed(2)
}

/**
 * Returns top 5 players per stat for the gameweek (Points, xG, xA, BPS, DEFCON).
 * Single query + client-side sort/slice so matchup page and leaderboard stay in sync with same table.
 * Refetches more often during live.
 */
export function useGameweekTopPerformersByStat() {
  const { gameweek, loading: gwLoading } = useGameweekData()
  const { state: refreshState } = useRefreshState()
  const isLive = refreshState === 'live_matches' || refreshState === 'bonus_pending'

  const { data: byStat, isLoading } = useQuery({
    queryKey: ['gameweek-top-performers-by-stat', gameweek],
    queryFn: async () => {
      if (!gameweek) return _emptyByStat()

      const { data: stats, error: statsError } = await supabase
        .from('player_gameweek_stats')
        .select(
          'player_id, fixture_id, total_points, bonus_status, provisional_bonus, goals_scored, assists, expected_goals, expected_assists, bps, defensive_contribution'
        )
        .eq('gameweek', gameweek)

      if (statsError) {
        console.error('Error fetching gameweek top performers:', statsError)
        return _emptyByStat()
      }
      if (!stats?.length) return _emptyByStat()

      const playerIds = [...new Set(stats.map((s) => s.player_id))]
      const { data: players, error: playersError } = await supabase
        .from('players')
        .select('fpl_player_id, web_name, team_id, position, teams(short_name)')
        .in('fpl_player_id', playerIds)

      if (playersError) {
        console.error('Error fetching players for top performers:', playersError)
        return _emptyByStat()
      }

      const playerMap = {}
      ;(players || []).forEach((p) => {
        const pos = p.position != null ? Number(p.position) : null
        playerMap[p.fpl_player_id] = {
          web_name: p.web_name ?? 'Unknown',
          team_short_name: p.teams?.short_name ?? null,
          position: pos,
          position_label: pos != null ? (POSITION_LABELS[pos] ?? '—') : '—'
        }
      })

      const rows = stats.map((s) => {
        const info = playerMap[s.player_id] || { web_name: 'Unknown', team_short_name: null, position: null, position_label: '—' }
        const bonusStatus = s.bonus_status ?? 'provisional'
        const provisionalBonus = Number(s.provisional_bonus) || 0
        const displayPoints =
          bonusStatus === 'confirmed' || (s.bonus ?? 0) > 0
            ? (s.total_points ?? 0)
            : (s.total_points ?? 0) + provisionalBonus
        return {
          player_id: s.player_id,
          fixture_id: s.fixture_id ?? null,
          player_name: info.web_name,
          team_short_name: info.team_short_name,
          position: info.position,
          position_label: info.position_label,
          total_points: displayPoints,
          goals_scored: s.goals_scored ?? 0,
          assists: s.assists ?? 0,
          expected_goals: Number(s.expected_goals) || 0,
          expected_assists: Number(s.expected_assists) || 0,
          bps: s.bps ?? 0,
          defensive_contribution: s.defensive_contribution ?? 0
        }
      })

      const result = _emptyByStat()
      for (const { key, col } of TOP_PERFORMERS_STAT_KEYS) {
        const desc = true
        const sorted = [...rows].sort((a, b) => {
          const av = a[col] ?? 0
          const bv = b[col] ?? 0
          if (typeof av === 'number' && typeof bv === 'number') return desc ? bv - av : av - bv
          return desc ? (bv > av ? 1 : -1) : (av > bv ? 1 : -1)
        })
        const top5 = sorted.slice(0, TOP_LIMIT).map((r) => ({
          player_id: r.player_id,
          fixture_id: r.fixture_id ?? null,
          player_name: r.player_name,
          team_short_name: r.team_short_name,
          position: r.position,
          position_label: r.position_label,
          value: key === 'xg' || key === 'xa' ? formatExpected(r[col]) : (r[col] ?? 0)
        }))
        result[key] = top5
      }
      return result
    },
    enabled: !!gameweek && !gwLoading,
    staleTime: isLive ? 20 * 1000 : 60 * 1000,
    refetchInterval: isLive ? 25 * 1000 : false
  })

  return {
    byStat: byStat ?? _emptyByStat(),
    isLoading: isLoading || gwLoading
  }
}

function _emptyByStat() {
  const o = {}
  TOP_PERFORMERS_STAT_KEYS.forEach(({ key }) => { o[key] = [] })
  return o
}
