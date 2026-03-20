import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

/**
 * BPS snapshots for a fixture (chronological per refresh).
 * Used by Bonus subpage line graph: BPS over time, one line per player.
 * When pollFrequently is true (match live or finished-provisional / bonus TBC), refetch often so
 * new backend snapshots appear — aligns with useFixturePlayerStats (live_matches + bonus_pending).
 */
export function useBpsSnapshots(fixtureId, gameweek, enabled = true, pollFrequently = false) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['bps-snapshots', fixtureId, gameweek],
    queryFn: async () => {
      const fid = fixtureId != null ? Number(fixtureId) : null
      const gw = gameweek != null ? Number(gameweek) : null
      if (!fid || !gw) return []
      const { data: rows, error: err } = await supabase
        .from('bps_snapshots')
        .select('player_id, bps, bonus, provisional_bonus, recorded_at')
        .eq('fixture_id', fid)
        .eq('gameweek', gw)
        .order('recorded_at', { ascending: true })
      if (err) throw err
      return rows ?? []
    },
    enabled: !!fixtureId && !!gameweek && enabled,
    staleTime: pollFrequently ? 10000 : 30000,
    refetchInterval: pollFrequently ? 15000 : false,
    refetchIntervalInBackground: pollFrequently,
  })
  return { data: data ?? [], loading: isLoading, error }
}
