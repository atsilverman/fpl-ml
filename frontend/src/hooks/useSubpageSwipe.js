import { useEffect, useRef } from 'react'

const DEFAULT_MIN_SWIPE = 80
const DEFAULT_AXIS_LOCK = 10

/**
 * Returns true if node is inside an element (up to root) that has horizontal overflow
 * and is scrollable (scrollWidth > clientWidth). Used to avoid capturing subpage swipe
 * when the user is scrolling a table or list horizontally.
 */
function isInsideHorizontallyScrollableElement(node, root) {
  let el = node
  while (el && el !== root) {
    if (el.nodeType !== 1) {
      el = el.parentNode
      continue
    }
    try {
      const style = typeof getComputedStyle !== 'undefined' ? getComputedStyle(el) : null
      if (style) {
        const overflowX = style.overflowX
        if ((overflowX === 'auto' || overflowX === 'scroll') && el.scrollWidth > el.clientWidth) {
          return true
        }
      }
    } catch (_) {
      // getComputedStyle can throw for detached or cross-origin nodes
    }
    el = el.parentElement
  }
  return false
}

/**
 * Mobile-only horizontal swipe to change subpage index. No loop: at first page
 * swipe-right does nothing; at last page swipe-left does nothing.
 * Skips subpage swipe when the touch starts on a horizontally scrollable element
 * (e.g. table wrapper) so inner horizontal scroll is prioritized.
 *
 * @param {React.RefObject<HTMLElement | null>} containerRef - Element to attach touch listeners to
 * @param {object} options
 * @param {number} options.currentIndex - Current subpage index (0 .. totalPages - 1)
 * @param {number} options.totalPages - Number of subpages
 * @param {(index: number) => void} options.onSwipeToIndex - Called with new index on successful swipe
 * @param {boolean} options.enabled - If false, listeners are not attached (e.g. when not mobile)
 * @param {number} [options.minSwipeDistance] - Min horizontal distance to count as swipe (default 80)
 * @param {number} [options.axisLockThreshold] - Pixels before deciding horizontal vs vertical (default 10)
 */
export function useSubpageSwipe(containerRef, options) {
  const {
    currentIndex,
    totalPages,
    onSwipeToIndex,
    enabled,
    minSwipeDistance = DEFAULT_MIN_SWIPE,
    axisLockThreshold = DEFAULT_AXIS_LOCK
  } = options

  const startX = useRef(0)
  const startY = useRef(0)
  const isHorizontalSwipe = useRef(null)
  const skipSubpageSwipe = useRef(false)
  const onSwipeRef = useRef(onSwipeToIndex)
  onSwipeRef.current = onSwipeToIndex

  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || !('ontouchstart' in window)) return
    const el = containerRef?.current
    if (!el || totalPages <= 1) return

    const onTouchStart = (e) => {
      if (e.touches.length !== 1) return
      startX.current = e.touches[0].clientX
      startY.current = e.touches[0].clientY
      isHorizontalSwipe.current = null
      skipSubpageSwipe.current = isInsideHorizontallyScrollableElement(e.target, el)
    }

    const onTouchMove = (e) => {
      if (e.touches.length !== 1) return
      if (skipSubpageSwipe.current) return
      const x = e.touches[0].clientX
      const y = e.touches[0].clientY
      const dx = x - startX.current
      const dy = y - startY.current

      if (isHorizontalSwipe.current === null) {
        const absDx = Math.abs(dx)
        const absDy = Math.abs(dy)
        if (absDx > axisLockThreshold || absDy > axisLockThreshold) {
          isHorizontalSwipe.current = absDx > absDy
        }
      }

      if (isHorizontalSwipe.current === true) {
        e.preventDefault()
      }
    }

    const onTouchEnd = (e) => {
      if (skipSubpageSwipe.current) return
      if (isHorizontalSwipe.current !== true) return
      const endX = e.changedTouches?.[0]?.clientX ?? startX.current
      const dx = endX - startX.current

      if (dx < -minSwipeDistance && currentIndex < totalPages - 1) {
        onSwipeRef.current(currentIndex + 1)
      } else if (dx > minSwipeDistance && currentIndex > 0) {
        onSwipeRef.current(currentIndex - 1)
      }
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
  }, [containerRef, enabled, totalPages, currentIndex, minSwipeDistance, axisLockThreshold])
}
