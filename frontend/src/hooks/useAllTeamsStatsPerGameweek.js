import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Fetches per-gameweek stats (G, xG, GC, xGC) for all teams up to maxGw.
 * Used by team detail modal moving-average chart.
 * @param {number} maxGw - Include gameweeks 1..maxGw
 * @param {boolean} enabled - Whether to run the query
 */
export function useAllTeamsStatsPerGameweek(maxGw, enabled = true) {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['all-teams-stats-per-gw', maxGw],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_all_teams_stats_per_gameweek', {
        p_max_gw: Number(maxGw) || 38,
        p_location: 'all',
      })
      if (error) throw error
      return data ?? []
    },
    enabled: enabled && maxGw > 0,
    staleTime: 60000,
  })

  const { data: teamsRows = [], isLoading: teamsLoading } = useQuery({
    queryKey: ['teams-short-names'],
    queryFn: async () => {
      const { data, error } = await supabase.from('teams').select('team_id, short_name')
      if (error) throw error
      return data ?? []
    },
    enabled: enabled && maxGw > 0,
    staleTime: 5 * 60 * 1000,
  })

  const { byTeamId, teams, teamShortNameById } = useMemo(() => {
    const byTeamId = {}
    const teamIds = new Set()
    ;(rows || []).forEach((r) => {
      const tid = Number(r.team_id)
      if (!byTeamId[tid]) byTeamId[tid] = []
      teamIds.add(tid)
      byTeamId[tid].push({
        gameweek: Number(r.gameweek),
        goals: r.goals != null ? Number(r.goals) : 0,
        xg: r.xg != null ? Number(r.xg) : 0,
        goals_conceded: r.goals_conceded != null ? Number(r.goals_conceded) : 0,
        xgc: r.xgc != null ? Number(r.xgc) : 0,
      })
    })
    Object.values(byTeamId).forEach((arr) => arr.sort((a, b) => a.gameweek - b.gameweek))

    const teamShortNameById = {}
    ;(teamsRows || []).forEach((t) => {
      teamShortNameById[Number(t.team_id)] = t.short_name ?? String(t.team_id)
    })

    return { byTeamId, teams: Array.from(teamIds), teamShortNameById }
  }, [rows, teamsRows])

  return { byTeamId, teams, teamShortNameById, loading: isLoading || teamsLoading }
}
