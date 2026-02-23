import { useState, useEffect, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useGameweekData } from './useGameweekData'
import { useConfiguration } from '../contexts/ConfigurationContext'
import { useRefreshEvents } from './useRefreshEvents'
import { useRefreshPhaseTimestamps, PHASE_SOURCE_LABELS } from './useRefreshPhaseTimestamps'

const DEBUG_REFETCH_INTERVAL = 5_000

/**
 * Path-level sources (refresh_events). Used when phase data is unavailable.
 */
const SOURCES = [
  { path: 'Fast', source: 'Gameweeks', queryKey: (gw) => ['gameweek', 'current'], phaseSource: 'gameweeks' },
  { path: 'Fast', source: 'Fixtures', queryKey: (gw) => ['fixtures', 'current-gw', gw], phaseSource: 'fixtures' },
  { path: 'Fast', source: 'GW Players', queryKey: (gw, managerId) => ['current-gameweek-players', managerId, gw], phaseSource: 'gw_players' },
  { path: 'Slow', source: 'Manager', queryKey: (gw, managerId, leagueId) => ['manager', managerId, gw, leagueId], phaseSource: 'manager_points' },
  { path: 'Slow', source: 'League standings', queryKey: (gw, _m, leagueId) => ['standings', leagueId, gw], phaseSource: 'live_standings' },
]

/** Phase source -> queryKey for "Since frontend" (optional) */
const PHASE_TO_QUERY_KEY = {
  gameweeks: (gw) => ['gameweek', 'current'],
  fixtures: (gw) => ['fixtures', 'current-gw', gw],
  gw_players: (gw, managerId) => ['current-gameweek-players', managerId, gw],
  live_standings: (gw, _m, leagueId) => ['standings', leagueId, gw],
  manager_points: (gw, managerId, leagueId) => ['manager', managerId, gw, leagueId],
  mvs: (gw, _m, leagueId) => ['standings', leagueId, gw],
}

function formatLocalTime(ms) {
  if (ms == null || typeof ms !== 'number') return '—'
  const d = new Date(ms)
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

function formatTimeSince(ms) {
  if (ms == null || typeof ms !== 'number') return '—'
  const sec = Math.floor((Date.now() - ms) / 1000)
  if (sec < 0) return '0s'
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  const s = sec % 60
  if (min < 60) return s > 0 ? `${min}m ${s}s` : `${min}m`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

/**
 * @param {{ isDebugOpen?: boolean }} options - When true, poll refresh_events and phase log more often and include phase/MV rows.
 */
export function useUpdateTimestamps(options = {}) {
  const isDebugOpen = options.isDebugOpen ?? false
  const queryClient = useQueryClient()
  const { gameweek } = useGameweekData()
  const { config } = useConfiguration()
  const { fastAt, slowAt } = useRefreshEvents(
    isDebugOpen ? { refetchInterval: DEBUG_REFETCH_INTERVAL } : {}
  )
  const { phases, mvsAt, available: phaseDataAvailable } = useRefreshPhaseTimestamps(
    isDebugOpen ? { refetchInterval: DEBUG_REFETCH_INTERVAL } : { refetchInterval: 30_000 }
  )
  const managerId = config?.managerId ?? import.meta.env.VITE_MANAGER_ID ?? null
  const leagueId = config?.leagueId ?? import.meta.env.VITE_LEAGUE_ID ?? null

  const [now, setNow] = useState(() => Date.now())

  // Re-read "time since" every second so the table stays current
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const rows = useMemo(() => {
    if (phaseDataAvailable && Object.keys(phases).length > 0) {
      // Phase-centric rows: each backend phase + MVs row with "Since MV"
      const order = ['gameweeks', 'fixtures', 'gw_players', 'live_standings', 'manager_points', 'mvs']
      return order.map((phaseSource) => {
        const phase = phases[phaseSource]
        const label = PHASE_SOURCE_LABELS[phaseSource]
        const path = phase ? (phase.path === 'fast' ? 'Fast' : 'Slow') : '—'
        const backendAt = phase?.occurred_at ? new Date(phase.occurred_at).getTime() : null
        const durationMs = phase?.duration_ms ?? null
        const queryKeyFn = PHASE_TO_QUERY_KEY[phaseSource]
        const dataUpdatedAt = queryKeyFn
          ? (() => {
              const key = queryKeyFn(gameweek, managerId, leagueId)
              return queryClient.getQueryState(key)?.dataUpdatedAt ?? null
            })()
          : null
        return {
          path,
          source: phaseSource === 'mvs' ? 'MVs (UI reads these)' : label,
          dataUpdatedAt,
          timeSince: formatTimeSince(dataUpdatedAt),
          backendAt,
          timeSinceBackend: formatTimeSince(backendAt),
          durationMs,
          isMv: phaseSource === 'mvs',
        }
      })
    }
    // Fallback: path-level only (original 5 rows)
    return SOURCES.map(({ path, source, queryKey }) => {
      const key = queryKey(gameweek, managerId, leagueId)
      const state = queryClient.getQueryState(key)
      const dataUpdatedAt = state?.dataUpdatedAt ?? null
      const backendAt = path === 'Fast' ? fastAt : slowAt
      return {
        path,
        source,
        dataUpdatedAt,
        timeStr: formatLocalTime(dataUpdatedAt),
        timeSince: formatTimeSince(dataUpdatedAt),
        backendAt,
        backendTimeStr: formatLocalTime(backendAt),
        timeSinceBackend: formatTimeSince(backendAt),
        durationMs: null,
        isMv: false,
      }
    })
  }, [queryClient, gameweek, managerId, leagueId, now, fastAt, slowAt, phaseDataAvailable, phases])

  // Subscribe to cache so we re-run when any of these queries update
  useEffect(() => {
    const cache = queryClient.getQueryCache()
    const unsub = cache.subscribe((event) => {
      if (event?.type === 'updated') {
        setNow(Date.now())
      }
    })
    return unsub
  }, [queryClient])

  const localTimeNow = useMemo(() => {
    return new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  }, [now])

  return { rows, localTimeNow }
}
