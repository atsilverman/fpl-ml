import './BentoCard.css'
import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { formatNumber } from '../utils/formatNumbers'
import PerformanceChart from './PerformanceChart'
import TeamValueChart from './TeamValueChart'
import PlayerPerformanceChart from './PlayerPerformanceChart'
import GameweekPointsView from './GameweekPointsView'
import { useTheme } from '../contexts/ThemeContext'
import { Sun, Moon, Laptop, Settings, Bug, MoveDiagonal, Minimize2, Info, CircleArrowUp, CircleArrowDown, ChevronUp, ChevronDown, ChevronsUp, ChevronsDown, ArrowDownRight, ArrowUpRight } from 'lucide-react'

const FIRST_HALF_CHIP_COLUMNS = [
  { key: 'wc1', label: 'WC' },
  { key: 'fh', label: 'FH' },
  { key: 'bb', label: 'BB' },
  { key: 'tc', label: 'TC' }
]
const SECOND_HALF_CHIP_COLUMNS = [
  { key: 'wc2', label: 'WC2', isSecondHalf: true },
  { key: 'fh2', label: 'FH2', isSecondHalf: true },
  { key: 'bb2', label: 'BB2', isSecondHalf: true },
  { key: 'tc2', label: 'TC2', isSecondHalf: true }
]

const POPUP_GAP = 6
const POPUP_PAD = 8

const CHIP_DISPLAY = {
  wildcard: { label: (gw) => (gw != null && gw <= 19 ? 'WC1' : 'WC2'), color: '#8b5cf6' },
  freehit: { label: () => 'FH', color: '#3b82f6' },
  bboost: { label: () => 'BB', color: '#06b6d4' },
  '3xc': { label: () => 'TC', color: '#f97316' }
}

function getChipBadgeInfo(activeChip, gameweek) {
  const chip = typeof activeChip === 'string' ? activeChip.toLowerCase() : null
  if (!chip || !CHIP_DISPLAY[chip]) return null
  const info = CHIP_DISPLAY[chip]
  return { label: typeof info.label === 'function' ? info.label(gameweek) : info.label, color: info.color }
}

function formatDeadlineGw(iso) {
  if (!iso) return '—'
  try {
    const d = new Date(iso.replace('Z', '+00:00'))
    return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return '—'
  }
}

function GwDebugBadge({ value }) {
  const isTrue = value === true
  return (
    <span className={`gw-debug-badge gw-debug-badge--${isTrue ? 'true' : 'false'}`}>
      {isTrue ? 'true' : 'false'}
    </span>
  )
}

/** Compute top/left so popup stays within viewport; prefer below and right-aligned to anchor. */
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

export default function BentoCard({
  id,
  label,
  value,
  subtext,
  change,
  loading = false,
  className = '',
  isChart = false,
  isChips = false,
  isSettings = false,
  isStale = false,
  isLiveUpdating = false,
  isProvisionalOnly = false,
  style = {},
  onConfigureClick,
  onDebugClick,
  chartData = null,
  chartComparisonData = null,
  chartFilter = 'all',
  showChartComparison = false,
  onChartFilterChange = null,
  showTop10Lines = false,
  top10LinesData = null,
  onShowTop10Change = null,
  currentManagerId = null,
  chipUsage = null,
  isTransfers = false,
  transfersSummary = null,
  leagueTopTransfersOut = null,
  leagueTopTransfersIn = null,
  leagueTopTransfersLoading = false,
  transfersGameweek = null,
  isExpanded = false,
  onExpandClick = null,
  onCollapseClick = null,
  playerChartData = null,
  playerChartFilter = 'all',
  onPlayerChartFilterChange = null,
  playerPointsByGameweek = null,
  currentGameweekPlayersData = null,
  top10ByStat = null,
  impactByPlayerId = null,
  gameweek = null,
  leagueChipData = null,
  leagueChipsLoading = false,
  leagueStandings = null,
  leagueStandingsLoading = false,
  captainName = null,
  viceCaptainName = null,
  leagueCaptainData = null,
  leagueCaptainLoading = false,
  stateDebugValue = null,
  stateDebugDefinitions = null,
  isGwDebug = false,
  gameweekDebugData = null,
  gameweekDebugLoading = false,
  isUpdatesDebug = false,
  updateTimestampsData = null
}) {
  const isSecondHalf = gameweek != null && gameweek > 19
  const chipColumns = isSecondHalf ? SECOND_HALF_CHIP_COLUMNS : FIRST_HALF_CHIP_COLUMNS
  const collapsedChipItems = chipColumns.map(({ key, label, isSecondHalf: secondHalf }) => ({
    key,
    label,
    isSecondHalf: !!secondHalf,
    gameweek: chipUsage?.[key] ?? null
  }))
  const gwExpandIconsRef = useRef(null)
  const stateDebugPopupRef = useRef(null)
  const stateDebugPopupContentRef = useRef(null)
  const [showGwLegendPopup, setShowGwLegendPopup] = useState(false)
  const [showStateDebugPopup, setShowStateDebugPopup] = useState(false)
  const [stateDebugPopupPosition, setStateDebugPopupPosition] = useState(null)
  const [gwLegendPopupPosition, setGwLegendPopupPosition] = useState(null)
  const gwLegendPopupContentRef = useRef(null)

  useEffect(() => {
    if (!showStateDebugPopup) setStateDebugPopupPosition(null)
  }, [showStateDebugPopup])
  useEffect(() => {
    if (!showGwLegendPopup) setGwLegendPopupPosition(null)
  }, [showGwLegendPopup])

  useLayoutEffect(() => {
    if (!showStateDebugPopup || id !== 'refresh-state') return
    const anchor = stateDebugPopupRef.current
    const popup = stateDebugPopupContentRef.current
    if (!anchor || !popup) return
    const anchorRect = anchor.getBoundingClientRect()
    const w = popup.offsetWidth
    const h = popup.offsetHeight
    setStateDebugPopupPosition(getPopupPosition(anchorRect, w, h))
  }, [showStateDebugPopup, id, stateDebugDefinitions])

  useLayoutEffect(() => {
    if (!showGwLegendPopup || id !== 'gw-points') return
    const anchor = gwExpandIconsRef.current
    const popup = gwLegendPopupContentRef.current
    if (!anchor || !popup) return
    const anchorRect = anchor.getBoundingClientRect()
    const w = popup.offsetWidth
    const h = popup.offsetHeight
    setGwLegendPopupPosition(getPopupPosition(anchorRect, w, h))
  }, [showGwLegendPopup, id])

  useEffect(() => {
    if (id === 'gw-points' && !isExpanded) {
      setShowGwLegendPopup(false)
    }
  }, [id, isExpanded])

  useEffect(() => {
    if (!showGwLegendPopup) return
    if (id !== 'gw-points') return
    if (!isExpanded) return
    const handleClickOutside = (e) => {
      const anchor = gwExpandIconsRef.current
      const popup = gwLegendPopupContentRef.current
      if ((anchor && anchor.contains(e.target)) || (popup && popup.contains(e.target))) return
      setShowGwLegendPopup(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showGwLegendPopup, id, isExpanded])

  useEffect(() => {
    if (!showStateDebugPopup || id !== 'refresh-state') return
    const handleClickOutside = (e) => {
      const anchor = stateDebugPopupRef.current
      const popup = stateDebugPopupContentRef.current
      if ((anchor && anchor.contains(e.target)) || (popup && popup.contains(e.target))) return
      setShowStateDebugPopup(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showStateDebugPopup, id])

  const { themeMode, cycleTheme } = useTheme()
  const isTransfersExpanded = id === 'transfers' && isExpanded
  const overallRankBorderClass =
    id === 'overall-rank' && change != null && change !== 0
      ? change > 0
        ? 'bento-card-overall-rank-border-positive'
        : 'bento-card-overall-rank-border-negative'
      : null
  const leagueRankBorderClass =
    id === 'league-rank' && change != null && change !== 0
      ? change > 0
        ? 'bento-card-league-rank-border-positive'
        : 'bento-card-league-rank-border-negative'
      : null
  const cardClasses = [
    'bento-card',
    'bento-card-animate',
    className,
    overallRankBorderClass,
    leagueRankBorderClass,
    id === 'transfers' && 'bento-card-id-transfers',
    isExpanded && 'bento-card-expanded',
    isTransfersExpanded && 'bento-card-transfers-compact'
  ].filter(Boolean).join(' ')

  const getThemeValueLabel = () => {
    if (themeMode === 'light') return 'light'
    if (themeMode === 'dark') return 'dark'
    return 'system'
  }

  const getThemeIcon = () => {
    if (themeMode === 'light') {
      return <Sun className="settings-icon" size={11} strokeWidth={1.5} />
    }
    if (themeMode === 'dark') {
      return <Moon className="settings-icon" size={11} strokeWidth={1.5} />
    }
    // System/auto icon
    return <Laptop className="settings-icon" size={11} strokeWidth={1.5} />
  }

  const handleIconClick = (e) => {
    e.stopPropagation()
    if (isExpanded && onCollapseClick) {
      onCollapseClick()
    } else if (!isExpanded && onExpandClick) {
      onExpandClick()
    }
  }

  const renderChipItems = (items) => {
    return items.map(({ key, label, gameweek: gw, isSecondHalf }) => (
      <div
        key={key}
        className={`chip-item ${gw ? 'chip-used' : ''}`}
        title={gw ? `Used in Gameweek ${gw}` : 'Not used'}
      >
        <div className="chip-label">{label}</div>
        {gw ? <div className="chip-gameweek">GW{gw}</div> : isSecondHalf ? <div className="chip-gameweek chip-gameweek--dash">−</div> : null}
      </div>
    ))
  }

  const handleGwLegendClick = (e) => {
    e.stopPropagation()
    setShowGwLegendPopup((v) => !v)
  }

  const isGwPointsExpanded = id === 'gw-points' && isExpanded
  const isTotalPointsExpanded = id === 'total-points' && isExpanded
  const showExpandIcon = id === 'overall-rank' || id === 'team-value' || id === 'total-points' || id === 'gw-points' || id === 'transfers' || id === 'chips' || id === 'league-rank' || id === 'captain'
  const showStateDebugIcon = id === 'refresh-state' && stateDebugDefinitions?.length

  const handleStateDebugClick = (e) => {
    e.stopPropagation()
    setShowStateDebugPopup((v) => !v)
  }

  return (
    <div className={cardClasses} style={style}>
      {showStateDebugIcon && (
        <div className="bento-card-expand-icons" ref={stateDebugPopupRef}>
          <button
            type="button"
            className="bento-card-info-icon"
            title="State criteria"
            onClick={handleStateDebugClick}
            aria-expanded={showStateDebugPopup}
            aria-haspopup="dialog"
          >
            <Info className="bento-card-expand-icon-svg" size={11} strokeWidth={1.5} aria-hidden />
          </button>
          {showStateDebugPopup &&
            createPortal(
              <div
                ref={stateDebugPopupContentRef}
                className="gw-legend-popup state-debug-popup gw-legend-popup-fixed"
                role="dialog"
                aria-label="Refresh state criteria"
                style={{
                  position: 'fixed',
                  left: stateDebugPopupPosition?.left ?? 0,
                  top: stateDebugPopupPosition?.top ?? 0,
                  visibility: stateDebugPopupPosition ? 'visible' : 'hidden',
                  zIndex: 9999
                }}
              >
                <div className="gw-legend-popup-title">State criteria</div>
                <dl className="state-debug-dl">
                  {stateDebugDefinitions.map(({ term, description }) => (
                    <div key={term} className="state-debug-dl-row">
                      <dt>{term}</dt>
                      <dd>{description}</dd>
                    </div>
                  ))}
                </dl>
              </div>,
              document.body
            )}
        </div>
      )}
      {showExpandIcon && !showStateDebugIcon && (
        (isGwPointsExpanded || isTotalPointsExpanded) ? (
          <div className="bento-card-expand-icons" ref={gwExpandIconsRef}>
            {isGwPointsExpanded && (
              <>
                <div
                  className="bento-card-info-icon"
                  title="Legend"
                  onClick={handleGwLegendClick}
                  role="button"
                  aria-expanded={showGwLegendPopup}
                  aria-haspopup="dialog"
                >
                  <Info className="bento-card-expand-icon-svg" size={11} strokeWidth={1.5} />
                </div>
                {showGwLegendPopup &&
                  createPortal(
                    <div
                      ref={gwLegendPopupContentRef}
                      className="gw-legend-popup gw-legend-popup-fixed"
                      role="dialog"
                      aria-label="GW points legend"
                      style={{
                        position: 'fixed',
                        left: gwLegendPopupPosition?.left ?? 0,
                        top: gwLegendPopupPosition?.top ?? 0,
                        visibility: gwLegendPopupPosition ? 'visible' : 'hidden',
                        zIndex: 9999
                      }}
                    >
                      <div className="gw-legend-popup-title">Legend</div>
                      <div className="gw-legend-popup-row">
                        <span className="gameweek-points-legend-badge rank-highlight">x</span>
                        <span className="gw-legend-popup-text">Top 10 in GW</span>
                      </div>
                      <div className="gw-legend-popup-row">
                        <span className="bento-card-captain-badge gw-legend-popup-badge-c">C</span>
                        <span className="gw-legend-popup-text">Captain</span>
                      </div>
                      <div className="gw-legend-popup-row">
                        <span className="bento-card-captain-vice-badge gw-legend-popup-badge-v">V</span>
                        <span className="gw-legend-popup-text">Vice captain</span>
                      </div>
                      <div className="gw-legend-popup-row">
                        <span className="gw-legend-popup-row-icon">
                          <span className="gw-legend-popup-dnp-badge" title="Did not play">!</span>
                        </span>
                        <span className="gw-legend-popup-text">Did not play</span>
                      </div>
                      <div className="gw-legend-popup-row">
                        <span className="gw-legend-popup-row-icon">
                          <span className="gw-legend-popup-autosub-icon gw-legend-popup-autosub-out" title="Auto-subbed out">
                            <ArrowDownRight size={12} strokeWidth={2.5} aria-hidden />
                          </span>
                        </span>
                        <span className="gw-legend-popup-text">Auto-subbed out</span>
                      </div>
                      <div className="gw-legend-popup-row">
                        <span className="gw-legend-popup-row-icon">
                          <span className="gw-legend-popup-autosub-icon gw-legend-popup-autosub-in" title="Auto-subbed in">
                            <ArrowUpRight size={12} strokeWidth={2.5} aria-hidden />
                          </span>
                        </span>
                        <span className="gw-legend-popup-text">Auto-subbed in</span>
                      </div>
                      <div className="gw-legend-popup-row">
                        <span className="gameweek-points-legend-badge defcon-achieved" aria-hidden />
                        <span className="gw-legend-popup-text">DEFCON or Save achieved</span>
                      </div>
                      <div className="gw-legend-popup-row">
                        <span className="gw-legend-popup-live-dot-wrap">
                          <span className="gw-legend-popup-live-dot" aria-hidden />
                        </span>
                        <span className="gw-legend-popup-text">Live match</span>
                      </div>
                      <div className="gw-legend-popup-row">
                        <span className="gw-legend-popup-live-dot-wrap">
                          <span className="gw-legend-popup-live-dot gw-legend-popup-complete-dot" aria-hidden />
                        </span>
                        <span className="gw-legend-popup-text">Match finished (confirmed)</span>
                      </div>
                      <div className="gw-legend-popup-row">
                        <span className="gw-legend-popup-live-dot-wrap">
                          <span className="gw-legend-popup-live-dot gw-legend-popup-provisional-dot" aria-hidden />
                        </span>
                        <span className="gw-legend-popup-text">Provisional (stats may update)</span>
                      </div>
                    </div>,
                    document.body
                  )}
              </>
            )}
            <div
              className={`bento-card-expand-icon bento-card-expand-icon--collapse${showGwLegendPopup ? ' bento-card-expand-icon--legend-open' : ''}`}
              title={showGwLegendPopup ? undefined : 'Collapse'}
              onClick={handleIconClick}
            >
              <Minimize2 className="bento-card-expand-icon-svg bento-card-collapse-x" size={11} strokeWidth={1.5} />
            </div>
          </div>
        ) : (
          <div
            className={`bento-card-expand-icon${isExpanded ? ' bento-card-expand-icon--collapse' : ''}`}
            title={isExpanded ? "Collapse" : "Expand"}
            onClick={handleIconClick}
          >
            {isExpanded ? (
              <Minimize2 className="bento-card-expand-icon-svg bento-card-collapse-x" size={11} strokeWidth={1.5} />
            ) : (
              <MoveDiagonal className="bento-card-expand-icon-svg" size={11} strokeWidth={1.5} />
            )}
          </div>
        )
      )}
      <div className="bento-card-label">
        {label}
        {id === 'gw-points' && isExpanded && subtext && (
          <span className="bento-card-label-suffix">| {subtext}</span>
        )}
      </div>
      
      {loading ? (
        <div className="bento-card-value loading">
          <div className="skeleton-text"></div>
        </div>
      ) : id === 'updates-debug' && isUpdatesDebug && updateTimestampsData ? (
        <div className="updates-debug-bento-content">
          <div className="updates-debug-now">Local time: {updateTimestampsData.localTimeNow}</div>
          <div className="updates-debug-table-wrapper">
            <table className="updates-debug-table league-standings-bento-table">
                  <thead>
                    <tr>
                      <th className="updates-debug-th-rank">#</th>
                      <th>Path</th>
                      <th>Source</th>
                      <th className="updates-debug-th-since">Since backend</th>
                      <th className="updates-debug-th-since">Since frontend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {updateTimestampsData.rows.map((row, i) => (
                      <tr key={`${row.path}-${row.source}`}>
                        <td className="updates-debug-rank">{i + 1}</td>
                        <td className="updates-debug-path">{row.path}</td>
                        <td className="updates-debug-source">{row.source}</td>
                        <td className="updates-debug-since">{row.timeSinceBackend ?? '—'}</td>
                        <td className="updates-debug-since">{row.timeSince}</td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : id === 'gw-debug' && isGwDebug ? (
        <div className="gw-debug-bento-content">
          {gameweekDebugLoading ? (
            <div className="bento-card-value loading">
              <div className="skeleton-text"></div>
            </div>
          ) : !gameweekDebugData?.gameweekRow ? (
            <div className="gw-debug-empty">No current gameweek</div>
          ) : (
            <>
              <table className="gw-debug-table">
                <tbody>
                  <tr><td className="gw-debug-table-label">id</td><td>{gameweekDebugData.gameweekRow.id}</td></tr>
                  <tr><td className="gw-debug-table-label">name</td><td>{gameweekDebugData.gameweekRow.name ?? '—'}</td></tr>
                  <tr><td className="gw-debug-table-label">deadline</td><td className="gw-debug-table-mono">{formatDeadlineGw(gameweekDebugData.gameweekRow.deadline_time)}</td></tr>
                  <tr><td className="gw-debug-table-label">is_current</td><td><GwDebugBadge value={gameweekDebugData.gameweekRow.is_current} /></td></tr>
                  <tr><td className="gw-debug-table-label">is_previous</td><td><GwDebugBadge value={gameweekDebugData.gameweekRow.is_previous} /></td></tr>
                  <tr><td className="gw-debug-table-label">is_next</td><td><GwDebugBadge value={gameweekDebugData.gameweekRow.is_next} /></td></tr>
                  <tr><td className="gw-debug-table-label">finished</td><td><GwDebugBadge value={gameweekDebugData.gameweekRow.finished} /></td></tr>
                  <tr><td className="gw-debug-table-label">data_checked</td><td><GwDebugBadge value={gameweekDebugData.gameweekRow.data_checked} /></td></tr>
                  <tr><td className="gw-debug-table-label">fpl_ranks_updated</td><td><GwDebugBadge value={gameweekDebugData.gameweekRow.fpl_ranks_updated} /></td></tr>
                </tbody>
              </table>
              <div className="gw-debug-fixtures-wrap">
                <div className="gw-debug-fixtures-title">Fixtures</div>
                {!gameweekDebugData.fixtures?.length ? (
                  <div className="gw-debug-empty">No fixtures</div>
                ) : (
                  <table className="gw-debug-table gw-debug-fixtures-table">
                    <thead>
                      <tr>
                        <th>Match</th>
                        <th>started</th>
                        <th>finished</th>
                        <th>prov</th>
                        <th>min</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gameweekDebugData.fixtures.map((f) => (
                        <tr key={f.fpl_fixture_id}>
                          <td className="gw-debug-match-cell">{f.home_short} {f.home_score ?? '–'} – {f.away_score ?? '–'} {f.away_short}</td>
                          <td><GwDebugBadge value={f.started} /></td>
                          <td><GwDebugBadge value={f.finished} /></td>
                          <td><GwDebugBadge value={f.finished_provisional} /></td>
                          <td>{f.minutes != null ? `${f.minutes}'` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </div>
      ) : id === 'captain' && !isExpanded ? (
        <div className="bento-card-captain-collapsed">
          <div className="bento-card-value bento-card-captain-row">
            <span className="bento-card-captain-name">{captainName ?? '—'}</span>
            <span className="bento-card-captain-badge">C</span>
          </div>
          <div className="bento-card-captain-vice-row">
            <span className="bento-card-captain-vice-name">{viceCaptainName ?? '—'}</span>
            <span className="bento-card-captain-vice-badge">V</span>
          </div>
        </div>
      ) : isTransfers && value !== undefined && !isExpanded ? (
        <div className="bento-card-transfers-row">
          <div className="bento-card-transfers-value-wrap">
            <div className={`bento-card-value bento-card-transfers-value${value === '—' ? ' bento-card-transfers-value-muted' : ''}`}>{value}</div>
            {(() => {
              const chipBadge = getChipBadgeInfo(transfersSummary?.activeChip ?? null, gameweek)
              return chipBadge ? (
                <div
                  className="bento-card-transfers-chip-badge bento-card-transfers-chip-badge--colored"
                  style={{ backgroundColor: chipBadge.color, color: '#fff' }}
                >
                  {chipBadge.label}
                </div>
              ) : null
            })()}
          </div>
          {transfersSummary?.transfers?.length > 0 ? (
            <div className="bento-card-transfers-list-wrap">
              <div className="bento-card-transfers-list-scroll">
                <div className="bento-card-transfers-list">
                  {transfersSummary.transfers.map((t, i) => (
                    <div key={i} className="bento-card-transfer-item">
                      <span className="bento-card-transfer-out">{t.playerOutName}</span>
                      <span className="bento-card-transfer-arrow">→</span>
                      <span className="bento-card-transfer-in">{t.playerInName}</span>
                      {t.pointImpact != null && (
                        <span className={`bento-card-transfer-delta ${t.pointImpact > 0 ? 'positive' : t.pointImpact < 0 ? 'negative' : 'neutral'}`}>
                          {t.pointImpact >= 0 ? '+' : ''}{t.pointImpact}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              {transfersSummary.transfers.length > 3 && (
                <div className="bento-card-transfers-scroll-hint" aria-hidden title="Scroll to view all transfers">
                  <ChevronDown size={14} strokeWidth={2} />
                </div>
              )}
            </div>
          ) : null}
        </div>
      ) : value !== undefined && id !== 'gw-debug' ? (
        <>
          {!(id === 'league-rank' && isExpanded) && (
            <div className={`bento-card-value ${id === 'league-rank' ? 'bento-card-value-with-inline-change' : ''}`}>
              {value}
              {isStale && <span className="stale-indicator" title="Data may be out of date during live games">!</span>}
              {isLiveUpdating && (
                <span
                  className={`live-updating-indicator${isProvisionalOnly ? ' live-updating-indicator--provisional' : ''}`}
                  title={isProvisionalOnly ? 'Provisional: stats may update when bonus is confirmed' : 'Values can change at any moment during live games'}
                  aria-hidden
                />
              )}
            </div>
          )}
          {id !== 'league-rank' && change !== undefined && change !== 0 && (
            <div className={`bento-card-change ${change > 0 ? 'positive' : 'negative'}`}>
              {change > 0 ? <CircleArrowUp size={14} /> : <CircleArrowDown size={14} />} {formatNumber(Math.abs(change))}
            </div>
          )}
          {id === 'league-rank' && !isExpanded && change !== undefined && change !== 0 && (
            <div className="bento-card-change-in-subtext">
              <span className={`bento-card-change-inline ${change > 0 ? 'positive' : 'negative'}`}>
                {change > 0 ? <CircleArrowUp size={14} /> : <CircleArrowDown size={14} />} {formatNumber(Math.abs(change))}
              </span>
            </div>
          )}
        </>
      ) : null}
      
      {subtext && !(id === 'gw-points' && isExpanded) && (
        id === 'gw-points' ? (
          <div className="bento-card-subtext-row">
            <div className="bento-card-subtext">{subtext}</div>
          </div>
        ) : (
          <div className="bento-card-subtext">{subtext}</div>
        )
      )}
      
      {isChart && (
        <div className="bento-card-chart">
          {id === 'team-value' ? (
            <TeamValueChart
              data={chartData || []}
              comparisonData={chartComparisonData}
              filter={chartFilter}
              showComparison={showChartComparison}
              loading={loading}
              onFilterChange={onChartFilterChange}
            />
          ) : (
            <PerformanceChart
              data={chartData || []}
              comparisonData={chartComparisonData}
              filter={chartFilter}
              showComparison={showChartComparison}
              loading={loading}
              onFilterChange={onChartFilterChange}
              showTop10Lines={showTop10Lines}
              top10LinesData={top10LinesData}
              onShowTop10Change={onShowTop10Change}
              currentManagerId={currentManagerId}
            />
          )}
        </div>
      )}
      
      {isExpanded && id === 'total-points' && (
        <div className="bento-card-chart">
          <PlayerPerformanceChart
            data={playerChartData || []}
            loading={loading}
            filter={playerChartFilter}
            onFilterChange={onPlayerChartFilterChange}
          />
        </div>
      )}
      
      {isExpanded && id === 'gw-points' && (
        <div className="bento-card-chart">
          <GameweekPointsView
            data={currentGameweekPlayersData || []}
            loading={loading}
            top10ByStat={top10ByStat}
            impactByPlayerId={impactByPlayerId ?? {}}
            isLiveUpdating={isLiveUpdating}
            fixtures={gameweekDebugData?.fixtures ?? []}
          />
        </div>
      )}
      
      {isExpanded && id === 'transfers' && (() => {
        const outList = leagueTopTransfersOut || []
        const inList = leagueTopTransfersIn || []
        const expandedChipBadge = getChipBadgeInfo(transfersSummary?.activeChip ?? null, gameweek)
        return (
          <div className="transfers-summary-card">
            <div className="transfers-summary-content">
              {(transfersSummary != null || expandedChipBadge) && (
                <div className="transfers-summary-header-row">
                  {transfersSummary != null && (
                    <span className="transfers-summary-header-value">{transfersSummary.used} of {transfersSummary.available}</span>
                  )}
                  {expandedChipBadge && (
                    <span
                      className="bento-card-transfers-chip-badge bento-card-transfers-chip-badge--colored"
                      style={{ backgroundColor: expandedChipBadge.color, color: '#fff' }}
                    >
                      {expandedChipBadge.label}
                    </span>
                  )}
                </div>
              )}
              <div className="transfers-summary-columns-wrapper">
                <div className="transfers-summary-column transfers-summary-column-out">
                  <div className="transfers-summary-column-header">
                    <span className="transfers-summary-column-title transfers-summary-column-title-out">→OUT</span>
                  </div>
                  {leagueTopTransfersLoading ? (
                    <div className="transfers-summary-loading">Loading...</div>
                  ) : outList.length === 0 ? (
                    <div className="transfers-summary-empty">No data</div>
                  ) : (
                    <div className="transfers-summary-column-list">
                      {outList.map((row, i) => (
                        <div key={i} className="transfers-summary-column-item">
                          <span className="transfers-summary-badge-slot">
                            {row.teamShortName ? (
                              <img
                                src={`/badges/${row.teamShortName}.svg`}
                                alt=""
                                className="transfers-summary-badge"
                              />
                            ) : (
                              <span className="transfers-summary-badge-placeholder" aria-hidden />
                            )}
                          </span>
                          <span className="transfers-summary-column-name">{row.playerName}</span>
                          <span className="transfers-summary-column-count">{row.count}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="transfers-summary-column transfers-summary-column-in">
                  <div className="transfers-summary-column-header">
                    <span className="transfers-summary-column-title transfers-summary-column-title-in">←IN</span>
                  </div>
                  {leagueTopTransfersLoading ? (
                    <div className="transfers-summary-loading">Loading...</div>
                  ) : inList.length === 0 ? (
                    <div className="transfers-summary-empty">No data</div>
                  ) : (
                    <div className="transfers-summary-column-list">
                      {inList.map((row, i) => (
                        <div key={i} className="transfers-summary-column-item">
                          <span className="transfers-summary-badge-slot">
                            {row.teamShortName ? (
                              <img
                                src={`/badges/${row.teamShortName}.svg`}
                                alt=""
                                className="transfers-summary-badge"
                              />
                            ) : (
                              <span className="transfers-summary-badge-placeholder" aria-hidden />
                            )}
                          </span>
                          <span className="transfers-summary-column-name">{row.playerName}</span>
                          <span className="transfers-summary-column-count">{row.count}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )
      })()}
      
      {isChips && !isExpanded && (
        <div className="chips-pages-wrapper">
          <div className="chips-grid chips-grid-collapsed">
            {renderChipItems(collapsedChipItems)}
          </div>
        </div>
      )}

      {isExpanded && id === 'chips' && (
        <div className="chips-pages-wrapper chips-pages-wrapper--expanded">
          <div className="league-standings-bento chips-standings-bento">
            <div className="league-standings-bento-table-wrapper">
              {leagueChipsLoading ? (
                <div className="league-standings-bento-loading">Loading league chips…</div>
              ) : !leagueChipData?.length ? (
                <div className="league-standings-bento-empty">No managers in this league</div>
              ) : (
                <>
                  <div className="chips-status-header">
                    <div className="chips-status-cell chips-status-rank">Rank</div>
                    <div className="chips-status-cell chips-status-manager">Manager</div>
                    {chipColumns.map(({ key, label }) => (
                      <div key={key} className="chips-status-cell chips-status-chip-col">
                        {label}
                      </div>
                    ))}
                  </div>
                  <div className="chips-status-list">
                    {leagueChipData.map(({ manager_id, manager_name, rank, chipUsage: usage }) => {
                      const isCurrentUser = currentManagerId != null && manager_id === currentManagerId
                      return (
                      <div key={manager_id} className={`chips-status-row${isCurrentUser ? ' chips-status-row-you' : ''}`}>
                        <div className="chips-status-cell chips-status-rank">
                          {rank != null ? rank : '—'}
                        </div>
                        <div className="chips-status-cell chips-status-manager" title={manager_name}>
                          {manager_name}
                        </div>
                        {chipColumns.map(({ key }) => {
                          const gw = usage?.[key]
                          return (
                            <div key={key} className="chips-status-cell chips-status-chip-col">
                              {gw ? <span className="chips-status-played">GW{gw}</span> : <span className="chips-status-left">—</span>}
                            </div>
                          )
                        })}
                      </div>
                    )
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {isExpanded && id === 'league-rank' && (
        <div className="league-standings-bento">
          <div className="league-standings-bento-table-wrapper">
            {leagueStandingsLoading ? (
              <div className="league-standings-bento-loading">Loading standings…</div>
            ) : !leagueStandings?.length ? (
              <div className="league-standings-bento-empty">No league configured or no standings</div>
            ) : (
              <table className="league-standings-bento-table">
                <thead>
                  <tr>
                    <th className="league-standings-bento-rank">Rank</th>
                    <th className="league-standings-bento-team">Manager</th>
                    <th className="league-standings-bento-total">Total</th>
                    <th className="league-standings-bento-gw">GW</th>
                  </tr>
                </thead>
                <tbody>
                  {leagueStandings.map((s, index) => {
                    // Use calculated_rank from MV (correct per league); mini_league_rank can be from another league
                    const rank = s.calculated_rank != null ? s.calculated_rank : (s.mini_league_rank != null ? s.mini_league_rank : index + 1)
                    // Use calculated_rank_change from MV (per-league); mini_league_rank_change can be from another league
                    const change = s.calculated_rank_change != null ? s.calculated_rank_change : (s.mini_league_rank_change != null ? s.mini_league_rank_change : null)
                    const displayName = (s.manager_team_name && s.manager_team_name.trim()) ? s.manager_team_name : (s.manager_name || `Manager ${s.manager_id}`)
                    const isCurrentUser = currentManagerId != null && s.manager_id === currentManagerId
                    return (
                      <tr key={s.manager_id} className={isCurrentUser ? 'league-standings-bento-row-you' : ''}>
                        <td className="league-standings-bento-rank">
                          <span className="league-standings-bento-rank-inner">
                            <span className="league-standings-bento-rank-value">{rank}</span>
                            {change !== null && change !== 0 ? (
                              <span className={`league-standings-bento-change-badge ${change > 0 ? 'positive' : 'negative'}`}>
                                {Math.abs(change) >= 2
                                  ? (change > 0 ? <ChevronsUp size={12} /> : <ChevronsDown size={12} />)
                                  : (change > 0 ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}{' '}
                                {Math.abs(change)}
                              </span>
                            ) : null}
                          </span>
                        </td>
                        <td className="league-standings-bento-team" title={displayName}>{displayName}</td>
                        <td className={`league-standings-bento-total ${(s.total_points ?? null) === 0 ? 'league-standings-bento-cell-muted' : ''}`}>{s.total_points ?? '—'}</td>
                        <td className={`league-standings-bento-gw ${(s.gameweek_points ?? null) === 0 ? 'league-standings-bento-cell-muted' : ''}`}>{s.gameweek_points ?? '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {isExpanded && id === 'captain' && (
        <div className="league-standings-bento captain-standings-bento">
          <div className="league-standings-bento-table-wrapper">
            {leagueCaptainLoading ? (
              <div className="league-standings-bento-loading">Loading captain picks…</div>
            ) : !leagueCaptainData?.length ? (
              <div className="league-standings-bento-empty">No league configured or no captain data</div>
            ) : (
              <table className="league-standings-bento-table captain-standings-bento-table">
                <thead>
                  <tr>
                    <th className="league-standings-bento-rank">Rank</th>
                    <th className="league-standings-bento-team">Manager</th>
                    <th className="captain-standings-bento-captain">
                      <span className="captain-standings-bento-header-cell">
                        Captain <span className="captain-standings-bento-badge-c">C</span>
                      </span>
                    </th>
                    <th className="captain-standings-bento-vice">
                      <span className="captain-standings-bento-header-cell">
                        Vice <span className="captain-standings-bento-badge-v">V</span>
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {leagueCaptainData.map((row) => {
                    const isCurrentUser = currentManagerId != null && row.manager_id === currentManagerId
                    return (
                      <tr key={row.manager_id} className={isCurrentUser ? 'league-standings-bento-row-you' : ''}>
                        <td className="league-standings-bento-rank">{row.rank ?? '—'}</td>
                        <td className="league-standings-bento-team" title={row.manager_team_name}>{row.manager_team_name}</td>
                        <td className="captain-standings-bento-captain" title={row.captain_name}>
                          <span className="captain-standings-bento-player-cell">
                            {row.captain_team_short_name && (
                              <img
                                src={`/badges/${row.captain_team_short_name}.svg`}
                                alt=""
                                className="captain-standings-bento-player-badge"
                                onError={(e) => { e.target.style.display = 'none' }}
                              />
                            )}
                            <span className="captain-standings-bento-player-name">{row.captain_name}</span>
                          </span>
                        </td>
                        <td className="captain-standings-bento-vice" title={row.vice_captain_name}>
                          <span className="captain-standings-bento-player-cell">
                            {row.vice_captain_team_short_name && (
                              <img
                                src={`/badges/${row.vice_captain_team_short_name}.svg`}
                                alt=""
                                className="captain-standings-bento-player-badge"
                                onError={(e) => { e.target.style.display = 'none' }}
                              />
                            )}
                            <span className="captain-standings-bento-player-name">{row.vice_captain_name}</span>
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
      
      {isSettings && (
        <div className="settings-bento-content">
          <button className="settings-bento-button" onClick={cycleTheme} title={`Theme: ${getThemeValueLabel()}`}>
            {getThemeIcon()}
            Theme
          </button>
          <button className="settings-bento-button configure-bento-button" onClick={onConfigureClick}>
            <Settings className="settings-icon" size={11} strokeWidth={1.5} />
            Customize
          </button>
          {onDebugClick && (
            <button className="settings-bento-button" onClick={onDebugClick} title="Debug" aria-label="Debug">
              <Bug className="settings-icon" size={11} strokeWidth={1.5} />
              Debug
            </button>
          )}
        </div>
      )}
    </div>
  )
}
