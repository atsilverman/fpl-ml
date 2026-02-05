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

  const { data: teams = [], isLoading: teamsLoading } = useQuery({
    queryKey: ['teams', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teams')
        .select('team_id, short_name, team_name, strength, strength_overall_home, strength_overall_away, strength_attack_home, strength_attack_away, strength_defence_home, strength_defence_away')
        .order('team_id', { ascending: true })
      if (error) {
        const isMissingColumn = error.code === 'PGRST204' || error.status === 400 || error.message?.includes('strength')
        if (isMissingColumn) {
          const { data: fallback, error: err2 } = await supabase
            .from('teams')
            .select('team_id, short_name, team_name')
            .order('team_id', { ascending: true })
          if (err2) throw err2
          return (fallback ?? []).map((t) => ({
            ...t,
            strength: null,
            strength_overall_home: null,
            strength_overall_away: null,
            strength_attack_home: null,
            strength_attack_away: null,
            strength_defence_home: null,
            strength_defence_away: null,
          }))
        }
        throw error
      }
      return data ?? []
    },
    staleTime: 5 * 60 * 1000,
  })

  const { data: calculatedStrengthRows = [] } = useQuery({
    queryKey: ['team_calculated_strength'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_team_calculated_strength')
        .select('team_id, calculated_attack, calculated_defence')
      if (error) return []
      return data ?? []
    },
    staleTime: 5 * 60 * 1000,
  })

  const calculatedByTeam = useMemo(() => {
    const map = {}
    calculatedStrengthRows.forEach((r) => {
      map[r.team_id] = {
        calculatedAttackDefault: r.calculated_attack != null ? Math.min(5, Math.max(1, Number(r.calculated_attack))) : null,
        calculatedDefenceDefault: r.calculated_defence != null ? Math.min(5, Math.max(1, Number(r.calculated_defence))) : null,
      }
    })
    return map
  }, [calculatedStrengthRows])

  const teamMap = useMemo(() => {
    const m = {}
    const collect = (getVal) => {
      const vals = []
      teams.forEach((t) => {
        const h = getVal(t, 'home')
        const a = getVal(t, 'away')
        if (h != null && !Number.isNaN(h)) vals.push(h)
        if (a != null && !Number.isNaN(a)) vals.push(a)
      })
      return vals
    }
    const toDifficulty = (vals, getVal, t) => {
      if (!vals.length) return null
      const min = Math.min(...vals)
      const max = Math.max(...vals)
      const v = getVal(t)
      if (v == null || Number.isNaN(v)) return null
      if (max === min) return null
      const n = 1 + (4 * (v - min)) / (max - min)
      return Math.min(5, Math.max(1, Math.round(n)))
    }
    const overallVals = collect((t) => (t.strength_overall_home != null ? Number(t.strength_overall_home) : null))
    const overallValsAway = collect((t) => (t.strength_overall_away != null ? Number(t.strength_overall_away) : null))
    const attackVals = collect((t) => (t.strength_attack_home != null ? Number(t.strength_attack_home) : null))
    attackVals.push(...collect((t) => (t.strength_attack_away != null ? Number(t.strength_attack_away) : null)))
    const defenceVals = collect((t) => (t.strength_defence_home != null ? Number(t.strength_defence_home) : null))
    defenceVals.push(...collect((t) => (t.strength_defence_away != null ? Number(t.strength_defence_away) : null)))

    const allOverall = [...overallVals, ...overallValsAway]
    const minOverall = allOverall.length ? Math.min(...allOverall) : null
    const maxOverall = allOverall.length ? Math.max(...allOverall) : null
    const minAttack = attackVals.length ? Math.min(...attackVals) : null
    const maxAttack = attackVals.length ? Math.max(...attackVals) : null
    const minDefence = defenceVals.length ? Math.min(...defenceVals) : null
    const maxDefence = defenceVals.length ? Math.max(...defenceVals) : null

    const toOverall = (v) => {
      if (v == null || Number.isNaN(v) || minOverall == null || maxOverall === minOverall) return null
      const n = 1 + (4 * (v - minOverall)) / (maxOverall - minOverall)
      return Math.min(5, Math.max(1, Math.round(n)))
    }
    const toAttack = (v) => {
      if (v == null || Number.isNaN(v) || minAttack == null || maxAttack === minAttack) return null
      const n = 1 + (4 * (v - minAttack)) / (maxAttack - minAttack)
      return Math.min(5, Math.max(1, Math.round(n)))
    }
    const toDefence = (v) => {
      if (v == null || Number.isNaN(v) || minDefence == null || maxDefence === minDefence) return null
      const n = 1 + (4 * (v - minDefence)) / (maxDefence - minDefence)
      return Math.min(5, Math.max(1, Math.round(n)))
    }

    teams.forEach((t) => {
      const strength = t.strength != null ? Math.min(5, Math.max(1, Number(t.strength))) : null
      const difficultyWhenHome = toOverall(t.strength_overall_home != null ? Number(t.strength_overall_home) : null)
      const difficultyWhenAway = toOverall(t.strength_overall_away != null ? Number(t.strength_overall_away) : null)
      const attackWhenHome = toAttack(t.strength_attack_home != null ? Number(t.strength_attack_home) : null)
      const attackWhenAway = toAttack(t.strength_attack_away != null ? Number(t.strength_attack_away) : null)
      const defenceWhenHome = toDefence(t.strength_defence_home != null ? Number(t.strength_defence_home) : null)
      const defenceWhenAway = toDefence(t.strength_defence_away != null ? Number(t.strength_defence_away) : null)
      const attackDefault = (attackWhenHome != null && attackWhenAway != null)
        ? Math.min(5, Math.max(1, Math.round((attackWhenHome + attackWhenAway) / 2)))
        : (attackWhenHome ?? attackWhenAway)
      const defenceDefault = (defenceWhenHome != null && defenceWhenAway != null)
        ? Math.min(5, Math.max(1, Math.round((defenceWhenHome + defenceWhenAway) / 2)))
        : (defenceWhenHome ?? defenceWhenAway)
      const calc = calculatedByTeam[t.team_id]
      const calculatedAttackDefault = calc?.calculatedAttackDefault ?? (attackDefault ?? strength)
      const calculatedDefenceDefault = calc?.calculatedDefenceDefault ?? (defenceDefault ?? strength)
      m[t.team_id] = {
        short_name: t.short_name,
        team_name: t.team_name,
        strength,
        difficultyWhenHome: difficultyWhenHome ?? strength,
        difficultyWhenAway: difficultyWhenAway ?? strength,
        attackDifficultyWhenHome: attackWhenHome ?? attackDefault,
        attackDifficultyWhenAway: attackWhenAway ?? attackDefault,
        defenceDifficultyWhenHome: defenceWhenHome ?? defenceDefault,
        defenceDifficultyWhenAway: defenceWhenAway ?? defenceDefault,
        attackDefault: attackDefault ?? strength,
        defenceDefault: defenceDefault ?? strength,
        calculatedAttackDefault,
        calculatedDefenceDefault,
      }
    })
    return m
  }, [teams, calculatedByTeam])

  const scheduleMatrix = useMemo(() => {
    const byTeamGw = {}
    fixtures.forEach((f) => {
      const gw = f.gameweek
      const home = f.home_team_id
      const away = f.away_team_id
      if (home && teamMap[away]) {
        const opp = teamMap[away]
        byTeamGw[`${home}-${gw}`] = {
          team_id: away,
          ...opp,
          isHome: true,
          difficulty: opp.difficultyWhenAway,
          attackDifficulty: opp.attackDifficultyWhenAway,
          defenceDifficulty: opp.defenceDifficultyWhenAway,
        }
      }
      if (away && teamMap[home]) {
        const opp = teamMap[home]
        byTeamGw[`${away}-${gw}`] = {
          team_id: home,
          ...opp,
          isHome: false,
          difficulty: opp.difficultyWhenHome,
          attackDifficulty: opp.attackDifficultyWhenHome,
          defenceDifficulty: opp.defenceDifficultyWhenHome,
        }
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
