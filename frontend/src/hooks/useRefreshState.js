import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { logRefreshFetchDuration } from '../utils/logRefreshFetchDuration'

/** Typical gap from GW deadline to first kickoff; we show "Deadline" only in this window (30 min–90 min after deadline). */
const DEADLINE_WINDOW_END_MINUTES = 90

/** Minutes before/after a fixture kickoff in which we poll fixtures more often so we detect "live" quickly. */
const KICKOFF_WINDOW_MINUTES = 10
const REFETCH_FAST_MS = 8_000
const REFETCH_IDLE_MS = 30_000

/** 17:30–17:36 PST (matches backend price change window). */
function isPriceWindow() {
  const now = new Date()
  const pstMinutes = ((now.getUTCHours() - 8 + 24) % 24) * 60 + now.getUTCMinutes()
  const windowStart = 17 * 60 + 30
  const windowEnd = windowStart + 6
  return pstMinutes >= windowStart && pstMinutes <= windowEnd
}

/** Fixture in progress: started (API) or at/past scheduled kickoff, and not provisionally finished. */
function fixtureInProgress(f, now) {
  if (f.finished_provisional) return false
  if (f.started) return true
  const k = f.kickoff_time
  if (!k) return false
  try {
    const kickoff = new Date(k.replace('Z', '+00:00'))
    return now >= kickoff
  } catch {
    return false
  }
}

/** True when we should poll fixtures frequently: within KICKOFF_WINDOW_MINUTES of any kickoff or past kickoff and not yet finished_provisional. */
function isInKickoffWindow(fixtures) {
  if (!Array.isArray(fixtures) || fixtures.length === 0) return false
  const now = Date.now()
  const windowMs = KICKOFF_WINDOW_MINUTES * 60 * 1000
  return fixtures.some((f) => {
    const k = f?.kickoff_time
    if (!k) return false
    try {
      const kickoff = new Date(k.replace('Z', '+00:00')).getTime()
      if (now < kickoff - windowMs) return false
      if (f.finished_provisional) return false
      return true
    } catch {
      return false
    }
  })
}

/**
 * Derives the refresh orchestrator state from gameweeks + fixtures (same logic as backend).
 * Live = at or past scheduled kickoff (we have exact minute) and not finished_provisional.
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
      const now = Date.now()
      let logState = 'idle'
      if (gwData?.is_current) {
        if (isPriceWindow()) logState = 'price_window'
        else if (f.some((x) => fixtureInProgress(x, now))) logState = 'live_matches'
        else if (f.length && f.every((x) => x.finished_provisional && !x.finished)) logState = 'bonus_pending'
        else if (deadlineTime) {
          const d = new Date(deadlineTime.replace('Z', '+00:00'))
          const mins = (now - d) / 60000
          if (mins >= 30 && mins <= DEADLINE_WINDOW_END_MINUTES) logState = 'transfer_deadline'
        }
      } else if (!gwData) logState = 'outside_gameweek'
      logRefreshFetchDuration('Fixtures', performance.now() - start, logState)
      return data ?? []
    },
    enabled: currentGameweek != null,
    staleTime: 30_000,
    refetchInterval: (query) =>
      isInKickoffWindow(query.state.data) ? REFETCH_FAST_MS : REFETCH_IDLE_MS,
  })

  const state = (() => {
    if (!gwData) return 'outside_gameweek'
    if (!gwData.is_current) return 'outside_gameweek'

    // Match backend order: price window first, then live, bonus, deadline, idle
    if (isPriceWindow()) return 'price_window'

    const now = Date.now()
    const liveMatches = fixtures.filter((f) => fixtureInProgress(f, now))
    if (liveMatches.length) return 'live_matches'

    const allBonusPending = fixtures.length > 0 && fixtures.every((f) => f.finished_provisional && !f.finished)
    if (allBonusPending) return 'bonus_pending'

    // Only show Deadline in the post-deadline batch window: 30 min after deadline until ~1.5 h (typical gap to first kickoff).
    if (deadlineTime) {
      const now = new Date()
      const deadline = new Date(deadlineTime.replace('Z', '+00:00'))
      const minutesAfterDeadline = (now - deadline) / (60 * 1000)
      if (minutesAfterDeadline >= 30 && minutesAfterDeadline <= DEADLINE_WINDOW_END_MINUTES) return 'transfer_deadline'
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
