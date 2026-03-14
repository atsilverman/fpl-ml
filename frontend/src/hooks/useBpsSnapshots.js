import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

/**
 * BPS snapshots for a fixture (chronological per refresh).
 * Used by Bonus subpage line graph: BPS over time, one line per player.
 * When isLive, refetches more often so new snapshots appear quickly.
 */
export function useBpsSnapshots(fixtureId, gameweek, enabled = true, isLive = false) {
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
    staleTime: isLive ? 10000 : 30000,
    refetchInterval: isLive ? 15000 : false,
  })
  return { data: data ?? [], loading: isLoading, error }
}
