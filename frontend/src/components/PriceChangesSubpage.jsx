import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { CircleArrowUp, CircleArrowDown, Info } from 'lucide-react'
import { usePlayerPriceChangesByDate } from '../hooks/usePlayerPriceChangesByDate'
import { usePriceChangePredictions } from '../hooks/usePriceChangePredictions'
import { usePlayerTeamMap } from '../hooks/usePlayerTeamMap'
import './PriceChangesSubpage.css'

const POPUP_GAP = 6
const POPUP_PAD = 8
function getPopupPosition(anchorRect, popupWidth, popupHeight) {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 0
  const vh = typeof window !== 'undefined' ? window.innerHeight : 0
  let left = anchorRect.right - popupWidth
  let top = anchorRect.bottom + POPUP_GAP
  if (left < POPUP_PAD) left = POPUP_PAD
  if (left + popupWidth > vw - POPUP_PAD) left = vw - POPUP_PAD - popupWidth
  if (top + popupHeight > vh - POPUP_PAD) top = anchorRect.top - POPUP_GAP - popupHeight
  if (top < POPUP_PAD) top = POPUP_PAD
  return { top, left }
}

const CUTOFF_HOUR = 17
const CUTOFF_MINUTE = 30

function formatSnapshotDate(isoDate) {
  if (!isoDate) return null
  const [y, m, d] = isoDate.split('-').map(Number)
  const dObj = new Date(y, m - 1, d)
  const now = new Date()
  const cutoff = new Date(now)
  cutoff.setHours(CUTOFF_HOUR, CUTOFF_MINUTE, 0, 0)
  const pastCutoff = now >= cutoff

  const isToday =
    dObj.getFullYear() === now.getFullYear() &&
    dObj.getMonth() === now.getMonth() &&
    dObj.getDate() === now.getDate()
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const isYesterday =
    dObj.getFullYear() === yesterday.getFullYear() &&
    dObj.getMonth() === yesterday.getMonth() &&
    dObj.getDate() === yesterday.getDate()

  if (isToday) return pastCutoff ? 'Today' : dObj.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
  if (isYesterday) return 'Yesterday'
  return dObj.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

function formatCapturedAt(isoString) {
  if (!isoString) return null
  const d = new Date(isoString)
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) + ' · ' + formatSnapshotDate(isoString.slice(0, 10))
}

export function PriceChangeColumns({ rises, falls, loading, getTeamForPlayer }) {
  const renderList = (list) => (
    <>
      {loading ? (
        <div className="price-changes-loading">Loading...</div>
      ) : list.length === 0 ? (
        <div className="price-changes-empty">No data</div>
      ) : (
        <div className="price-changes-column-list">
          {list.map((row, i) => {
            const badgeTeam = row.teamShortName || getTeamForPlayer(row.playerName)
            return (
              <div key={i} className="price-changes-column-item">
                <span className="price-changes-badge-slot">
                  {badgeTeam ? (
                    <img
                      src={`/badges/${badgeTeam}.svg`}
                      alt=""
                      className="price-changes-badge"
                      onError={(e) => { e.target.style.display = 'none' }}
                    />
                  ) : (
                    <span className="price-changes-badge-placeholder" aria-hidden />
                  )}
                </span>
                <span className="price-changes-column-name">{row.playerName}</span>
                {row.price ? (
                  <span className="price-changes-column-price" title={row.price}>{row.price}</span>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </>
  )

  return (
    <div className="price-changes-columns-wrapper">
      <div className="price-changes-column price-changes-column-rise">
        <div className="price-changes-column-header">
          <span className="price-changes-column-title price-changes-column-title-rise">
            <CircleArrowUp size={12} strokeWidth={2} aria-hidden /> Rise
          </span>
        </div>
        {renderList(rises, true)}
      </div>
      <div className="price-changes-column price-changes-column-fall">
        <div className="price-changes-column-header">
          <span className="price-changes-column-title price-changes-column-title-fall">
            <CircleArrowDown size={12} strokeWidth={2} aria-hidden /> Fall
          </span>
        </div>
        {renderList(falls, false)}
      </div>
    </div>
  )
}

export default function PriceChangesSubpage() {
  const { byDate, loading: actualLoading, error: actualError } = usePlayerPriceChangesByDate()
  const { rises: predRises, falls: predFalls, capturedAt, hasLatestRow, loading: predLoading, error: predError } = usePriceChangePredictions()
  const { getTeamForPlayer } = usePlayerTeamMap()

  const [showLivefplInfoPopup, setShowLivefplInfoPopup] = useState(false)
  const [livefplInfoPopupPosition, setLivefplInfoPopupPosition] = useState(null)
  const livefplInfoButtonRef = useRef(null)
  const livefplInfoPopupContentRef = useRef(null)

  useEffect(() => {
    if (!showLivefplInfoPopup) setLivefplInfoPopupPosition(null)
  }, [showLivefplInfoPopup])

  useLayoutEffect(() => {
    if (!showLivefplInfoPopup) return
    const anchor = livefplInfoButtonRef.current
    const popup = livefplInfoPopupContentRef.current
    if (!anchor || !popup) return
    const anchorRect = anchor.getBoundingClientRect()
    const w = popup.offsetWidth
    const h = popup.offsetHeight
    setLivefplInfoPopupPosition(getPopupPosition(anchorRect, w, h))
  }, [showLivefplInfoPopup])

  useEffect(() => {
    if (!showLivefplInfoPopup) return
    const handleClickOutside = (e) => {
      if (
        (livefplInfoButtonRef.current && livefplInfoButtonRef.current.contains(e.target)) ||
        (livefplInfoPopupContentRef.current && livefplInfoPopupContentRef.current.contains(e.target))
      )
        return
      setShowLivefplInfoPopup(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showLivefplInfoPopup])

  const hasPredictions = (predRises?.length ?? 0) > 0 || (predFalls?.length ?? 0) > 0
  const showPredictionsSection = hasLatestRow || hasPredictions
  const error = actualError ?? predError

  const predictionsContent = showPredictionsSection && (
    <div className="price-changes-bento-body" aria-labelledby="price-changes-predictions-heading">
      {capturedAt && (
        <p className="price-changes-snapshot-date" aria-live="polite">
          {formatCapturedAt(capturedAt)}
          {!hasPredictions && (
            <span className="price-changes-empty-capture-note"> — No rises/falls in last update. Predictions refresh automatically every 30 minutes from LiveFPL.</span>
          )}
        </p>
      )}
      {!capturedAt && !predLoading && (
        <p className="price-changes-snapshot-date">No prediction data yet. Predictions update automatically every 30 minutes from LiveFPL.</p>
      )}
      <PriceChangeColumns
        rises={predRises}
        falls={predFalls}
        loading={predLoading}
        getTeamForPlayer={getTeamForPlayer}
      />
    </div>
  )

  const actualContent = (
    <div className="price-changes-bento-body" aria-labelledby="price-changes-actual-heading">
      {actualLoading ? (
        <div className="price-changes-loading">Loading…</div>
      ) : byDate.length === 0 ? (
        <p className="price-changes-snapshot-date">No snapshot data yet. Price changes are recorded after the daily deadline window.</p>
      ) : (
        <div className="price-changes-daily-bentos">
          {byDate.map(({ date, rises, falls }) => (
            <div key={date} className="price-changes-day-group">
                    <h4 className="price-changes-day-heading">{formatSnapshotDate(date)}</h4>
                    <PriceChangeColumns
                      rises={rises}
                      falls={falls}
                      loading={false}
                      getTeamForPlayer={getTeamForPlayer}
                    />
                  </div>
          ))}
        </div>
      )}
    </div>
  )

  const innerContent = (
    <div className="research-price-changes-inner">
      {error ? (
        <div className="price-changes-error">Failed to load price changes.</div>
      ) : (
        <>
          {showPredictionsSection && (
            <div className="research-price-changes-sub" aria-labelledby="price-changes-predictions-heading">
              <div className="research-price-changes-sub-header">
                <h2 id="price-changes-predictions-heading" className="research-price-changes-sub-title">Predictions</h2>
                <span className="price-changes-source-wrap">
                  <a
                    href="https://t.co/KBHo75dwC5"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="research-page-source"
                    aria-label="Source: LiveFPL"
                  >
                    Source: <img src="/livefpl-logo.png" alt="LiveFPL" className="research-page-source-logo" />
                  </a>
                  <button
                    ref={livefplInfoButtonRef}
                    type="button"
                    className="bento-card-info-icon"
                    title="How predictions are updated"
                    onClick={(e) => {
                      e.stopPropagation()
                      setShowLivefplInfoPopup((v) => !v)
                    }}
                    aria-expanded={showLivefplInfoPopup}
                    aria-haspopup="dialog"
                  >
                    <Info className="bento-card-expand-icon-svg" size={11} strokeWidth={1.5} aria-hidden />
                  </button>
                  {showLivefplInfoPopup &&
                    createPortal(
                      <div
                        ref={livefplInfoPopupContentRef}
                        className="gw-legend-popup gw-legend-popup-fixed price-changes-source-info-popup"
                        role="dialog"
                        aria-label="Predictions source"
                        style={{
                          position: 'fixed',
                          left: livefplInfoPopupPosition?.left ?? 0,
                          top: livefplInfoPopupPosition?.top ?? 0,
                          visibility: livefplInfoPopupPosition ? 'visible' : 'hidden',
                          zIndex: 9999
                        }}
                      >
                        <div className="gw-legend-popup-title">Predictions source</div>
                        <p className="price-changes-source-note" style={{ margin: 0 }}>
                          A web crawler fetches the latest price predictions from{' '}
                          <a href="https://www.livefpl.net/prices" target="_blank" rel="noopener noreferrer">https://www.livefpl.net/prices</a>
                          {' '}every 30 minutes.
                        </p>
                      </div>,
                      document.body
                    )}
                </span>
              </div>
              <div className="research-price-changes-sub-body">{predictionsContent}</div>
            </div>
          )}
          <div className="research-price-changes-sub" aria-labelledby="price-changes-actual-heading">
            <h2 id="price-changes-actual-heading" className="research-price-changes-sub-title">Actual by day</h2>
            <div className="research-price-changes-sub-body">{actualContent}</div>
          </div>
        </>
      )}
    </div>
  )

  return (
    <div className="research-price-changes-subpage">
      <div className="research-price-changes-card research-card bento-card bento-card-animate bento-card-expanded">
        <header className="research-page-card-header research-price-changes-header">
          <span className="research-page-card-title">Price Changes</span>
        </header>
        <div className="research-price-changes-content">
          {innerContent}
        </div>
      </div>
    </div>
  )
}
