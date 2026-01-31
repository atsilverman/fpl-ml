import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

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
 * Fetches fixtures for a gameweek with home/away team names and short_name for badges.
 * Optional simulateStatuses: when true, overrides first 4 fixtures to Scheduled / Live / Provisional / Final for UI testing.
 */
export function useFixturesWithTeams(gameweek, { simulateStatuses = false } = {}) {
  const { data: fixturesWithTeams = [], isLoading, error } = useQuery({
    queryKey: ['fixtures-with-teams', gameweek, simulateStatuses],
    queryFn: async () => {
      if (!gameweek) return []

      const { data: fixtures, error: fixturesError } = await supabase
        .from('fixtures')
        .select('*')
        .eq('gameweek', gameweek)
        .order('kickoff_time', { ascending: true })

      if (fixturesError) throw fixturesError
      if (!fixtures?.length) return []

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

      let result = fixtures.map(f => ({
        ...f,
        homeTeam: teamMap[f.home_team_id] || { short_name: null, team_name: null },
        awayTeam: teamMap[f.away_team_id] || { short_name: null, team_name: null }
      }))
      if (simulateStatuses) result = applySimulatedStatuses(result)
      return result
    },
    enabled: !!gameweek,
    staleTime: 30000,
    refetchInterval: simulateStatuses ? false : 30000
  })

  return { fixtures: fixturesWithTeams, loading: isLoading, error }
}
