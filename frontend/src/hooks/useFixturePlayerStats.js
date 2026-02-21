import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useRefreshState } from './useRefreshState'

/**
 * Map API preloaded stats (from backend /api/v1/fixtures) to homePlayers/awayPlayers shape.
 */
function mapPreloadedToHomeAway(preloaded, homeTeamId, awayTeamId) {
  if (!Array.isArray(preloaded) || !preloaded.length) return { homePlayers: [], awayPlayers: [] }
  const byPointsDesc = (a, b) => (b.points - a.points) || (a.position - b.position) || (a.player_name || '').localeCompare(b.player_name || '')
  const rows = preloaded.map((r) => ({
    player_id: r.player_id,
    fixture_id: r.fixture_id,
    team_id: r.team_id,
    player_name: r.web_name ?? 'Unknown',
    position: r.position ?? 0,
    player_team_short_name: r.team_short_name ?? null,
    minutes: r.minutes ?? 0,
    points: r.total_points ?? r.effective_total_points ?? 0,
    goals_scored: r.goals_scored ?? 0,
    assists: r.assists ?? 0,
    clean_sheets: r.clean_sheets ?? 0,
    saves: r.saves ?? 0,
    bps: r.bps ?? 0,
    bonus: 0,
    bonus_status: 'provisional',
    defensive_contribution: r.defensive_contribution ?? 0,
    yellow_cards: r.yellow_cards ?? 0,
    red_cards: r.red_cards ?? 0,
    defcon_points_achieved: false,
    expected_goals: Number(r.expected_goals) || 0,
    expected_assists: Number(r.expected_assists) || 0,
    expected_goal_involvements: Number(r.expected_goal_involvements) || 0,
    expected_goals_conceded: Number(r.expected_goals_conceded) || 0
  }))
  const homeId = Number(homeTeamId)
  const awayId = Number(awayTeamId)
  const homePlayers = rows.filter((r) => Number(r.team_id) === homeId).sort(byPointsDesc)
  const awayPlayers = rows.filter((r) => Number(r.team_id) === awayId).sort(byPointsDesc)
  return { homePlayers, awayPlayers }
}

/**
 * Fetches player gameweek stats for a single fixture, split into home and away teams.
 * Used for the expanded "Show details" player tables on the Matches page.
 * When preloadedFixtureStats is provided (from useFixturesWithTeams API response), no Supabase call is made.
 */
export function useFixturePlayerStats(fixtureId, gameweek, homeTeamId, awayTeamId, enabled, preloadedFixtureStats = null) {
  const { state: refreshState } = useRefreshState()
  const isLive = refreshState === 'live_matches' || refreshState === 'bonus_pending'
  // When live, always use Supabase so Matches/Bonus get fresh data; ignore API preloaded (MV is stale during live).
  const hasPreloaded = !isLive && Array.isArray(preloadedFixtureStats) && preloadedFixtureStats.length > 0 && !!homeTeamId && !!awayTeamId

  const { data, isLoading, error } = useQuery({
    queryKey: ['fixture-player-stats', fixtureId, gameweek],
    queryFn: async () => {
      if (!fixtureId || !gameweek) return { homePlayers: [], awayPlayers: [] }

      const { data: stats, error: statsError } = await supabase
        .from('player_gameweek_stats')
        .select(`
          player_id,
          fixture_id,
          team_id,
          minutes,
          total_points,
          goals_scored,
          assists,
          clean_sheets,
          saves,
          bps,
          bonus,
          bonus_status,
          provisional_bonus,
          defensive_contribution,
          yellow_cards,
          red_cards,
          defcon_points_achieved,
          expected_goals,
          expected_assists,
          expected_goal_involvements,
          expected_goals_conceded
        `)
        .eq('fixture_id', fixtureId)
        .eq('gameweek', gameweek)

      if (statsError) throw statsError
      if (!stats?.length) return { homePlayers: [], awayPlayers: [] }

      const playerIds = [...new Set(stats.map(s => s.player_id))]
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

      const rows = stats.map(s => {
        const info = playerMap[s.player_id] || {}
        const bonusStatus = s.bonus_status ?? 'provisional'
        const provisionalBonus = Number(s.provisional_bonus) || 0
        const officialBonus = Number(s.bonus) || 0
        const isBonusConfirmed = bonusStatus === 'confirmed'
        const bonusToAdd = provisionalBonus || officialBonus
        const displayPoints = isBonusConfirmed ? (s.total_points ?? 0) : (s.total_points ?? 0) + bonusToAdd
        const displayBonus = isBonusConfirmed ? officialBonus : bonusToAdd
        return {
          player_id: s.player_id,
          fixture_id: s.fixture_id ?? fixtureId,
          team_id: s.team_id,
          player_name: info.web_name || 'Unknown',
          position: info.position ?? 0,
          player_team_short_name: info.short_name,
          minutes: s.minutes ?? 0,
          points: displayPoints,
          goals_scored: s.goals_scored ?? 0,
          assists: s.assists ?? 0,
          clean_sheets: s.clean_sheets ?? 0,
          saves: s.saves ?? 0,
          bps: s.bps ?? 0,
          bonus: displayBonus,
          bonus_status: bonusStatus,
          defensive_contribution: s.defensive_contribution ?? 0,
          yellow_cards: s.yellow_cards ?? 0,
          red_cards: s.red_cards ?? 0,
          defcon_points_achieved: s.defcon_points_achieved ?? false,
          expected_goals: Number(s.expected_goals) || 0,
          expected_assists: Number(s.expected_assists) || 0,
          expected_goal_involvements: Number(s.expected_goal_involvements) || 0,
          expected_goals_conceded: Number(s.expected_goals_conceded) || 0
        }
      })

      const byPointsDesc = (a, b) => (b.points - a.points) || (a.position - b.position) || a.player_name.localeCompare(b.player_name)
      const homePlayers = rows.filter(r => r.team_id === homeTeamId).sort(byPointsDesc)
      const awayPlayers = rows.filter(r => r.team_id === awayTeamId).sort(byPointsDesc)

      return { homePlayers, awayPlayers }
    },
    enabled: !!enabled && !!fixtureId && !!gameweek && !!homeTeamId && !!awayTeamId && !hasPreloaded,
    staleTime: isLive ? 20 * 1000 : 30000,
    refetchInterval: isLive ? 25 * 1000 : false,
    refetchIntervalInBackground: isLive
  })

  if (hasPreloaded && enabled) {
    const { homePlayers, awayPlayers } = mapPreloadedToHomeAway(preloadedFixtureStats, homeTeamId, awayTeamId)
    return { homePlayers, awayPlayers, loading: false, error: null }
  }

  return {
    homePlayers: data?.homePlayers ?? [],
    awayPlayers: data?.awayPlayers ?? [],
    loading: isLoading,
    error
  }
}
