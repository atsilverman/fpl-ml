import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Fetches per-team accumulated stats over the last 6 finished gameweeks (G, xG, GC, xGC, CS)
 * with league rank 1-20 for each stat. Used in player detail modal to show next opponent form.
 */
export function useTeamLast6Stats() {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['team-last-6-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_team_last_6_stats')
        .select('team_id, goals, xg, goals_conceded, xgc, clean_sheets, rank_goals, rank_xg, rank_goals_conceded, rank_xgc, rank_clean_sheets, rank_goals_count, rank_xg_count, rank_goals_conceded_count, rank_xgc_count, rank_clean_sheets_count')
      if (error) {
        // View may not exist until migration 061_team_last_6_stats_view.sql is run (404 / relation not found)
        if (error.code === 'PGRST204' || error.message?.includes('does not exist') || error.status === 404) {
          return []
        }
        throw error
      }
      return data ?? []
    },
    staleTime: 2 * 60 * 1000,
  })

  const byTeamId = useMemo(() => {
    const map = {}
    rows.forEach((r) => {
      map[r.team_id] = {
        goals: r.goals != null ? Number(r.goals) : null,
        xg: r.xg != null ? Number(r.xg) : null,
        goalsConceded: r.goals_conceded != null ? Number(r.goals_conceded) : null,
        xgc: r.xgc != null ? Number(r.xgc) : null,
        cleanSheets: r.clean_sheets != null ? Number(r.clean_sheets) : null,
        rankGoals: r.rank_goals != null ? Number(r.rank_goals) : null,
        rankXg: r.rank_xg != null ? Number(r.rank_xg) : null,
        rankGoalsConceded: r.rank_goals_conceded != null ? Number(r.rank_goals_conceded) : null,
        rankXgc: r.rank_xgc != null ? Number(r.rank_xgc) : null,
        rankCleanSheets: r.rank_clean_sheets != null ? Number(r.rank_clean_sheets) : null,
        rankGoalsTied: (r.rank_goals_count != null && Number(r.rank_goals_count) > 1),
        rankXgTied: (r.rank_xg_count != null && Number(r.rank_xg_count) > 1),
        rankGoalsConcededTied: (r.rank_goals_conceded_count != null && Number(r.rank_goals_conceded_count) > 1),
        rankXgcTied: (r.rank_xgc_count != null && Number(r.rank_xgc_count) > 1),
        rankCleanSheetsTied: (r.rank_clean_sheets_count != null && Number(r.rank_clean_sheets_count) > 1),
      }
    })
    return map
  }, [rows])

  return { byTeamId, loading: isLoading }
}
