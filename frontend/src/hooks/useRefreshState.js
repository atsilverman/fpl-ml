import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

/**
 * Derives the refresh orchestrator state from gameweeks + fixtures (same logic as backend).
 * For debugging: shows which state the backend is likely in.
 */
export function useRefreshState() {
  const { data: gwData } = useQuery({
    queryKey: ['gameweek', 'current'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gameweeks')
        .select('id, is_current, deadline_time')
        .eq('is_current', true)
        .single()
      if (error) return null
      return data
    },
    staleTime: 30_000,
  })

  const currentGameweek = gwData?.id ?? null
  const deadlineTime = gwData?.deadline_time ?? null

  const { data: fixtures = [] } = useQuery({
    queryKey: ['fixtures', 'current-gw', currentGameweek],
    queryFn: async () => {
      if (!currentGameweek) return []
      const { data, error } = await supabase
        .from('fixtures')
        .select('started, finished, finished_provisional')
        .eq('gameweek', currentGameweek)
      if (error) return []
      return data ?? []
    },
    enabled: currentGameweek != null,
    staleTime: 30_000,
  })

  const state = (() => {
    if (!gwData) return 'outside_gameweek'
    if (!gwData.is_current) return 'outside_gameweek'

    const liveMatches = fixtures.filter((f) => f.started && !f.finished_provisional)
    if (liveMatches.length) return 'live_matches'

    const allBonusPending = fixtures.length > 0 && fixtures.every((f) => f.finished_provisional && !f.finished)
    if (allBonusPending) return 'bonus_pending'

    const now = new Date()
    const pstHours = (now.getUTCHours() - 8 + 24) % 24
    const pstMinutes = pstHours * 60 + now.getUTCMinutes()
    const windowStart = 17 * 60 + 30
    const windowEnd = windowStart + 6
    if (pstMinutes >= windowStart && pstMinutes <= windowEnd) return 'price_window'

    if (deadlineTime) {
      const deadline = new Date(deadlineTime.replace('Z', '+00:00'))
      const minutesAfterDeadline = (now - deadline) / (60 * 1000)
      if (minutesAfterDeadline >= 30) return 'transfer_deadline'
    }

    return 'idle'
  })()

  const stateLabel =
    {
      outside_gameweek: 'Outside GW',
      live_matches: 'Live matches',
      bonus_pending: 'Bonus pending',
      price_window: 'Price window',
      transfer_deadline: 'Transfer deadline',
      idle: 'Idle',
    }[state] ?? state

  return { state, stateLabel }
}
