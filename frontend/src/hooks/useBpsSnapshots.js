import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

/**
 * BPS snapshots for a fixture (chronological per refresh).
 * Used by Bonus subpage line graph: BPS over time, one line per player.
 */
export function useBpsSnapshots(fixtureId, gameweek, enabled = true) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['bps-snapshots', fixtureId, gameweek],
    queryFn: async () => {
      if (!fixtureId || !gameweek) return []
      const { data: rows, error: err } = await supabase
        .from('bps_snapshots')
        .select('player_id, bps, bonus, provisional_bonus, recorded_at')
        .eq('fixture_id', fixtureId)
        .eq('gameweek', gameweek)
        .order('recorded_at', { ascending: true })
      if (err) throw err
      return rows ?? []
    },
    enabled: !!fixtureId && !!gameweek && enabled,
    staleTime: 30000,
  })
  return { data: data ?? [], loading: isLoading, error }
}
