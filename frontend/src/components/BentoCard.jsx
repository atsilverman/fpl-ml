import './BentoCard.css'
import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { formatNumber } from '../utils/formatNumbers'
import PerformanceChart from './PerformanceChart'
import TeamValueChart from './TeamValueChart'
import PlayerPerformanceChart from './PlayerPerformanceChart'
import GameweekPointsView from './GameweekPointsView'
import AnimatedValue from './AnimatedValue'
import { useTheme } from '../contexts/ThemeContext'
import { Sun, Moon, Laptop, Settings, Bug, MoveDiagonal, Minimize2, Info, CircleArrowUp, CircleArrowDown, ChevronUp, ChevronDown, ChevronsUp, ChevronsDown, ArrowDownRight, ArrowUpRight, TriangleAlert, Users, Filter, X } from 'lucide-react'

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
  '3xc': { label: () => 'TC', color: '#b91c1c' } /* red-700: distinct from captain (C) orange */
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
  animateEntrance = true,
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
  playerChartStatKey = 'total_points',
  onPlayerChartFilterChange = null,
  onPlayerChartStatChange = null,
  playerChartExcludeHaaland = undefined,
  onPlayerChartExcludeHaalandChange = null,
  playerChartHideFilterControls = false,
  playerPointsByGameweek = null,
  currentGameweekPlayersData = null,
  gameweekFixturesFromPlayers = null,
  gameweekFixturesFromFPL = null,
  gameweekFixturesFromMatches = null,
  top10ByStat = null,
  showTop10Fill = true,
  impactByPlayerId = null,
  gameweek = null,
  leagueChipData = null,
  leagueChipsLoading = false,
  leagueStandings = null,
  leagueStandingsLoading = false,
  currentManagerGwPoints = null,
  currentManagerTotalPoints = null,
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
  updateTimestampsData = null,
  onPlayerRowClick = null,
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
  const [showTotalPointsFilterPopup, setShowTotalPointsFilterPopup] = useState(false)
  const totalPointsFilterPopupRef = useRef(null)
  const [showOverallRankFilterPopup, setShowOverallRankFilterPopup] = useState(false)
  const overallRankFilterPopupRef = useRef(null)
  const [showTeamValueFilterPopup, setShowTeamValueFilterPopup] = useState(false)
  const teamValueFilterPopupRef = useRef(null)

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

  useEffect(() => {
    if (!showTotalPointsFilterPopup || id !== 'total-points') return
    const handleClickOutside = (e) => {
      if (totalPointsFilterPopupRef.current && totalPointsFilterPopupRef.current.contains(e.target)) return
      if (e.target.closest('.bento-card-total-points-filter-btn')) return
      setShowTotalPointsFilterPopup(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showTotalPointsFilterPopup, id])

  useEffect(() => {
    if (!showOverallRankFilterPopup || id !== 'overall-rank') return
    const handleClickOutside = (e) => {
      if (overallRankFilterPopupRef.current && overallRankFilterPopupRef.current.contains(e.target)) return
      if (e.target.closest('.bento-card-overall-rank-filter-btn')) return
      setShowOverallRankFilterPopup(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showOverallRankFilterPopup, id])

  useEffect(() => {
    if (!showTeamValueFilterPopup || id !== 'team-value') return
    const handleClickOutside = (e) => {
      if (teamValueFilterPopupRef.current && teamValueFilterPopupRef.current.contains(e.target)) return
      if (e.target.closest('.bento-card-team-value-filter-btn')) return
      setShowTeamValueFilterPopup(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showTeamValueFilterPopup, id])

  const { themeMode, cycleTheme } = useTheme()
  const isTransfersExpanded = id === 'transfers' && isExpanded
  const overallRankBorderClass =
    id === 'overall-rank'
      ? isStale
        ? 'bento-card-rank-border-stale'
        : change != null && change !== 0
          ? change > 0
            ? 'bento-card-overall-rank-border-positive'
            : 'bento-card-overall-rank-border-negative'
          : null
      : null
  const leagueRankBorderClass =
    id === 'league-rank' && change != null && change !== 0
      ? isStale
        ? 'bento-card-rank-border-stale'
        : change > 0
          ? 'bento-card-league-rank-border-positive'
          : 'bento-card-league-rank-border-negative'
      : null
  const gwRankBorderClass =
    id === 'gw-rank' && isStale ? 'bento-card-rank-border-stale' : null
  const cardClasses = [
    'bento-card',
    animateEntrance && 'bento-card-animate',
    className,
    overallRankBorderClass,
    leagueRankBorderClass,
    gwRankBorderClass,
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
  const showExpandIcon = id === 'overall-rank' || id === 'team-value' || id === 'total-points' || id === 'gw-points'
  const showStateDebugIcon = id === 'refresh-state' && stateDebugDefinitions?.length

  const handleStateDebugClick = (e) => {
    e.stopPropagation()
    setShowStateDebugPopup((v) => !v)
  }

  return (
    <div className={cardClasses} style={style}>
      {id === 'total-points' && showTotalPointsFilterPopup && typeof document !== 'undefined' && createPortal(
        <div className="stats-filter-overlay" role="dialog" aria-modal="true" aria-label="Total points filters">
          <div className="stats-filter-overlay-backdrop" onClick={() => setShowTotalPointsFilterPopup(false)} aria-hidden />
          <div className="stats-filter-overlay-panel" ref={totalPointsFilterPopupRef}>
            <div className="stats-filter-overlay-header">
              <span className="stats-filter-overlay-title">Filters</span>
              <div className="stats-filter-overlay-header-actions">
                {(playerChartFilter !== 'last12' || playerChartExcludeHaaland) && (
                  <button
                    type="button"
                    className="stats-filter-overlay-reset"
                    onClick={() => {
                      onPlayerChartFilterChange && onPlayerChartFilterChange('last12')
                      onPlayerChartExcludeHaalandChange && onPlayerChartExcludeHaalandChange(false)
                    }}
                    aria-label="Reset all filters to default"
                  >
                    Reset
                  </button>
                )}
                <button type="button" className="stats-filter-overlay-close" onClick={() => setShowTotalPointsFilterPopup(false)} aria-label="Close filters">
                  <X size={20} strokeWidth={2} />
                </button>
              </div>
            </div>
            <div className="stats-filter-overlay-body">
              <div className="bento-total-points-filter-sections">
                <div className="bento-total-points-filter-section">
                  <div className="bento-total-points-filter-section-title">Range</div>
                  <div className="bento-total-points-filter-buttons">
                    <button
                      type="button"
                      className={`bento-total-points-filter-btn ${playerChartFilter === 'all' ? 'bento-total-points-filter-btn--active' : ''}`}
                      onClick={() => onPlayerChartFilterChange && onPlayerChartFilterChange('all')}
                      aria-pressed={playerChartFilter === 'all'}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      className={`bento-total-points-filter-btn ${playerChartFilter === 'last12' ? 'bento-total-points-filter-btn--active' : ''}`}
                      onClick={() => onPlayerChartFilterChange && onPlayerChartFilterChange('last12')}
                      aria-pressed={playerChartFilter === 'last12'}
                    >
                      Last 12
                    </button>
                    <button
                      type="button"
                      className={`bento-total-points-filter-btn ${playerChartFilter === 'last6' ? 'bento-total-points-filter-btn--active' : ''}`}
                      onClick={() => onPlayerChartFilterChange && onPlayerChartFilterChange('last6')}
                      aria-pressed={playerChartFilter === 'last6'}
                    >
                      Last 6
                    </button>
                  </div>
                </div>
                <div className="bento-total-points-filter-section">
                  <div className="bento-total-points-filter-section-title">Players</div>
                  <div className="bento-total-points-filter-buttons">
                    <button
                      type="button"
                      className={`bento-total-points-filter-btn bento-total-points-filter-btn--exclude ${playerChartExcludeHaaland ? 'bento-total-points-filter-btn--active' : ''}`}
                      onClick={() => onPlayerChartExcludeHaalandChange && onPlayerChartExcludeHaalandChange(!playerChartExcludeHaaland)}
                      aria-pressed={playerChartExcludeHaaland}
                      title="Exclude Haaland from view and recalculate percentages"
                    >
                      Exclude Haaland
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div className="stats-filter-overlay-footer">
              <button type="button" className="stats-filter-overlay-done" onClick={() => setShowTotalPointsFilterPopup(false)} aria-label="Done">
                Done
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      {id === 'overall-rank' && showOverallRankFilterPopup && typeof document !== 'undefined' && createPortal(
        <div className="stats-filter-overlay" role="dialog" aria-modal="true" aria-label="Overall rank filters">
          <div className="stats-filter-overlay-backdrop" onClick={() => setShowOverallRankFilterPopup(false)} aria-hidden />
          <div className="stats-filter-overlay-panel" ref={overallRankFilterPopupRef}>
            <div className="stats-filter-overlay-header">
              <span className="stats-filter-overlay-title">Filters</span>
              <div className="stats-filter-overlay-header-actions">
                {(chartFilter !== 'last12' || showTop10Lines) && (
                  <button
                    type="button"
                    className="stats-filter-overlay-reset"
                    onClick={() => {
                      onChartFilterChange && onChartFilterChange('last12')
                      if (showTop10Lines && onShowTop10Change) onShowTop10Change()
                    }}
                    aria-label="Reset all filters to default"
                  >
                    Reset
                  </button>
                )}
                <button type="button" className="stats-filter-overlay-close" onClick={() => setShowOverallRankFilterPopup(false)} aria-label="Close filters">
                  <X size={20} strokeWidth={2} />
                </button>
              </div>
            </div>
            <div className="stats-filter-overlay-body">
              <div className="bento-total-points-filter-sections">
                <div className="bento-total-points-filter-section">
                  <div className="bento-total-points-filter-section-title">Range</div>
                  <div className="bento-total-points-filter-buttons">
                    <button
                      type="button"
                      className={`bento-total-points-filter-btn ${chartFilter === 'all' ? 'bento-total-points-filter-btn--active' : ''}`}
                      onClick={() => onChartFilterChange && onChartFilterChange('all')}
                      aria-pressed={chartFilter === 'all'}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      className={`bento-total-points-filter-btn ${chartFilter === 'last12' ? 'bento-total-points-filter-btn--active' : ''}`}
                      onClick={() => onChartFilterChange && onChartFilterChange('last12')}
                      aria-pressed={chartFilter === 'last12'}
                    >
                      Last 12
                    </button>
                    <button
                      type="button"
                      className={`bento-total-points-filter-btn ${chartFilter === 'last6' ? 'bento-total-points-filter-btn--active' : ''}`}
                      onClick={() => onChartFilterChange && onChartFilterChange('last6')}
                      aria-pressed={chartFilter === 'last6'}
                    >
                      Last 6
                    </button>
                  </div>
                </div>
                {onShowTop10Change != null && (
                  <div className="bento-total-points-filter-section">
                    <div className="bento-total-points-filter-section-title">Chart</div>
                    <div className="bento-total-points-filter-buttons">
                      <button
                        type="button"
                        className={`bento-total-points-filter-btn ${showTop10Lines ? 'bento-total-points-filter-btn--active' : ''}`}
                        onClick={() => onShowTop10Change()}
                        aria-pressed={showTop10Lines}
                        title={showTop10Lines ? 'Hide mini league leader line' : 'Show mini league leader line'}
                      >
                        Compare
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="stats-filter-overlay-footer">
              <button type="button" className="stats-filter-overlay-done" onClick={() => setShowOverallRankFilterPopup(false)} aria-label="Done">
                Done
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      {id === 'team-value' && showTeamValueFilterPopup && typeof document !== 'undefined' && createPortal(
        <div className="stats-filter-overlay" role="dialog" aria-modal="true" aria-label="Team value filters">
          <div className="stats-filter-overlay-backdrop" onClick={() => setShowTeamValueFilterPopup(false)} aria-hidden />
          <div className="stats-filter-overlay-panel" ref={teamValueFilterPopupRef}>
            <div className="stats-filter-overlay-header">
              <span className="stats-filter-overlay-title">Filters</span>
              <div className="stats-filter-overlay-header-actions">
                {chartFilter !== 'last12' && (
                  <button
                    type="button"
                    className="stats-filter-overlay-reset"
                    onClick={() => onChartFilterChange && onChartFilterChange('last12')}
                    aria-label="Reset all filters to default"
                  >
                    Reset
                  </button>
                )}
                <button type="button" className="stats-filter-overlay-close" onClick={() => setShowTeamValueFilterPopup(false)} aria-label="Close filters">
                  <X size={20} strokeWidth={2} />
                </button>
              </div>
            </div>
            <div className="stats-filter-overlay-body">
              <div className="bento-total-points-filter-sections">
                <div className="bento-total-points-filter-section">
                  <div className="bento-total-points-filter-section-title">Range</div>
                  <div className="bento-total-points-filter-buttons">
                    <button
                      type="button"
                      className={`bento-total-points-filter-btn ${chartFilter === 'all' ? 'bento-total-points-filter-btn--active' : ''}`}
                      onClick={() => onChartFilterChange && onChartFilterChange('all')}
                      aria-pressed={chartFilter === 'all'}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      className={`bento-total-points-filter-btn ${chartFilter === 'last12' ? 'bento-total-points-filter-btn--active' : ''}`}
                      onClick={() => onChartFilterChange && onChartFilterChange('last12')}
                      aria-pressed={chartFilter === 'last12'}
                    >
                      Last 12
                    </button>
                    <button
                      type="button"
                      className={`bento-total-points-filter-btn ${chartFilter === 'last6' ? 'bento-total-points-filter-btn--active' : ''}`}
                      onClick={() => onChartFilterChange && onChartFilterChange('last6')}
                      aria-pressed={chartFilter === 'last6'}
                    >
                      Last 6
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div className="stats-filter-overlay-footer">
              <button type="button" className="stats-filter-overlay-done" onClick={() => setShowTeamValueFilterPopup(false)} aria-label="Done">
                Done
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
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
                        <span className="gw-legend-popup-live-dot-wrap">
                          <span className="gw-legend-popup-live-dot" aria-hidden />
                        </span>
                        <span className="gw-legend-popup-text">Live match</span>
                      </div>
                      <div className="gw-legend-popup-row">
                        <span className="gw-legend-popup-row-icon">
                          <span className="gw-legend-popup-mp-dot gw-legend-popup-mp-dot--red" aria-hidden />
                        </span>
                        <span className="gw-legend-popup-text">Under 45' MP</span>
                      </div>
                      <div className="gw-legend-popup-row">
                        <span className="gw-legend-popup-row-icon">
                          <span className="gw-legend-popup-mp-dot gw-legend-popup-mp-dot--orange" aria-hidden />
                        </span>
                        <span className="gw-legend-popup-text">Under 80' MP</span>
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
                        <span className="gw-legend-popup-row-icon">
                          <span className="gw-legend-popup-top10-swatch" aria-hidden />
                        </span>
                        <span className="gw-legend-popup-text">Top 10 in GW</span>
                      </div>
                      <div className="gw-legend-popup-row">
                        <span className="gw-legend-popup-row-icon">
                          <span className="gw-legend-popup-impact-bar" aria-hidden />
                        </span>
                        <span className="gw-legend-popup-text">Importance</span>
                      </div>
                      <div className="gw-legend-popup-row">
                        <span className="gw-legend-popup-row-icon">
                          <span className="gw-legend-popup-fpl-impact-pill" aria-hidden />
                        </span>
                        <span className="gw-legend-popup-text">FPL points impact</span>
                      </div>
                    </div>,
                    document.body
                  )}
              </>
            )}
            {isTotalPointsExpanded && (
              <button
                type="button"
                className={`bento-card-total-points-filter-btn${(playerChartFilter !== 'all' || playerChartExcludeHaaland) ? ' bento-card-total-points-filter-btn--active' : ''}`}
                aria-label="Filter players"
                aria-expanded={showTotalPointsFilterPopup}
                aria-haspopup="dialog"
                title="Filter players"
                onClick={(e) => {
                  e.stopPropagation()
                  setShowTotalPointsFilterPopup((v) => !v)
                }}
              >
                <Filter className="bento-card-expand-icon-svg" size={11} strokeWidth={1.5} aria-hidden />
              </button>
            )}
            <div
              className={`bento-card-expand-icon bento-card-expand-icon--collapse${showGwLegendPopup ? ' bento-card-expand-icon--legend-open' : ''}`}
              title={showGwLegendPopup ? undefined : 'Collapse'}
              onClick={handleIconClick}
            >
              <Minimize2 className="bento-card-expand-icon-svg bento-card-collapse-x" size={11} strokeWidth={1.5} />
            </div>
          </div>
        ) : id === 'overall-rank' && isExpanded ? (
          <div className="bento-card-expand-icons">
            <button
              type="button"
              className={`bento-card-overall-rank-filter-btn ${chartFilter !== 'all' || showTop10Lines ? 'bento-card-overall-rank-filter-btn--active' : ''}`}
              aria-label="Filter chart"
              aria-expanded={showOverallRankFilterPopup}
              aria-haspopup="dialog"
              title="Filter chart"
              onClick={(e) => {
                e.stopPropagation()
                setShowOverallRankFilterPopup((v) => !v)
              }}
            >
              <Filter className="bento-card-expand-icon-svg" size={11} strokeWidth={1.5} aria-hidden />
            </button>
            <div
              className="bento-card-expand-icon bento-card-expand-icon--collapse"
              title="Collapse"
              onClick={handleIconClick}
            >
              <Minimize2 className="bento-card-expand-icon-svg bento-card-collapse-x" size={11} strokeWidth={1.5} />
            </div>
          </div>
        ) : id === 'team-value' && isExpanded ? (
          <div className="bento-card-expand-icons">
            <button
              type="button"
              className={`bento-card-team-value-filter-btn ${chartFilter !== 'all' ? 'bento-card-team-value-filter-btn--active' : ''}`}
              aria-label="Filter chart"
              aria-expanded={showTeamValueFilterPopup}
              aria-haspopup="dialog"
              title="Filter chart"
              onClick={(e) => {
                e.stopPropagation()
                setShowTeamValueFilterPopup((v) => !v)
              }}
            >
              <Filter className="bento-card-expand-icon-svg" size={11} strokeWidth={1.5} aria-hidden />
            </button>
            <div
              className="bento-card-expand-icon bento-card-expand-icon--collapse"
              title="Collapse"
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
      <div className={id === 'gw-points' && isExpanded ? 'bento-card-label-row bento-card-label-row--gw-expanded' : 'bento-card-label'}>
        {id === 'gw-points' && isExpanded && value !== undefined && (
          <span className="bento-card-label-gw-value">
            <AnimatedValue value={value}>{value}</AnimatedValue>
          </span>
        )}
        <span className={id === 'gw-points' && isExpanded ? 'bento-card-label-text' : undefined}>
          {label}
          {id === 'gw-points' && isExpanded && subtext && (
            <span className="bento-card-label-suffix">| {subtext}</span>
          )}
        </span>
      </div>
      
      {loading ? (
        <div className="bento-card-value loading" aria-busy="true" />
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
            <div className="bento-card-value loading" aria-busy="true" />
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
                        <th title="Match clock (max MP from player stats; aligned with GW points / matchup)">clock</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gameweekDebugData.fixtures.map((f) => (
                        <tr key={f.fpl_fixture_id}>
                          <td className="gw-debug-match-cell">{f.home_short} {f.home_score ?? '–'} – {f.away_score ?? '–'} {f.away_short}</td>
                          <td><GwDebugBadge value={f.started} /></td>
                          <td><GwDebugBadge value={f.finished} /></td>
                          <td><GwDebugBadge value={f.finished_provisional} /></td>
                          <td>{f.clock_minutes != null ? `${f.clock_minutes}'` : '—'}</td>
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
              const activeChip = transfersSummary?.activeChip ?? null
              const chipBadge = getChipBadgeInfo(activeChip, gameweek)
              const chip = typeof activeChip === 'string' ? activeChip.toLowerCase() : null
              const showChipBadge = chipBadge && (chip === 'wildcard' || chip === 'freehit')
              return showChipBadge ? (
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
          {!(id === 'league-rank' && isExpanded) && !(id === 'gw-points' && isExpanded) && (
            <div className={`bento-card-value ${id === 'league-rank' ? 'bento-card-value-with-inline-change' : ''}`}>
              <AnimatedValue value={value}>{value}</AnimatedValue>
              {isStale && (
                <span
                  className="stale-indicator"
                  title={
                    id === 'overall-rank' && change === 0
                      ? 'Rank may not be updated yet'
                      : 'Data may be out of date during live games'
                  }
                >
                  !
                </span>
              )}
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
              hideFilterUI
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
              isStale={isStale}
              hideFilterUI={id === 'overall-rank'}
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
            excludeHaaland={playerChartExcludeHaaland}
            onExcludeHaalandChange={onPlayerChartExcludeHaalandChange}
            hideFilterControls={playerChartHideFilterControls}
          />
        </div>
      )}
      
      {isExpanded && id === 'gw-points' && (
        <div className="bento-card-chart">
          <GameweekPointsView
            data={currentGameweekPlayersData || []}
            loading={loading}
            top10ByStat={top10ByStat}
            showTop10Fill={showTop10Fill}
            impactByPlayerId={impactByPlayerId ?? {}}
            isLiveUpdating={isLiveUpdating}
            fixtures={gameweekFixturesFromMatches !== undefined ? gameweekFixturesFromMatches : (gameweekFixturesFromFPL?.length ? gameweekFixturesFromFPL : (gameweekFixturesFromPlayers?.length ? gameweekFixturesFromPlayers : (gameweekDebugData?.fixtures ?? [])))}
            onPlayerRowClick={onPlayerRowClick}
            sortable={false}
          />
        </div>
      )}
      
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
                    const gwDisplay = isCurrentUser && currentManagerGwPoints != null ? currentManagerGwPoints : s.gameweek_points
                    const totalDisplay = isCurrentUser && currentManagerTotalPoints != null ? currentManagerTotalPoints : s.total_points
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
                        <td className={`league-standings-bento-total ${(totalDisplay ?? null) === 0 ? 'league-standings-bento-cell-muted' : ''}`}>{totalDisplay ?? '—'}</td>
                        <td className={`league-standings-bento-gw ${(gwDisplay ?? null) === 0 ? 'league-standings-bento-cell-muted' : ''}`}>{gwDisplay ?? '—'}</td>
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
