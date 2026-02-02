import { useQuery } from '@tanstack/react-query'
import { useGameweekData } from './useGameweekData'
import { useRefreshState } from './useRefreshState'
import { supabase } from '../lib/supabase'

const TOP_LIMIT = 5

/**
 * Returns top N players by BPS in the gameweek (badge, name, bps).
 * Refetches more often during live games so the list updates continuously.
 */
export function useGameweekTopBps() {
  const { gameweek, loading: gwLoading } = useGameweekData()
  const { state: refreshState } = useRefreshState()
  const isLive = refreshState === 'live_matches' || refreshState === 'bonus_pending'

  const { data: list, isLoading } = useQuery({
    queryKey: ['gameweek-top-bps', gameweek],
    queryFn: async () => {
      if (!gameweek) return []

      const { data: stats, error: statsError } = await supabase
        .from('player_gameweek_stats')
        .select('player_id, bps')
        .eq('gameweek', gameweek)
        .order('bps', { ascending: false })
        .limit(TOP_LIMIT)

      if (statsError) {
        console.error('Error fetching gameweek top BPS:', statsError)
        return []
      }
      if (!stats?.length) return []

      const playerIds = [...new Set(stats.map((s) => s.player_id))]
      const { data: players, error: playersError } = await supabase
        .from('players')
        .select('fpl_player_id, web_name, team_id, position, teams(short_name)')
        .in('fpl_player_id', playerIds)

      if (playersError) {
        console.error('Error fetching players for top BPS:', playersError)
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
        return {
          player_id: s.player_id,
          player_name: info.web_name,
          team_short_name: info.team_short_name,
          position: info.position,
          position_label: info.position_label,
          bps: s.bps ?? 0
        }
      })
    },
    enabled: !!gameweek && !gwLoading,
    staleTime: isLive ? 20 * 1000 : 60 * 1000,
    refetchInterval: isLive ? 25 * 1000 : false
  })

  return {
    topBps: list ?? [],
    isLoading: isLoading || gwLoading
  }
}
