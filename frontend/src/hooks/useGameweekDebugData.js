import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

/**
 * Fetches current gameweek full row + fixtures with team short names for the debug bento.
 */
export function useGameweekDebugData() {
  const { data: gameweekRow, isLoading: gwLoading } = useQuery({
    queryKey: ['gameweek', 'debug'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gameweeks')
        .select('id, name, deadline_time, is_current, is_previous, is_next, finished, data_checked, highest_score, average_entry_score, fpl_ranks_updated')
        .eq('is_current', true)
        .single()
      if (error) throw error
      return data
    },
    staleTime: 15000,
  })

  const gameweek = gameweekRow?.id ?? null

  const { data: fixtures = [], isLoading: fixturesLoading } = useQuery({
    queryKey: ['fixtures-debug', gameweek],
    queryFn: async () => {
      if (!gameweek) return []
      const { data: fix, error: fixErr } = await supabase
        .from('fixtures')
        .select('fpl_fixture_id, gameweek, home_team_id, away_team_id, home_score, away_score, started, finished, finished_provisional, minutes, kickoff_time')
        .eq('gameweek', gameweek)
        .order('kickoff_time', { ascending: true })
      if (fixErr) throw fixErr
      if (!fix?.length) return []
      const teamIds = new Set()
      fix.forEach(f => {
        teamIds.add(f.home_team_id)
        teamIds.add(f.away_team_id)
      })
      const { data: teams, error: teamsErr } = await supabase
        .from('teams')
        .select('team_id, short_name')
        .in('team_id', Array.from(teamIds))
      if (teamsErr) throw teamsErr
      const teamMap = {}
      ;(teams || []).forEach(t => { teamMap[t.team_id] = t.short_name })
      return fix.map(f => ({
        ...f,
        home_short: teamMap[f.home_team_id] ?? '?',
        away_short: teamMap[f.away_team_id] ?? '?',
      }))
    },
    enabled: !!gameweek,
    staleTime: 15000,
  })

  return {
    gameweekRow: gameweekRow ?? null,
    fixtures,
    loading: gwLoading || fixturesLoading,
  }
}
