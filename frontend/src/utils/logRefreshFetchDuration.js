import { supabase } from '../lib/supabase'

/**
 * Log frontend fetch duration for a refresh source. Fire-and-forget; never throws.
 * Used by instrumented hooks to record each successful fetch for plotting over time.
 */
export function logRefreshFetchDuration(source, durationMs, state = 'unknown') {
  supabase
    .from('refresh_frontend_duration_log')
    .insert({ source, state, duration_ms: Math.round(durationMs) })
    .then(({ error }) => {
      if (error) console.debug('[logRefreshFetchDuration]', source, error.message)
    })
    .catch(() => {})
}
