import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { logRefreshFetchDuration } from '../utils/logRefreshFetchDuration'

/** Match backend KICKOFF_WINDOW_MINUTES: treat as live when within ±N min of any kickoff or past earliest kickoff. */
const KICKOFF_WINDOW_MINUTES = 5

/**
 * True when now is within ±N minutes of any fixture kickoff, or past (earliest kickoff - N min).
 * Uses same logic as backend so we catch live state right away from documented kickoff times.
 */
function inKickoffOrLikelyLiveWindow(fixtures, windowMinutes = KICKOFF_WINDOW_MINUTES) {
  if (!fixtures?.length) return false
  const now = Date.now()
  const deltaMs = windowMinutes * 60 * 1000
  let earliestKickoff = null
  for (const f of fixtures) {
    const k = f.kickoff_time
    if (!k) continue
    const kickoff = new Date(k.replace('Z', '+00:00')).getTime()
    if (Number.isNaN(kickoff)) continue
    if (earliestKickoff == null || kickoff < earliestKickoff) earliestKickoff = kickoff
    if (now >= kickoff - deltaMs && now <= kickoff + deltaMs) return true
  }
  return earliestKickoff != null && now >= earliestKickoff - deltaMs
}

/**
 * Derives the refresh orchestrator state from gameweeks + fixtures (same logic as backend).
 * Uses kickoff times as a strong hook: when we're in the kickoff window or past earliest kickoff,
 * we treat as live_matches so polling and UI catch live state right away.
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
      const start = performance.now()
      const { data, error } = await supabase
        .from('fixtures')
        .select('started, finished, finished_provisional, kickoff_time')
        .eq('gameweek', currentGameweek)
      if (error) return []
      const f = data ?? []
      let logState = 'idle'
      if (gwData?.is_current) {
        if (f.some((x) => x.started && !x.finished_provisional)) logState = 'live_matches'
        else if (inKickoffOrLikelyLiveWindow(f)) logState = 'live_matches'
        else if (f.length && f.every((x) => x.finished_provisional && !x.finished)) logState = 'bonus_pending'
        else if (deadlineTime) {
          const d = new Date(deadlineTime.replace('Z', '+00:00'))
          if ((Date.now() - d) / 60000 >= 30) logState = 'transfer_deadline'
        }
      } else if (!gwData) logState = 'outside_gameweek'
      logRefreshFetchDuration('Fixtures', performance.now() - start, logState)
      return data ?? []
    },
    enabled: currentGameweek != null,
    staleTime: 30_000,
    refetchInterval: 30_000, // Poll so Updates (debug) and state stay in sync with backend fast loop
  })

  const state = (() => {
    if (!gwData) return 'outside_gameweek'
    if (!gwData.is_current) return 'outside_gameweek'

    const liveMatches = fixtures.filter((f) => f.started && !f.finished_provisional)
    if (liveMatches.length) return 'live_matches'

    const allBonusPending = fixtures.length > 0 && fixtures.every((f) => f.finished_provisional && !f.finished)
    if (allBonusPending) return 'bonus_pending'

    // Kickoff hook: treat as live when within ±5 min of any kickoff or past earliest kickoff (matches backend)
    if (fixtures.length > 0 && inKickoffOrLikelyLiveWindow(fixtures)) return 'live_matches'

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
      outside_gameweek: 'Idle',
      live_matches: 'Live',
      bonus_pending: 'Bonus Pending',
      price_window: 'Price Window',
      transfer_deadline: 'Deadline',
      idle: 'Idle',
    }[state] ?? state

  return { state, stateLabel }
}
