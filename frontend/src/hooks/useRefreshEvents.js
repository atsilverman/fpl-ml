import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

/**
 * Fetches latest backend refresh event timestamps (fast and slow path).
 * Used by Updates (debug) to show "Backend last" and "Time since backend".
 */
export function useRefreshEvents() {
  const { data: events = [] } = useQuery({
    queryKey: ['refresh-events'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('refresh_events')
        .select('path, occurred_at')
        .order('occurred_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return data ?? []
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  })

  // Latest occurred_at per path (ms); events are ordered occurred_at desc
  const fastAt = (() => {
    const row = events.find((e) => e.path === 'fast')
    if (!row?.occurred_at) return null
    return new Date(row.occurred_at).getTime()
  })()
  const slowAt = (() => {
    const row = events.find((e) => e.path === 'slow')
    if (!row?.occurred_at) return null
    return new Date(row.occurred_at).getTime()
  })()

  return { fastAt, slowAt, events }
}
