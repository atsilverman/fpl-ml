import { useState, useRef, useCallback, useEffect } from 'react'
import { useSearchParams, useOutletContext } from 'react-router-dom'
import DefconSubpage from './DefconSubpage'
import MatchesSubpage from './MatchesSubpage'
import './GameweekPage.css'

const GAMEWEEK_VIEW_ORDER = ['matches', 'bonus', 'defcon']
const viewToIndex = (v) => {
  const i = GAMEWEEK_VIEW_ORDER.indexOf(v)
  return i >= 0 ? i : GAMEWEEK_VIEW_ORDER.indexOf('defcon')
}

export default function GameweekPage() {
  const [searchParams] = useSearchParams()
  const outletContext = useOutletContext() ?? {}
  const { toggleBonus = false, showH2H = false, setShowH2H, setGameweekView } = outletContext
  const view = searchParams.get('view') || 'defcon'
  const simulateStatuses = searchParams.get('simulate') === '1' || searchParams.get('simulate') === 'status'

  const pageIndex = viewToIndex(view)
  const [dragOffset, setDragOffset] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const trackRef = useRef(null)
  const startXRef = useRef(null)
  const startIndexRef = useRef(null)

  const containerWidthRef = useRef(0)
  const measureRef = useRef(null)

  const measure = useCallback(() => {
    if (measureRef.current) {
      containerWidthRef.current = measureRef.current.offsetWidth
    }
  }, [])

  useEffect(() => {
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    if (ro && measureRef.current) ro.observe(measureRef.current)
    return () => {
      if (ro && measureRef.current) ro.unobserve(measureRef.current)
    }
  }, [measure])

  const handlePointerDown = useCallback(
    (e) => {
      if (!setGameweekView) return
      startXRef.current = e.clientX ?? e.touches?.[0]?.clientX
      startIndexRef.current = pageIndex
      setIsDragging(true)
      setDragOffset(0)
    },
    [pageIndex, setGameweekView]
  )

  const handlePointerMove = useCallback(
    (e) => {
      if (!isDragging || startXRef.current == null) return
      const clientX = e.clientX ?? e.touches?.[0]?.clientX
      const delta = clientX - startXRef.current
      const width = containerWidthRef.current || 300
      const maxDrag = width * 0.4
      const damped = Math.sign(delta) * Math.min(Math.abs(delta), maxDrag)
      setDragOffset(damped)
    },
    [isDragging]
  )

  const handlePointerUp = useCallback(
    (e) => {
      if (!isDragging || !setGameweekView) return
      const clientX = e.changedTouches?.[0]?.clientX ?? e.clientX
      const delta = (clientX - startXRef.current)
      const width = containerWidthRef.current || 300
      const threshold = width * 0.15
      let nextIndex = startIndexRef.current
      if (delta < -threshold) nextIndex = Math.min(startIndexRef.current + 1, GAMEWEEK_VIEW_ORDER.length - 1)
      else if (delta > threshold) nextIndex = Math.max(startIndexRef.current - 1, 0)
      setDragOffset(0)
      setIsDragging(false)
      startXRef.current = null
      if (nextIndex !== pageIndex) setGameweekView(GAMEWEEK_VIEW_ORDER[nextIndex])
    },
    [isDragging, pageIndex, setGameweekView]
  )

  useEffect(() => {
    if (!isDragging) return
    const up = (e) => handlePointerUp(e)
    const move = (e) => handlePointerMove(e)
    document.addEventListener('pointerup', up, { passive: true })
    document.addEventListener('pointercancel', up, { passive: true })
    document.addEventListener('pointermove', move, { passive: true })
    return () => {
      document.removeEventListener('pointerup', up)
      document.removeEventListener('pointercancel', up)
      document.removeEventListener('pointermove', move)
    }
  }, [isDragging, handlePointerUp, handlePointerMove])

  const width = containerWidthRef.current || 1
  /* Track is 300% wide (3 panels); translateX % is relative to track, so one panel = 100/3 % */
  const percentPerPanel = 100 / 3
  const translatePercent = -(pageIndex * percentPerPanel) + (width ? (dragOffset / width) * percentPerPanel : 0)

  return (
    <div className="gameweek-page">
      {simulateStatuses && (
        <div className="gameweek-simulate-banner" role="status">
          Simulating statuses: fixture 1 = Scheduled, 2 = Live, 3 = Finished (provisional), 4 = Final. Remove <code>?simulate=1</code> from URL to use real data.
        </div>
      )}
      <div
        ref={measureRef}
        className="gameweek-page-content gameweek-swipe-container"
        onPointerDown={handlePointerDown}
        style={{ touchAction: 'pan-y' }}
      >
        <div
          ref={trackRef}
          className={`gameweek-swipe-track ${isDragging ? 'gameweek-swipe-track--dragging' : ''}`}
          style={{ transform: `translateX(${translatePercent}%)` }}
        >
          <div className={`gameweek-subpage gameweek-subpage-matches`}>
            <MatchesSubpage simulateStatuses={simulateStatuses} toggleBonus={false} showH2H={showH2H} setShowH2H={setShowH2H} />
          </div>
          <div className={`gameweek-subpage gameweek-subpage-bonus`}>
            <MatchesSubpage simulateStatuses={simulateStatuses} toggleBonus={true} showH2H={showH2H} setShowH2H={setShowH2H} />
          </div>
          <div className="gameweek-subpage gameweek-subpage-defcon">
            <DefconSubpage />
          </div>
        </div>
      </div>
    </div>
  )
}
