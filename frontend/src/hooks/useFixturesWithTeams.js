import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { getApiBase } from '../lib/apiBase'
import { useRefreshState } from './useRefreshState'

/**
 * Apply simulated statuses to fixtures for UI testing (Scheduled / Live / Provisional / Final).
 * First 4 fixtures by order: [0]=scheduled, [1]=live, [2]=provisional, [3]=final.
 */
function applySimulatedStatuses(fixtures) {
  if (!fixtures?.length) return fixtures
  return fixtures.map((f, i) => {
    if (i === 0) {
      return { ...f, started: false, finished: false, finished_provisional: false, home_score: null, away_score: null }
    }
    if (i === 1) {
      return { ...f, started: true, finished: false, finished_provisional: false, home_score: 1, away_score: 0 }
    }
    if (i === 2) {
      return { ...f, started: true, finished: false, finished_provisional: true, home_score: 2, away_score: 1 }
    }
    if (i === 3) {
      return { ...f, started: true, finished: true, finished_provisional: true, home_score: 2, away_score: 0 }
    }
    return f
  })
}

/**
 * Fetches fixtures + player stats from Supabase. Returns { fixtures, playerStatsByFixture }.
 */
async function fetchFixturesFromSupabase(gameweek, simulateStatuses) {
  const { data: fixtures, error: fixturesError } = await supabase
    .from('fixtures')
    .select('*')
    .eq('gameweek', gameweek)
    .order('kickoff_time', { ascending: true })

  if (fixturesError) throw fixturesError
  if (!fixtures?.length) return { fixtures: [], playerStatsByFixture: {} }

  const teamIds = new Set()
  fixtures.forEach(f => {
    if (f.home_team_id) teamIds.add(f.home_team_id)
    if (f.away_team_id) teamIds.add(f.away_team_id)
  })

  const { data: teams, error: teamsError } = await supabase
    .from('teams')
    .select('team_id, short_name, team_name')
    .in('team_id', Array.from(teamIds))

  if (teamsError) throw teamsError
  const teamMap = {}
  ;(teams || []).forEach(t => {
    teamMap[t.team_id] = { short_name: t.short_name, team_name: t.team_name }
  })

  let list = fixtures.map(f => ({
    ...f,
    fpl_fixture_id: f.fpl_fixture_id ?? f.fixture_id,
    homeTeam: teamMap[f.home_team_id] || { short_name: null, team_name: null },
    awayTeam: teamMap[f.away_team_id] || { short_name: null, team_name: null }
  }))
  if (simulateStatuses) list = applySimulatedStatuses(list)

  const playerStatsByFixture = {}
  const { data: pgsRows, error: pgsError } = await supabase
    .from('player_gameweek_stats')
    .select('player_id, fixture_id, team_id, minutes, total_points, goals_scored, assists, clean_sheets, saves, bps, defensive_contribution, yellow_cards, red_cards, expected_goals, expected_assists, expected_goal_involvements, expected_goals_conceded, goals_conceded, bonus_status, bonus, provisional_bonus')
    .eq('gameweek', gameweek)

  if (!pgsError && pgsRows?.length) {
    const playerIds = [...new Set(pgsRows.map(r => r.player_id))]
    let playerMap = {}
    let teamShortMap = {}
    try {
      const [playersRes, teamsPRes] = await Promise.all([
        supabase.from('players').select('fpl_player_id, web_name, position').in('fpl_player_id', playerIds),
        supabase.from('teams').select('team_id, short_name').in('team_id', [...new Set(pgsRows.map(r => r.team_id).filter(Boolean))])
      ])
      playerMap = Object.fromEntries((playersRes.data ?? []).map(p => [p.fpl_player_id, p]))
      teamShortMap = Object.fromEntries((teamsPRes.data ?? []).map(t => [t.team_id, t.short_name]))
    } catch (_) {
      // Enrichment failed; still push stats with Unknown names so BPS/bonus show
    }
    for (const r of pgsRows) {
      const fid = r.fixture_id != null && r.fixture_id !== 0 ? Number(r.fixture_id) : null
      if (fid == null) continue
      const info = playerMap[r.player_id] ?? {}
      const bonusStatus = r.bonus_status ?? 'provisional'
      const provB = Number(r.provisional_bonus) ?? 0
      const offB = Number(r.bonus) ?? 0
      const totalPts = Number(r.total_points) ?? 0
      const effPts = (bonusStatus === 'confirmed' || offB > 0) ? totalPts : totalPts + provB
      const key = fid
      if (!playerStatsByFixture[key]) playerStatsByFixture[key] = []
      const displayBonus = (bonusStatus === 'confirmed' || offB > 0) ? offB : provB
      playerStatsByFixture[key].push({
        player_id: r.player_id,
        web_name: info.web_name ?? 'Unknown',
        position: info.position,
        fixture_id: fid,
        team_id: r.team_id,
        team_short_name: teamShortMap[r.team_id] ?? null,
        minutes: r.minutes,
        total_points: effPts,
        effective_total_points: effPts,
        bonus: displayBonus,
        bonus_status: bonusStatus,
        goals_scored: r.goals_scored,
        assists: r.assists,
        clean_sheets: r.clean_sheets,
        saves: r.saves,
        bps: r.bps,
        defensive_contribution: r.defensive_contribution,
        yellow_cards: r.yellow_cards,
        red_cards: r.red_cards,
        expected_goals: r.expected_goals,
        expected_assists: r.expected_assists,
        expected_goal_involvements: r.expected_goal_involvements,
        expected_goals_conceded: r.expected_goals_conceded,
        goals_conceded: r.goals_conceded
      })
    }
  }
  return { fixtures: list, playerStatsByFixture }
}

/**
 * Fetches fixtures for a gameweek with home/away team names and short_name for badges.
 * When API base is set, uses API first so playerStatsByFixture is complete for all fixtures
 * (including finished), then falls back to Supabase only if the API fails.
 * Optional simulateStatuses: when true, overrides first 4 fixtures to Scheduled / Live / Provisional / Final for UI testing.
 */
export function useFixturesWithTeams(gameweek, { simulateStatuses = false } = {}) {
  const { state: refreshState } = useRefreshState()
  const isLive = refreshState === 'live_matches' || refreshState === 'bonus_pending'

  const { data: result, isLoading, error } = useQuery({
    queryKey: ['fixtures-with-teams', gameweek, simulateStatuses],
    queryFn: async () => {
      const API_BASE = getApiBase()
      if (!gameweek) return API_BASE ? { fixtures: [], playerStatsByFixture: {} } : []

      if (API_BASE && !simulateStatuses) {
        const tryApi = async () => {
          const res = await fetch(`${API_BASE}/api/v1/fixtures?gameweek=${gameweek}`)
          const data = await res.json()
          if (!res.ok || !Array.isArray(data.fixtures)) throw new Error('API fixtures invalid')
          return { fixtures: data.fixtures ?? [], playerStatsByFixture: data.playerStatsByFixture ?? {} }
        }
        try {
          return await tryApi()
        } catch (_) {
          try {
            return await tryApi()
          } catch (__) {
            return await fetchFixturesFromSupabase(gameweek, false)
          }
        }
      }

      return fetchFixturesFromSupabase(gameweek, simulateStatuses)
    },
    enabled: !!gameweek,
    staleTime: isLive ? 15 * 1000 : 30000,
    refetchInterval: simulateStatuses ? false : (isLive ? 8 * 1000 : 30000),
    refetchIntervalInBackground: isLive
  })

  const isApiResult = result && typeof result === 'object' && !Array.isArray(result) && 'playerStatsByFixture' in result
  const fixtures = isApiResult ? (result.fixtures ?? []) : (Array.isArray(result) ? result : [])
  const playerStatsByFixture = isApiResult ? (result.playerStatsByFixture ?? {}) : undefined

  return {
    fixtures,
    loading: isLoading,
    error,
    playerStatsByFixture: playerStatsByFixture ?? undefined
  }
}
