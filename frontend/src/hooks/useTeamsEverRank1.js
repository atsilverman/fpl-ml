import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Fetches team IDs that have been PL table rank 1 at least once in gameweeks 1..maxGw.
 * Used by team moving average chart to show leader comparison lines.
 */
export function useTeamsEverRank1(maxGw, enabled = true) {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['teams-ever-rank1', maxGw],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_teams_ever_table_rank1', {
        p_max_gw: Number(maxGw) || 38,
      })
      if (error) throw error
      return data ?? []
    },
    enabled: enabled && maxGw > 0,
    staleTime: 5 * 60 * 1000,
  })

  const rank1TeamIds = useMemo(
    () => new Set((rows || []).map((r) => Number(r.team_id)).filter(Boolean)),
    [rows]
  )

  return { rank1TeamIds, loading: isLoading }
}
