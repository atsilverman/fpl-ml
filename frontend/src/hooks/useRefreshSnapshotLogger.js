import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useUpdateTimestamps } from './useUpdateTimestamps'
import { useRefreshState } from './useRefreshState'

const SNAPSHOT_INTERVAL_MS = 15_000

/**
 * When isActive (e.g. debug modal open), periodically logs refresh lag snapshots
 * to refresh_snapshot_log for plotting in refresh_log_viewer.html.
 */
export function useRefreshSnapshotLogger(isActive) {
  const { rows } = useUpdateTimestamps()
  const { state } = useRefreshState()
  const intervalRef = useRef(null)

  useEffect(() => {
    if (!isActive) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }

    const logSnapshot = () => {
      const now = Date.now()
      const stateStr = state ?? 'unknown'
      const toInsert = rows
        .filter((r) => r.source != null)
        .map((r) => {
          const sinceBackendSec = r.backendAt != null ? Math.max(0, (now - r.backendAt) / 1000) : 0
          const sinceFrontendSec = r.dataUpdatedAt != null ? Math.max(0, (now - r.dataUpdatedAt) / 1000) : 0
          return {
            source: r.source,
            state: stateStr,
            since_backend_sec: Math.round(sinceBackendSec * 10) / 10,
            since_frontend_sec: Math.round(sinceFrontendSec * 10) / 10,
          }
        })
      if (toInsert.length === 0) return
      supabase
        .from('refresh_snapshot_log')
        .insert(toInsert)
        .then(({ error }) => {
          if (error) {
            console.debug('[RefreshSnapshotLogger] insert failed:', error.message)
          }
        })
    }

    logSnapshot()
    intervalRef.current = setInterval(logSnapshot, SNAPSHOT_INTERVAL_MS)
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [isActive, rows, state])
}
