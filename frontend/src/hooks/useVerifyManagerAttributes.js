import { useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const DEFAULT_MANAGER_ID = 344182

/**
 * Verify manager attributes (overall_rank, gameweek_rank, total_points, gameweek_points)
 * against the official FPL API. Call verify() on demand (e.g. "Verify" button in debug panel).
 */
export function useVerifyManagerAttributes(managerId = DEFAULT_MANAGER_ID) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const verify = useCallback(async () => {
    setLoading(true)
    setError(null)
    setData(null)
    try {
      const { data: result, error: fnError } = await supabase.functions.invoke(
        'debug-verify-manager',
        { body: { manager_id: managerId } }
      )
      if (fnError) throw fnError
      if (result?.error) {
        setData({ ...result, attributes: result.attributes ?? [] })
        setError(result.error)
      } else {
        setData(result ?? { manager_id: managerId, gameweek: null, attributes: [] })
      }
    } catch (e) {
      setError(e?.message ?? String(e))
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [managerId])

  return { data, loading, error, verify }
}
