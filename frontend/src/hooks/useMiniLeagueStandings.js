import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useConfiguration } from '../contexts/ConfigurationContext'
import { useRefreshState } from './useRefreshState'
import { logRefreshFetchDuration } from '../utils/logRefreshFetchDuration'

export function useMiniLeagueStandings(gameweek = null) {
  const { config } = useConfiguration()
  const { state } = useRefreshState()
  const isLive = state === 'live_matches' || state === 'bonus_pending'
  const LEAGUE_ID = config?.leagueId || import.meta.env.VITE_LEAGUE_ID || null

  const { data: rawStandings = [], isLoading, error, dataUpdatedAt } = useQuery({
    queryKey: ['standings', LEAGUE_ID, gameweek],
    queryFn: async () => {
      if (!LEAGUE_ID) return []
      const start = performance.now()
      let query = supabase
        .from('mv_mini_league_standings')
        .select('*')
        .eq('league_id', LEAGUE_ID)
        .order('total_points', { ascending: false })

      if (gameweek) {
        query = query.eq('gameweek', gameweek)
      }

      const { data, error } = await query

      if (error) throw error
      logRefreshFetchDuration('League standings', performance.now() - start, state)
      return data || []
    },
    enabled: !!LEAGUE_ID, // Only run if we have a league ID
    staleTime: isLive ? 10_000 : 30_000, // 10s when live so standings stay current
    refetchInterval: isLive ? 12_000 : 30_000, // 12s when live, 30s otherwise
    refetchIntervalInBackground: true,
  })

  // When live: only show new standings when rank 1 has been stable for two consecutive fetches,
  // so we avoid briefly showing wrong order (e.g. wrong leader) during backend recomputation.
  const [stableStandings, setStableStandings] = useState([])
  const lastRank1Ref = useRef(null)

  useEffect(() => {
    lastRank1Ref.current = null
  }, [LEAGUE_ID, gameweek])

  useEffect(() => {
    if (!isLive) {
      setStableStandings(rawStandings)
      lastRank1Ref.current = rawStandings[0]?.manager_id ?? null
      return
    }
    if (!rawStandings.length) return
    const rank1 = rawStandings[0].manager_id
    if (lastRank1Ref.current === null || lastRank1Ref.current === rank1) {
      setStableStandings(rawStandings)
    }
    lastRank1Ref.current = rank1
  }, [isLive, rawStandings, dataUpdatedAt])

  const standings = isLive ? stableStandings : rawStandings

  return { standings, loading: isLoading, error, dataUpdatedAt }
}
