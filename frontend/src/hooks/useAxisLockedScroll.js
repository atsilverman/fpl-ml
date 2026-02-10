import { useEffect, useState } from 'react'

const DEFAULT_THRESHOLD = 5
const MOBILE_MAX_WIDTH = 768
const INERTIA_FRICTION = 0.92
const INERTIA_MIN_VELOCITY = 0.4
const VELOCITY_SAMPLES = 4

/**
 * Locks touch scrolling to a single axis (horizontal or vertical) per gesture.
 * On the first significant touchmove, the dominant axis is chosen; subsequent
 * moves in that gesture only scroll along that axis. Prevents diagonal/rubber-band
 * scrolling on mobile for 2D scroll containers (e.g. tables with overflow: auto).
 * Applies inertia on touch end so scroll continues and eases to a stop.
 *
 * @param {React.RefObject<HTMLElement | null>} ref - Ref to the scrollable element
 * @param {{ threshold?: number, enabled?: boolean, mobileOnly?: boolean }} [options]
 * @param {number} [options.threshold] - Pixels of movement before locking axis (default 5)
 * @param {boolean} [options.enabled] - If false, hook does nothing (default true)
 * @param {boolean} [options.mobileOnly] - If true, only enable when viewport width <= MOBILE_MAX_WIDTH (default false)
 */
export function useAxisLockedScroll(ref, options = {}) {
  const { threshold = DEFAULT_THRESHOLD, enabled = true, mobileOnly = false } = options

  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`).matches
  )

  useEffect(() => {
    if (!mobileOnly) return
    const mql = window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`)
    const onChange = () => setIsMobileViewport(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [mobileOnly])

  const active = enabled && (!mobileOnly || isMobileViewport)

  useEffect(() => {
    if (!active || typeof window === 'undefined' || !('ontouchstart' in window)) return
    const el = ref?.current
    if (!el) return

    let lock = null // 'h' | 'v' | null
    let lastX = 0
    let lastY = 0
    const velocitySamples = { h: [], v: [] }
    let lastTime = 0
    let inertiaId = null

    const cancelInertia = () => {
      if (inertiaId != null) {
        cancelAnimationFrame(inertiaId)
        inertiaId = null
      }
    }

    const onTouchStart = (e) => {
      if (e.touches.length !== 1) return
      cancelInertia()
      lock = null
      velocitySamples.h.length = 0
      velocitySamples.v.length = 0
      lastX = e.touches[0].clientX
      lastY = e.touches[0].clientY
      lastTime = 0
    }

    const onTouchMove = (e) => {
      if (e.touches.length !== 1) return
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
      const x = e.touches[0].clientX
      const y = e.touches[0].clientY
      const dx = x - lastX
      const dy = y - lastY
      lastX = x
      lastY = y

      if (lock === null) {
        const absDx = Math.abs(dx)
        const absDy = Math.abs(dy)
        if (absDx > threshold || absDy > threshold) {
          lock = absDx > absDy ? 'h' : 'v'
        }
      }

      if (lastTime > 0 && (lock === 'h' || lock === 'v')) {
        const dt = Math.min(now - lastTime, 50)
        if (dt > 2) {
          const arr = lock === 'h' ? velocitySamples.h : velocitySamples.v
          const v = (lock === 'h' ? -dx : -dy) / dt
          arr.push(v)
          if (arr.length > VELOCITY_SAMPLES) arr.shift()
        }
      }
      lastTime = now

      /* Only preventDefault when this element actually has scrollable space in the locked direction.
         Otherwise the touch would be swallowed and the page/body could not scroll (e.g. Mini League
         table wrapper has overflow-y: visible; standings table is not a vertical scroll container). */
      if (lock === 'h') {
        const maxScrollLeft = el.scrollWidth - el.clientWidth
        if (maxScrollLeft > 0) {
          e.preventDefault()
          el.scrollLeft = Math.max(0, Math.min(maxScrollLeft, el.scrollLeft - dx))
        }
      } else if (lock === 'v') {
        const maxScrollTop = el.scrollHeight - el.clientHeight
        if (maxScrollTop > 0) {
          e.preventDefault()
          el.scrollTop = Math.max(0, Math.min(maxScrollTop, el.scrollTop - dy))
        }
      }
    }

    const runInertia = (axis, initialVelocity) => {
      const maxScroll = axis === 'h' ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight
      if (maxScroll <= 0) return
      let velocity = initialVelocity
      const friction = INERTIA_FRICTION

      const tick = () => {
        if (Math.abs(velocity) < INERTIA_MIN_VELOCITY) return
        if (axis === 'h') {
          const next = el.scrollLeft + velocity
          if (next <= 0 || next >= maxScroll) {
            velocity = 0
            return
          }
          el.scrollLeft = next
        } else {
          const next = el.scrollTop + velocity
          if (next <= 0 || next >= maxScroll) {
            velocity = 0
            return
          }
          el.scrollTop = next
        }
        velocity *= friction
        inertiaId = requestAnimationFrame(tick)
      }
      inertiaId = requestAnimationFrame(tick)
    }

    const onTouchEnd = () => {
      if (lock === 'h' && velocitySamples.h.length > 0) {
        const avg = velocitySamples.h.reduce((a, b) => a + b, 0) / velocitySamples.h.length
        runInertia('h', avg * 16)
      } else if (lock === 'v' && velocitySamples.v.length > 0) {
        const avg = velocitySamples.v.reduce((a, b) => a + b, 0) / velocitySamples.v.length
        runInertia('v', avg * 16)
      }
      lock = null
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    el.addEventListener('touchcancel', onTouchEnd, { passive: true })

    return () => {
      cancelInertia()
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [ref, threshold, active])
}
