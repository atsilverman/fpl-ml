import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Fetches gameweeks from is_next onward, fixtures for those gameweeks, and teams.
 * Builds schedule matrix: rows = teams, columns = gameweeks, cell = opponent (short_name, isHome) for abbreviation (caps home, lowercase away).
 */
export function useScheduleData() {
  const { data: nextGw, isLoading: nextGwLoading } = useQuery({
    queryKey: ['gameweek', 'next'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gameweeks')
        .select('id, name')
        .eq('is_next', true)
        .single()
      if (error) return null
      return data
    },
    staleTime: 60_000,
  })

  const nextGwId = nextGw?.id ?? null

  const { data: gameweeks = [], isLoading: gwListLoading } = useQuery({
    queryKey: ['gameweeks', 'from', nextGwId],
    queryFn: async () => {
      if (nextGwId == null) return []
      const { data, error } = await supabase
        .from('gameweeks')
        .select('id, name')
        .gte('id', nextGwId)
        .order('id', { ascending: true })
      if (error) throw error
      return data ?? []
    },
    enabled: nextGwId != null,
    staleTime: 60_000,
  })

  const gwIds = useMemo(() => gameweeks.map((gw) => gw.id), [gameweeks])

  const { data: fixtures = [], isLoading: fixturesLoading } = useQuery({
    queryKey: ['fixtures', 'schedule', gwIds],
    queryFn: async () => {
      if (!gwIds.length) return []
      const { data, error } = await supabase
        .from('fixtures')
        .select('gameweek, home_team_id, away_team_id')
        .in('gameweek', gwIds)
      if (error) throw error
      return data ?? []
    },
    enabled: gwIds.length > 0,
    staleTime: 60_000,
  })

  // Select only columns that exist in base schema. Add 'strength' after applying 035_add_teams_strength.sql.
  const { data: teams = [], isLoading: teamsLoading } = useQuery({
    queryKey: ['teams', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teams')
        .select('team_id, short_name, team_name')
        .order('team_id', { ascending: true })
      if (error) throw error
      return (data ?? []).map((t) => ({ ...t, strength: null }))
    },
    staleTime: 5 * 60 * 1000,
  })

  const teamMap = useMemo(() => {
    const m = {}
    teams.forEach((t) => {
      m[t.team_id] = {
        short_name: t.short_name,
        team_name: t.team_name,
        strength: t.strength != null ? Math.min(5, Math.max(1, Number(t.strength))) : null,
      }
    })
    return m
  }, [teams])

  const scheduleMatrix = useMemo(() => {
    const byTeamGw = {}
    fixtures.forEach((f) => {
      const gw = f.gameweek
      const home = f.home_team_id
      const away = f.away_team_id
      if (home) {
        byTeamGw[`${home}-${gw}`] = { team_id: away, ...teamMap[away], isHome: true }
      }
      if (away) {
        byTeamGw[`${away}-${gw}`] = { team_id: home, ...teamMap[home], isHome: false }
      }
    })
    const teamIdsSorted = teams.map((t) => t.team_id)
    return {
      teamIds: teamIdsSorted,
      gameweeks,
      getOpponent(teamId, gameweekId) {
        return byTeamGw[`${teamId}-${gameweekId}`] ?? null
      },
    }
  }, [fixtures, gameweeks, teams, teamMap])

  const loading = nextGwLoading || gwListLoading || fixturesLoading || teamsLoading

  return {
    gameweeks,
    teams: teams,
    teamMap,
    scheduleMatrix,
    nextGwId,
    loading,
  }
}
