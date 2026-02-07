import { useEffect } from 'react'

const DEFAULT_THRESHOLD = 5

/**
 * Locks touch scrolling to a single axis (horizontal or vertical) per gesture.
 * On the first significant touchmove, the dominant axis is chosen; subsequent
 * moves in that gesture only scroll along that axis. Prevents diagonal/rubber-band
 * scrolling on mobile for 2D scroll containers (e.g. tables with overflow: auto).
 *
 * @param {React.RefObject<HTMLElement | null>} ref - Ref to the scrollable element
 * @param {{ threshold?: number, enabled?: boolean }} [options]
 * @param {number} [options.threshold] - Pixels of movement before locking axis (default 5)
 * @param {boolean} [options.enabled] - If false, hook does nothing (default true)
 */
export function useAxisLockedScroll(ref, options = {}) {
  const { threshold = DEFAULT_THRESHOLD, enabled = true } = options

  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || !('ontouchstart' in window)) return
    const el = ref?.current
    if (!el) return

    let lock = null // 'h' | 'v' | null
    let lastX = 0
    let lastY = 0

    const onTouchStart = (e) => {
      if (e.touches.length !== 1) return
      lock = null
      lastX = e.touches[0].clientX
      lastY = e.touches[0].clientY
    }

    const onTouchMove = (e) => {
      if (e.touches.length !== 1) return
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

      if (lock === 'h') {
        e.preventDefault()
        const maxScrollLeft = el.scrollWidth - el.clientWidth
        if (maxScrollLeft > 0) {
          el.scrollLeft = Math.max(0, Math.min(maxScrollLeft, el.scrollLeft - dx))
        }
      } else if (lock === 'v') {
        e.preventDefault()
        const maxScrollTop = el.scrollHeight - el.clientHeight
        if (maxScrollTop > 0) {
          el.scrollTop = Math.max(0, Math.min(maxScrollTop, el.scrollTop - dy))
        }
      }
    }

    const onTouchEnd = () => {
      lock = null
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    el.addEventListener('touchcancel', onTouchEnd, { passive: true })

    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [ref, threshold, enabled])
}
