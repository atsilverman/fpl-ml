import { useState, useEffect } from 'react'

const DEFAULT_BREAKPOINT = 768

/**
 * Returns true when viewport width is <= breakpoint (e.g. mobile). Updates on resize.
 * @param {number} [breakpoint=768] - Max width in px for "mobile"
 * @returns {boolean}
 */
export function useIsMobile(breakpoint = DEFAULT_BREAKPOINT) {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(`(max-width: ${breakpoint}px)`).matches
  )
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint}px)`)
    const handler = () => setIsMobile(mql.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [breakpoint])
  return isMobile
}
