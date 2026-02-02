import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

const byPointsDesc = (a, b) =>
  (b.points - a.points) || (a.position - b.position) || (a.player_name || '').localeCompare(b.player_name || '')

/**
 * Fetches last H2H (reverse fixture) player stats from mv_last_h2h_player_stats for the current gameweek.
 * Used when H2H toggle is on and fixture is scheduled: expanded table shows player stats from the reverse fixture.
 * Returns a map: fpl_fixture_id → { homePlayers, awayPlayers } in the same shape as useFixturePlayerStats.
 */
export function useLastH2HPlayerStats(gameweek, enabled) {
  const isSecondHalf = gameweek != null && Number(gameweek) >= 20

  const { data: byFixture = {}, isLoading, error } = useQuery({
    queryKey: ['last-h2h-player-stats', gameweek],
    queryFn: async () => {
      if (!gameweek || !isSecondHalf) return {}

      const { data: rows, error: mvError } = await supabase
        .from('mv_last_h2h_player_stats')
        .select('*')
        .eq('gameweek', Number(gameweek))

      if (mvError) throw mvError
      if (!rows?.length) return {}

      const playerIds = [...new Set(rows.map(r => r.player_id))]
      const { data: players, error: playersError } = await supabase
        .from('players')
        .select(`
          fpl_player_id,
          web_name,
          position,
          team_id,
          teams(short_name)
        `)
        .in('fpl_player_id', playerIds)

      if (playersError) throw playersError
      const playerMap = {}
      ;(players || []).forEach(p => {
        playerMap[p.fpl_player_id] = {
          web_name: p.web_name,
          position: p.position,
          team_id: p.team_id,
          short_name: p.teams?.short_name ?? null
        }
      })

      const byFixtureId = {}
      for (const r of rows) {
        const fid = r.fpl_fixture_id
        if (!byFixtureId[fid]) byFixtureId[fid] = { homePlayers: [], awayPlayers: [] }
        const info = playerMap[r.player_id] || {}
        const player = {
          player_id: r.player_id,
          team_id: r.team_id,
          player_name: info.web_name || 'Unknown',
          position: info.position ?? 0,
          player_team_short_name: info.short_name,
          minutes: r.minutes ?? 0,
          points: r.total_points ?? 0,
          goals_scored: r.goals_scored ?? 0,
          assists: r.assists ?? 0,
          clean_sheets: r.clean_sheets ?? 0,
          saves: r.saves ?? 0,
          bps: r.bps ?? 0,
          bonus: r.bonus ?? 0,
          bonus_status: 'confirmed',
          defensive_contribution: r.defensive_contribution ?? 0,
          yellow_cards: r.yellow_cards ?? 0,
          red_cards: r.red_cards ?? 0,
          defcon_points_achieved: false,
          expected_goals: Number(r.expected_goals) || 0,
          expected_assists: Number(r.expected_assists) || 0,
          expected_goal_involvements: Number(r.expected_goal_involvements) || 0,
          expected_goals_conceded: Number(r.expected_goals_conceded) || 0
        }
        // Assign by reverse fixture home/away (last meeting); frontend swaps to current perspective
        if (r.team_id === r.reverse_home_team_id) byFixtureId[fid].homePlayers.push(player)
        else byFixtureId[fid].awayPlayers.push(player)
      }
      for (const fid of Object.keys(byFixtureId)) {
        byFixtureId[fid].homePlayers.sort(byPointsDesc)
        byFixtureId[fid].awayPlayers.sort(byPointsDesc)
      }
      return byFixtureId
    },
    enabled: !!enabled && !!gameweek && isSecondHalf,
    staleTime: 5 * 60 * 1000
  })

  return {
    lastH2HPlayerStatsByFixture: byFixture,
    loading: isLoading,
    error
  }
}
