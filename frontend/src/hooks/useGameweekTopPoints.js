import { useQuery } from '@tanstack/react-query'
import { useGameweekData } from './useGameweekData'
import { useRefreshState } from './useRefreshState'
import { supabase } from '../lib/supabase'

const TOP_LIMIT = 5

/**
 * Returns top N players by FPL points in the gameweek (badge, name, points).
 * Refetches more often during live games so the list updates continuously.
 */
export function useGameweekTopPoints() {
  const { gameweek, loading: gwLoading } = useGameweekData()
  const { state: refreshState } = useRefreshState()
  const isLive = refreshState === 'live_matches' || refreshState === 'bonus_pending'

  const { data: list, isLoading } = useQuery({
    queryKey: ['gameweek-top-points', gameweek],
    queryFn: async () => {
      if (!gameweek) return []

      const { data: stats, error: statsError } = await supabase
        .from('player_gameweek_stats')
        .select('player_id, fixture_id, total_points, bonus_status, provisional_bonus')
        .eq('gameweek', gameweek)
        .order('total_points', { ascending: false })
        .limit(TOP_LIMIT)

      if (statsError) {
        console.error('Error fetching gameweek top points:', statsError)
        return []
      }
      if (!stats?.length) return []

      const playerIds = [...new Set(stats.map((s) => s.player_id))]
      const { data: players, error: playersError } = await supabase
        .from('players')
        .select('fpl_player_id, web_name, team_id, position, teams!fk_players_team(short_name)')
        .in('fpl_player_id', playerIds)

      if (playersError) {
        console.error('Error fetching players for top points:', playersError)
        return []
      }

      const POSITION_LABELS = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' }
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

      return stats.map((s) => {
        const info = playerMap[s.player_id] || { web_name: 'Unknown', team_short_name: null, position: null, position_label: '—' }
        const bonusStatus = s.bonus_status ?? 'provisional'
        const provisionalBonus = Number(s.provisional_bonus) || 0
        const officialBonus = Number(s.bonus) ?? 0
        const isBonusConfirmed = bonusStatus === 'confirmed'
        const bonusToAdd = provisionalBonus || officialBonus
        const displayPoints = isBonusConfirmed ? (s.total_points ?? 0) : (s.total_points ?? 0) + bonusToAdd

        return {
          player_id: s.player_id,
          fixture_id: s.fixture_id ?? null,
          player_name: info.web_name,
          team_short_name: info.team_short_name,
          position: info.position,
          position_label: info.position_label,
          total_points: displayPoints
        }
      })
    },
    enabled: !!gameweek && !gwLoading,
    staleTime: isLive ? 20 * 1000 : 60 * 1000,
    refetchInterval: isLive ? 25 * 1000 : false
  })

  return {
    topPoints: list ?? [],
    isLoading: isLoading || gwLoading
  }
}
