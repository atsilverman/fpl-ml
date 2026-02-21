/**
 * Returns the effective API base URL for backend requests.
 * When the page is loaded over HTTPS and VITE_API_BASE_URL is http://,
 * returns '' so the app uses Supabase instead (avoids Mixed Content blocking).
 */
export function getApiBase() {
  const raw =
    typeof import.meta !== 'undefined' &&
    import.meta.env &&
    import.meta.env.VITE_API_BASE_URL
      ? import.meta.env.VITE_API_BASE_URL
      : ''
  const base = raw.replace(/\/$/, '')
  if (
    typeof window !== 'undefined' &&
    window.location?.protocol === 'https:' &&
    base.toLowerCase().startsWith('http://')
  ) {
    return ''
  }
  return base
}
