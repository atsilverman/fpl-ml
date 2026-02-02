import { useState, useEffect, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useGameweekData } from './useGameweekData'
import { useConfiguration } from '../contexts/ConfigurationContext'
import { useRefreshEvents } from './useRefreshEvents'

/**
 * Sources that map to backend fast path (gameweeks, fixtures, GW players) or slow path (manager points, MVs).
 * Frontend timestamps = React Query dataUpdatedAt. Backend timestamps = refresh_events.occurred_at per path.
 */
const SOURCES = [
  { path: 'Fast', source: 'Gameweeks', queryKey: (gw) => ['gameweek', 'current'] },
  { path: 'Fast', source: 'Fixtures', queryKey: (gw) => ['fixtures', 'current-gw', gw] },
  { path: 'Fast', source: 'GW Players', queryKey: (gw, managerId) => ['current-gameweek-players', managerId, gw] },
  { path: 'Slow', source: 'Manager', queryKey: (gw, managerId, leagueId) => ['manager', managerId, gw, leagueId] },
  { path: 'Slow', source: 'League standings', queryKey: (gw, _m, leagueId) => ['standings', leagueId, gw] },
]

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

export function useUpdateTimestamps() {
  const queryClient = useQueryClient()
  const { gameweek } = useGameweekData()
  const { config } = useConfiguration()
  const { fastAt, slowAt } = useRefreshEvents()
  const managerId = config?.managerId ?? import.meta.env.VITE_MANAGER_ID ?? null
  const leagueId = config?.leagueId ?? import.meta.env.VITE_LEAGUE_ID ?? null

  const [now, setNow] = useState(() => Date.now())

  // Re-read "time since" every second so the table stays current
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const rows = useMemo(() => {
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
      }
    })
  }, [queryClient, gameweek, managerId, leagueId, now, fastAt, slowAt])

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
