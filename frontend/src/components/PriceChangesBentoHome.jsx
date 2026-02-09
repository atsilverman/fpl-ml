import { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Info } from 'lucide-react'
import { Link } from 'react-router-dom'
import { usePriceChangePredictions } from '../hooks/usePriceChangePredictions'
import { useCurrentGameweekPlayers } from '../hooks/useCurrentGameweekPlayers'
import { usePlayerTeamMap } from '../hooks/usePlayerTeamMap'
import { PriceChangeColumns } from './PriceChangesSubpage'
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

function normalizeName(name) {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Returns true if the prediction row (playerName) is owned by the manager (ownedNames set). */
function isOwned(playerName, ownedNamesSet) {
  const n = normalizeName(playerName)
  if (!n) return false
  if (ownedNamesSet.has(n)) return true
  for (const owned of ownedNamesSet) {
    if (n.includes(owned) || owned.includes(n)) return true
  }
  return false
}

/**
 * Home page 2x2 bento: Price change predictions (Rise/Fall) limited to players owned by the configured manager.
 * Same visualization as Research Price Changes; no expand button; title "Price Changes". Info (i) explains owned-only and links to full page.
 */
export default function PriceChangesBentoHome({ className = '', style = {} }) {
  const { rises: predRises, falls: predFalls, capturedAt, loading: predLoading, error: predError } = usePriceChangePredictions()
  const { data: currentGameweekPlayers } = useCurrentGameweekPlayers()
  const { getTeamForPlayer } = usePlayerTeamMap()

  const [showInfoPopup, setShowInfoPopup] = useState(false)
  const [infoPopupPosition, setInfoPopupPosition] = useState(null)
  const infoButtonRef = useRef(null)
  const infoPopupContentRef = useRef(null)

  useEffect(() => {
    if (!showInfoPopup) setInfoPopupPosition(null)
  }, [showInfoPopup])

  useLayoutEffect(() => {
    if (!showInfoPopup) return
    const anchor = infoButtonRef.current
    const popup = infoPopupContentRef.current
    if (!anchor || !popup) return
    const anchorRect = anchor.getBoundingClientRect()
    setInfoPopupPosition(getPopupPosition(anchorRect, popup.offsetWidth, popup.offsetHeight))
  }, [showInfoPopup])

  useEffect(() => {
    if (!showInfoPopup) return
    const handleClickOutside = (e) => {
      if (
        (infoButtonRef.current && infoButtonRef.current.contains(e.target)) ||
        (infoPopupContentRef.current && infoPopupContentRef.current.contains(e.target))
      )
        return
      setShowInfoPopup(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showInfoPopup])

  const ownedNamesSet = useMemo(() => {
    if (!currentGameweekPlayers?.length) return new Set()
    const set = new Set()
    currentGameweekPlayers.forEach((p) => {
      const n = normalizeName(p.player_name)
      if (n) set.add(n)
    })
    return set
  }, [currentGameweekPlayers])

  const { rises, falls } = useMemo(() => {
    const ownedSet = ownedNamesSet
    const filterOwned = (list) => (list ?? []).filter((row) => isOwned(row.playerName, ownedSet))
    return {
      rises: filterOwned(predRises),
      falls: filterOwned(predFalls),
    }
  }, [predRises, predFalls, ownedNamesSet])

  const loading = predLoading
  const hasData = (rises?.length ?? 0) > 0 || (falls?.length ?? 0) > 0

  const totalItems = (rises?.length ?? 0) + (falls?.length ?? 0)
  const showScrollHint = totalItems > 8

  return (
    <div
      className={`price-changes-bento price-changes-bento-home bento-card bento-card-animate ${className}`.trim()}
      style={style}
      aria-labelledby="price-changes-home-heading"
    >
      <div className="price-changes-bento-label-row">
        <h2 id="price-changes-home-heading" className="bento-card-label">
          Price Changes
        </h2>
        <span className="price-changes-bento-header-right">
          {capturedAt && (
            <span className="price-changes-bento-timestamp" aria-live="polite">
              {formatCapturedAt(capturedAt)}
            </span>
          )}
          <button
            ref={infoButtonRef}
            type="button"
            className="bento-card-info-icon"
            title="About this widget"
            onClick={(e) => {
              e.stopPropagation()
              setShowInfoPopup((v) => !v)
            }}
            aria-expanded={showInfoPopup}
            aria-haspopup="dialog"
          >
            <Info className="bento-card-expand-icon-svg" size={11} strokeWidth={1.5} aria-hidden />
          </button>
          {showInfoPopup &&
            createPortal(
              <div
                ref={infoPopupContentRef}
                className="gw-legend-popup gw-legend-popup-fixed price-changes-source-info-popup price-changes-bento-home-info-popup"
                role="dialog"
                aria-label="Price changes info"
                style={{
                  position: 'fixed',
                  left: infoPopupPosition?.left ?? 0,
                  top: infoPopupPosition?.top ?? 0,
                  visibility: infoPopupPosition ? 'visible' : 'hidden',
                  zIndex: 9999
                }}
              >
                <div className="gw-legend-popup-title">Price changes</div>
                <p className="price-changes-source-note" style={{ margin: 0 }}>
                  Showing price change predictions (rise/fall) for <strong>owned players only</strong>. See the{' '}
                  <Link to="/research?view=price-changes" onClick={() => setShowInfoPopup(false)}>
                    Price Changes page
                  </Link>{' '}
                  for the full list.
                </p>
              </div>,
              document.body
            )}
        </span>
      </div>
      <div className="price-changes-bento-body">
        <div className="price-changes-bento-scroll">
          {predError ? (
            <div className="price-changes-error">Failed to load price changes.</div>
          ) : (
            <PriceChangeColumns
              rises={rises}
              falls={falls}
              loading={loading}
              getTeamForPlayer={getTeamForPlayer}
            />
          )}
          {!loading && !predError && !hasData && currentGameweekPlayers?.length > 0 && (
            <p className="price-changes-snapshot-date">None of your players are in the current rise/fall predictions.</p>
          )}
        </div>
        {showScrollHint && !predError && hasData && (
          <div className="price-changes-bento-scroll-hint" aria-hidden title="Scroll to view more">
            <ChevronDown size={14} strokeWidth={2} />
          </div>
        )}
      </div>
    </div>
  )
}
