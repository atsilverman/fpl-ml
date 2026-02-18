import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { Search, Filter, X, UserRound, UsersRound, Home, PlaneTakeoff, Swords, ShieldHalf, Hand, Construction, Scale } from 'lucide-react'
import { useAllPlayersGameweekStats } from '../hooks/useAllPlayersGameweekStats'
import { useGameweekData } from '../hooks/useGameweekData'
import { useCurrentGameweekPlayers } from '../hooks/useCurrentGameweekPlayers'
import './ResearchPage.css'
import './BentoCard.css'
import './MiniLeaguePage.css'
import './StatsSubpage.css'

const GW_FILTER_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'last6', label: 'Last 6' },
  { key: 'last12', label: 'Last 12' }
]
const LOCATION_OPTIONS = [
  { key: 'all', label: 'All locations' },
  { key: 'home', label: 'Home' },
  { key: 'away', label: 'Away' }
]
const STAT_CATEGORY_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'attacking', label: 'Attacking' },
  { key: 'defending', label: 'Defending' },
  { key: 'goalie', label: 'Goalie' }
]
const POSITION_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: '4', label: 'FWD' },
  { key: '3', label: 'MID' },
  { key: '2', label: 'DEF' },
  { key: '1', label: 'GK' }
]

const POSITION_LABELS = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' }

/** Stat columns: key, label, field, category (all | attacking | defending | goalie) */
const STAT_COLUMNS = [
  { key: 'points', label: 'PTS', field: 'points', category: 'all' },
  { key: 'minutes', label: 'MP', field: 'minutes', category: 'all' },
  { key: 'goals_scored', label: 'G', field: 'goals_scored', category: 'attacking' },
  { key: 'assists', label: 'A', field: 'assists', category: 'attacking' },
  { key: 'expected_goals', label: 'xG', field: 'expected_goals', category: 'attacking' },
  { key: 'expected_assists', label: 'xA', field: 'expected_assists', category: 'attacking' },
  { key: 'expected_goal_involvements', label: 'xGI', field: 'expected_goal_involvements', category: 'attacking' },
  { key: 'clean_sheets', label: 'CS', field: 'clean_sheets', category: ['defending', 'goalie'] },
  { key: 'saves', label: 'S', field: 'saves', category: ['defending', 'goalie'] },
  { key: 'bps', label: 'BPS', field: 'bps', category: 'all' },
  { key: 'defensive_contribution', label: 'DEF', field: 'defensive_contribution', category: 'defending' },
  { key: 'expected_goals_conceded', label: 'xGC', field: 'expected_goals_conceded', category: ['defending', 'goalie'] },
  { key: 'yellow_cards', label: 'YC', field: 'yellow_cards', category: 'all' },
  { key: 'red_cards', label: 'RC', field: 'red_cards', category: 'all' }
]

function SortTriangle({ direction }) {
  const isAsc = direction === 'asc'
  return (
    <span className="league-standings-sort-triangle" aria-hidden>
      <svg width="8" height="6" viewBox="0 0 8 6" fill="currentColor">
        {isAsc ? (
          <path d="M4 0L8 6H0L4 0Z" />
        ) : (
          <path d="M4 6L0 0h8L4 6Z" />
        )}
      </svg>
    </span>
  )
}

function formatStatValue(value, field, displayMode, minutes, costTenths, showPerM) {
  const num = Number(value)
  const isDecimal = ['expected_goals', 'expected_assists', 'expected_goal_involvements', 'expected_goals_conceded'].includes(field)
  const displayRaw = isDecimal ? (num === 0 ? '0' : num.toFixed(1)) : String(Math.round(num))

  if (displayMode === 'per90' && minutes != null && minutes > 0) {
    const per90 = (num * 90) / minutes
    const per90Str = isDecimal ? (per90 === 0 ? '0' : per90.toFixed(1)) : per90.toFixed(1)
    if (showPerM && costTenths != null && costTenths > 0) {
      const perM = (num * 10) / costTenths
      const perMStr = perM.toFixed(1)
      return { main: per90Str, sub: `£${perMStr}/M` }
    }
    return { main: per90Str, sub: null }
  }

  if (showPerM && costTenths != null && costTenths > 0 && num !== 0) {
    const perM = (num * 10) / costTenths
    const perMStr = perM.toFixed(1)
    return { main: displayRaw, sub: `£${perMStr}/M` }
  }
  return { main: displayRaw, sub: null }
}

export default function StatsSubpage() {
  const { gameweek } = useGameweekData()
  const [gwFilter, setGwFilter] = useState('all')
  const [locationFilter, setLocationFilter] = useState('all')
  const [statCategory, setStatCategory] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [teamView, setTeamView] = useState(false)
  const [displayMode, setDisplayMode] = useState('total') // 'total' | 'per90'
  const [showPerM, setShowPerM] = useState(false)
  /** 'top6' | 'top12' | null - which top-N highlight is on; mutually exclusive */
  const [topHighlightMode, setTopHighlightMode] = useState(null)
  const [positionFilter, setPositionFilter] = useState('all')
  const [mainSort, setMainSort] = useState({ column: 'points', dir: 'desc' })
  const [compareSort, setCompareSort] = useState({ column: 'points', dir: 'desc' })
  /** Player IDs selected for compare (order preserved via array) */
  const [compareSelectedIds, setCompareSelectedIds] = useState([])
  /** True only after user has pressed Compare button; gates row-tap add-to-compare in main table */
  const [compareModeActive, setCompareModeActive] = useState(false)
  /** When true, show toast "Select more than 1 player to compare" */
  const [showCompareMessage, setShowCompareMessage] = useState(false)

  const { players, loading } = useAllPlayersGameweekStats(gwFilter, locationFilter)
  const { data: currentGameweekPlayers } = useCurrentGameweekPlayers()
  const ownedPlayerIds = useMemo(() => {
    if (!currentGameweekPlayers?.length) return null
    return new Set(currentGameweekPlayers.map((p) => Number(p.player_id)).filter(Boolean))
  }, [currentGameweekPlayers])

  const visibleColumns = useMemo(() => {
    const base = STAT_COLUMNS.filter((c) => c.field !== 'minutes')
    if (statCategory === 'all') return base
    return base.filter((c) => {
      const cat = c.category
      const matches = Array.isArray(cat) ? cat.includes(statCategory) : cat === statCategory
      return matches || cat === 'all'
    })
  }, [statCategory])

  /** Table width = rank(10) + player(120) + stat cols(28 each). Keeps player column fixed at 120px across stat category filters. */
  const statsTableWidth = useMemo(
    () => 10 + 120 + visibleColumns.length * 28,
    [visibleColumns.length]
  )

  const filteredPlayers = useMemo(() => {
    if (!players?.length) return []
    let list = players
    if (positionFilter !== 'all') {
      const pos = Number(positionFilter)
      if (!Number.isNaN(pos)) list = list.filter((p) => p.position != null && p.position === pos)
    }
    const q = searchQuery.trim().toLowerCase()
    if (!q) return list
    return list.filter(
      (p) =>
        (p.web_name && p.web_name.toLowerCase().includes(q)) ||
        (p.team_short_name && p.team_short_name.toLowerCase().includes(q))
    )
  }, [players, positionFilter, searchQuery])

  const sortedPlayers = useMemo(() => {
    const list = [...filteredPlayers]
    const col = mainSort.column
    const dir = mainSort.dir === 'asc' ? 1 : -1
    list.sort((a, b) => {
      let aVal = a[col]
      let bVal = b[col]
      if (typeof aVal === 'number' && typeof bVal === 'number') return (aVal - bVal) * dir
      if (aVal == null && bVal == null) return 0
      if (aVal == null) return dir
      if (bVal == null) return -dir
      return String(aVal).localeCompare(String(bVal), undefined, { numeric: true }) * dir
    })
    return list
  }, [filteredPlayers, mainSort.column, mainSort.dir])

  /** Rank per stat field for all players (1-based): field -> { player_id -> rank } */
  const rankByField = useMemo(() => {
    const out = {}
    const fields = STAT_COLUMNS.map((c) => c.field)
    fields.forEach((field) => {
      const sorted = [...filteredPlayers].sort(
        (a, b) => (Number(b[field]) ?? 0) - (Number(a[field]) ?? 0)
      )
      const rankMap = {}
      sorted.forEach((p, i) => {
        if (p.player_id != null) rankMap[p.player_id] = i + 1
      })
      out[field] = rankMap
    })
    return out
  }, [filteredPlayers])

  const handleMainSort = useCallback((column) => {
    setMainSort((prev) => ({
      column,
      dir: prev.column === column && prev.dir === 'desc' ? 'asc' : 'desc'
    }))
  }, [])
  const handleCompareSort = useCallback((column) => {
    setCompareSort((prev) => ({
      column,
      dir: prev.column === column && prev.dir === 'desc' ? 'asc' : 'desc'
    }))
  }, [])

  const compareSelectedSet = useMemo(() => new Set(compareSelectedIds), [compareSelectedIds])
  const compareSelectedPlayers = useMemo(() => {
    const idToPlayer = new Map((players ?? []).map((p) => [p.player_id, p]))
    return compareSelectedIds.map((id) => idToPlayer.get(id)).filter(Boolean)
  }, [players, compareSelectedIds])

  /** When compare has selection, main table shows only non-selected players */
  const mainTablePlayers = useMemo(() => {
    if (compareSelectedIds.length === 0) return sortedPlayers
    return sortedPlayers.filter((p) => !compareSelectedSet.has(p.player_id))
  }, [sortedPlayers, compareSelectedIds.length, compareSelectedSet])

  /** 1-based rank in the full sorted list (used for both tables so rank "retains position") */
  const sortedRankByPlayerId = useMemo(() => {
    const m = {}
    sortedPlayers.forEach((p, i) => {
      if (p.player_id != null) m[p.player_id] = i + 1
    })
    return m
  }, [sortedPlayers])

  /** Compare table rows sorted by compare table's own sort (not synced with main table) */
  const compareTablePlayers = useMemo(() => {
    if (compareSelectedPlayers.length === 0) return []
    const col = compareSort.column
    const dir = compareSort.dir === 'asc' ? 1 : -1
    const list = [...compareSelectedPlayers]
    list.sort((a, b) => {
      let aVal = a[col]
      let bVal = b[col]
      if (typeof aVal === 'number' && typeof bVal === 'number') return (aVal - bVal) * dir
      if (aVal == null && bVal == null) return 0
      if (aVal == null) return dir
      if (bVal == null) return -dir
      return String(aVal).localeCompare(String(bVal), undefined, { numeric: true }) * dir
    })
    return list
  }, [compareSelectedPlayers, compareSort.column, compareSort.dir])

  /** In compare table only: best player_id per stat column (one winner per column for yellow border). Lower is better for xGC, YC, RC. */
  const compareBestPlayerIdByField = useMemo(() => {
    if (compareSelectedPlayers.length < 2) return {}
    const lowerIsBetter = new Set(['expected_goals_conceded', 'yellow_cards', 'red_cards'])
    const out = {}
    visibleColumns.forEach(({ field }) => {
      let bestId = null
      let bestVal = null
      compareSelectedPlayers.forEach((p) => {
        const v = p[field] != null ? Number(p[field]) : NaN
        if (Number.isNaN(v)) return
        const isBetter =
          bestVal == null
            ? true
            : lowerIsBetter.has(field)
              ? v < bestVal
              : v > bestVal
        if (isBetter) {
          bestVal = v
          bestId = p.player_id
        }
      })
      if (bestId != null) out[field] = bestId
    })
    return out
  }, [compareSelectedPlayers, visibleColumns])

  const toggleCompareSelection = useCallback((playerId) => {
    setCompareSelectedIds((prev) => {
      const set = new Set(prev)
      if (set.has(playerId)) {
        set.delete(playerId)
        return [...set]
      }
      return [...prev, playerId]
    })
  }, [])

  const handleCompareClick = useCallback(() => {
    setCompareModeActive(true)
    if (compareSelectedIds.length < 2) {
      setShowCompareMessage(true)
      setTimeout(() => setShowCompareMessage(false), 3000)
    }
  }, [compareSelectedIds.length])

  const mainTableWrapperRef = useRef(null)
  const compareTableWrapperRef = useRef(null)
  const scrollSyncInProgressRef = useRef(false)
  const handleMainScroll = useCallback(() => {
    if (scrollSyncInProgressRef.current) return
    const main = mainTableWrapperRef.current
    const compare = compareTableWrapperRef.current
    if (!main || !compare) return
    scrollSyncInProgressRef.current = true
    compare.scrollLeft = main.scrollLeft
    requestAnimationFrame(() => { scrollSyncInProgressRef.current = false })
  }, [])
  const handleCompareScroll = useCallback(() => {
    if (scrollSyncInProgressRef.current) return
    const main = mainTableWrapperRef.current
    const compare = compareTableWrapperRef.current
    if (!main || !compare) return
    scrollSyncInProgressRef.current = true
    main.scrollLeft = compare.scrollLeft
    requestAnimationFrame(() => { scrollSyncInProgressRef.current = false })
  }, [])
  useEffect(() => {
    if (compareSelectedPlayers.length === 0) return
    const main = mainTableWrapperRef.current
    const compare = compareTableWrapperRef.current
    if (!main || !compare) return
    compare.scrollLeft = main.scrollLeft
  }, [compareSelectedPlayers.length])

  const isSortableColumn = (field) =>
    ['points', 'minutes', 'goals_scored', 'assists', 'clean_sheets', 'saves', 'bps', 'defensive_contribution', 'expected_goals', 'expected_assists', 'expected_goal_involvements', 'expected_goals_conceded', 'yellow_cards', 'red_cards'].includes(field)

  const filterSummaryText = useMemo(() => {
    const gwLabel = gwFilter === 'all' ? 'All gameweeks' : gwFilter === 'last6' ? 'Last 6' : 'Last 12'
    const locationLabel = locationFilter === 'all' ? 'All locations' : locationFilter === 'home' ? 'Home' : 'Away'
    const positionLabel = positionFilter === 'all' ? 'All positions' : (POSITION_LABELS[Number(positionFilter)] ?? 'All positions')
    const displayLabel = displayMode === 'total' ? 'Total' : 'Per 90'
    const parts = [gwLabel, locationLabel, positionLabel, displayLabel]
    if (statCategory !== 'all') parts.push(statCategory === 'attacking' ? 'Attacking' : statCategory === 'goalie' ? 'Goalie' : 'Defending')
    if (showPerM) parts.push('Per £M')
    if (topHighlightMode === 6) parts.push('Top 6')
    if (topHighlightMode === 12) parts.push('Top 12')
    return parts.join(' · ')
  }, [gwFilter, locationFilter, positionFilter, displayMode, statCategory, showPerM, topHighlightMode])

  const filtersHaveChanged = useMemo(() => {
    return (
      gwFilter !== 'all' ||
      locationFilter !== 'all' ||
      positionFilter !== 'all' ||
      statCategory !== 'all' ||
      displayMode !== 'total' ||
      showPerM ||
      topHighlightMode != null
    )
  }, [gwFilter, locationFilter, positionFilter, statCategory, displayMode, showPerM, topHighlightMode])

  const handleResetFilters = useCallback(() => {
    setGwFilter('all')
    setLocationFilter('all')
    setPositionFilter('all')
    setStatCategory('all')
    setDisplayMode('total')
    setShowPerM(false)
    setTopHighlightMode(null)
  }, [])

  return (
    <div className="research-stats-subpage research-stats-page league-standings-page">
      <div className="research-stats-card research-card bento-card bento-card-animate bento-card-expanded">
        <div className="research-stats-under-construction research-stats-under-construction-banner" role="status" aria-live="polite">
          <Construction size={20} strokeWidth={2} aria-hidden />
          <span>Under construction</span>
        </div>
        <div className="research-stats-toolbar">
          <button
            type="button"
            className={`stats-filter-btn stats-view-toggle-btn ${teamView ? 'stats-view-toggle-btn--active' : ''}`}
            onClick={() => setTeamView((v) => !v)}
            aria-label={teamView ? 'Show player stats' : 'Show team stats'}
            aria-pressed={teamView}
          >
            {teamView ? (
              <UsersRound size={14} strokeWidth={2} fill="currentColor" />
            ) : (
              <UserRound size={14} strokeWidth={2} />
            )}
          </button>
          <div className="research-stats-search-wrap">
            <Search className="research-stats-search-icon" size={14} strokeWidth={2} aria-hidden />
            <input
              type="search"
              className="research-stats-search-input"
              placeholder="Search player or team"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search players"
            />
          </div>
          <button
            type="button"
            className={`stats-filter-btn stats-compare-btn ${compareSelectedIds.length > 0 ? 'stats-compare-btn--active' : ''}`}
            onClick={handleCompareClick}
            aria-label="Compare selected players"
            aria-pressed={compareSelectedIds.length > 0}
            title={compareModeActive ? (compareSelectedIds.length > 0 ? 'Compare mode: tap rows to add or remove' : 'Compare mode: tap rows to add players (need 2+ to compare)') : 'Press to enter compare mode, then tap rows to add players'}
          >
            <Scale size={14} strokeWidth={2} />
          </button>
          <button
            type="button"
            className={`stats-filter-btn ${showFilters ? 'stats-filter-btn-close' : ''}`}
            onClick={() => setShowFilters((v) => !v)}
            aria-label={showFilters ? 'Close filters' : 'Show filters'}
            aria-expanded={showFilters}
          >
            <Filter size={14} strokeWidth={2} />
          </button>
        </div>
        {showCompareMessage && (
          <p className="research-stats-compare-message" role="alert">
            Select more than 1 player to compare.
          </p>
        )}
        <p className="research-stats-filter-summary" aria-live="polite">
          {filterSummaryText}
        </p>
        {showFilters && (
          <div className="stats-filter-overlay" role="dialog" aria-modal="true" aria-label="Stats filters">
            <div className="stats-filter-overlay-backdrop" onClick={() => setShowFilters(false)} aria-hidden />
            <div className="stats-filter-overlay-panel">
              <div className="stats-filter-overlay-header">
                <span className="stats-filter-overlay-title">Filters</span>
                <div className="stats-filter-overlay-header-actions">
                  {filtersHaveChanged && (
                    <button
                      type="button"
                      className="stats-filter-overlay-reset"
                      onClick={handleResetFilters}
                      aria-label="Reset all filters to default"
                    >
                      Reset
                    </button>
                  )}
                  <button type="button" className="stats-filter-overlay-close" onClick={() => setShowFilters(false)} aria-label="Close filters">
                    <X size={20} strokeWidth={2} />
                  </button>
                </div>
              </div>
              <div className="stats-filter-overlay-body">
                <div className="research-stats-filters" role="group" aria-label="Stats filters">
                  <div className="stats-filter-section">
                    <div className="stats-filter-section-title">Gameweeks</div>
                    <div className="stats-filter-buttons">
                      {GW_FILTER_OPTIONS.map(({ key, label }) => (
                        <button
                          key={key}
                          type="button"
                          className={`stats-filter-option-btn ${gwFilter === key ? 'stats-filter-option-btn--active' : ''}`}
                          onClick={() => setGwFilter(key)}
                          aria-pressed={gwFilter === key}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="stats-filter-section">
                    <div className="stats-filter-section-title">Location</div>
                    <div className="stats-filter-buttons">
                      {LOCATION_OPTIONS.map(({ key, label }) => (
                        <button
                          key={key}
                          type="button"
                          className={`stats-filter-option-btn ${locationFilter === key ? 'stats-filter-option-btn--active' : ''}`}
                          onClick={() => setLocationFilter(key)}
                          aria-pressed={locationFilter === key}
                        >
                          {key === 'home' && <Home size={14} strokeWidth={2} className="stats-filter-option-icon" aria-hidden />}
                          {key === 'away' && <PlaneTakeoff size={14} strokeWidth={2} className="stats-filter-option-icon" aria-hidden />}
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="stats-filter-section">
                    <div className="stats-filter-section-title">Position</div>
                    <div className="stats-filter-buttons">
                      {POSITION_OPTIONS.map(({ key, label }) => (
                        <button
                          key={key}
                          type="button"
                          className={`stats-filter-option-btn ${positionFilter === key ? 'stats-filter-option-btn--active' : ''}`}
                          onClick={() => setPositionFilter(key)}
                          aria-pressed={positionFilter === key}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="stats-filter-section">
                    <div className="stats-filter-section-title">Stat category</div>
                    <div className="stats-filter-buttons">
                      {STAT_CATEGORY_OPTIONS.map(({ key, label }) => (
                        <button
                          key={key}
                          type="button"
                          className={`stats-filter-option-btn ${statCategory === key ? 'stats-filter-option-btn--active' : ''}`}
                          onClick={() => setStatCategory(key)}
                          aria-pressed={statCategory === key}
                        >
                          {key === 'attacking' && <Swords size={14} strokeWidth={2} className="stats-filter-option-icon" aria-hidden />}
                          {key === 'defending' && <ShieldHalf size={14} strokeWidth={2} className="stats-filter-option-icon" aria-hidden />}
                          {key === 'goalie' && <Hand size={14} strokeWidth={2} className="stats-filter-option-icon" aria-hidden />}
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {!teamView && (
                    <div className="stats-filter-section">
                      <div className="stats-filter-section-title">Display</div>
                      <div className="stats-filter-buttons">
                        <button
                          type="button"
                          className={`stats-filter-option-btn ${displayMode === 'total' ? 'stats-filter-option-btn--active' : ''}`}
                          onClick={() => setDisplayMode('total')}
                          aria-pressed={displayMode === 'total'}
                        >
                          Total
                        </button>
                        <button
                          type="button"
                          className={`stats-filter-option-btn ${displayMode === 'per90' ? 'stats-filter-option-btn--active' : ''}`}
                          onClick={() => setDisplayMode('per90')}
                          aria-pressed={displayMode === 'per90'}
                        >
                          Per 90
                        </button>
                        <button
                          type="button"
                          className={`stats-filter-option-btn ${showPerM ? 'stats-filter-option-btn--active' : ''}`}
                          onClick={() => setShowPerM((v) => !v)}
                          aria-pressed={showPerM}
                        >
                          Per £M
                        </button>
                        <span className="stats-filter-display-divider" aria-hidden>|</span>
                        <button
                          type="button"
                          className={`stats-filter-option-btn ${topHighlightMode === 6 ? 'stats-filter-option-btn--active' : ''}`}
                          onClick={() => setTopHighlightMode((m) => (m === 6 ? null : 6))}
                          aria-pressed={topHighlightMode === 6}
                          title="Highlight top 6 per stat column"
                        >
                          Top 6
                        </button>
                        <button
                          type="button"
                          className={`stats-filter-option-btn ${topHighlightMode === 12 ? 'stats-filter-option-btn--active' : ''}`}
                          onClick={() => setTopHighlightMode((m) => (m === 12 ? null : 12))}
                          aria-pressed={topHighlightMode === 12}
                          title="Highlight top 12 per stat column"
                        >
                          Top 12
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {teamView ? (
          <div className="research-stats-under-construction" role="status" aria-live="polite">
            <span>Team stats view coming later</span>
          </div>
        ) : (
          <>
            {compareSelectedPlayers.length > 0 && (
              <div className="research-stats-compare-section" role="region" aria-label="Compare selected players">
                <div className="research-stats-compare-table-header-wrap">
                  <span className="research-stats-compare-title">Compare</span>
                  <span className="research-stats-compare-legend" aria-hidden>
                    <span className="research-stats-compare-legend-item">
                      <span className="research-stats-compare-legend-swatch" />
                      <span className="research-stats-compare-legend-text">Stat leader</span>
                    </span>
                    <span className="research-stats-compare-legend-item">
                      <span className="research-stats-compare-legend-swatch research-stats-compare-legend-swatch--blue-yellow">
                        <span className="research-stats-compare-legend-x" aria-hidden>×</span>
                      </span>
                      <span className="research-stats-compare-legend-text">
                        {topHighlightMode === 6 ? 'Stat leader + Top 6' : topHighlightMode === 12 ? 'Stat leader + Top 12' : 'Stat leader + Top 6/12'}
                      </span>
                    </span>
                  </span>
                  <button
                    type="button"
                    className="research-stats-compare-clear"
                    onClick={() => {
                      setCompareSelectedIds([])
                      setCompareModeActive(false)
                    }}
                    aria-label="Clear compare selection"
                  >
                    Clear
                  </button>
                </div>
                <div
                  ref={compareTableWrapperRef}
                  className="league-standings-bento-table-wrapper research-stats-compare-table-wrapper research-stats-table-wrapper-sync"
                  onScroll={handleCompareScroll}
                >
                  <table
                    className="research-stats-table league-standings-bento-table research-stats-compare-table"
                    style={{ width: statsTableWidth, minWidth: statsTableWidth }}
                  >
                    <thead>
                      <tr>
                        <th className="league-standings-bento-rank">#</th>
                        <th className="league-standings-bento-team">Player</th>
                        {visibleColumns.map(({ key, label, field }) => (
                          <th key={key} className="league-standings-bento-total">
                            {isSortableColumn(field) ? (
                              <button
                                type="button"
                                className="league-standings-sort-header"
                                onClick={() => handleCompareSort(field)}
                                aria-sort={compareSort.column === field ? (compareSort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                              >
                                {label}
                                <span className="league-standings-sort-triangle-slot">{compareSort.column === field ? <SortTriangle direction={compareSort.dir} /> : null}</span>
                              </button>
                            ) : (
                              label
                            )}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {compareTablePlayers.map((p) => {
                        const rank = sortedRankByPlayerId[p.player_id] ?? '—'
                        return (
                          <tr
                            key={p.player_id}
                            className="league-standings-bento-row research-stats-compare-row"
                            onClick={() => toggleCompareSelection(p.player_id)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                toggleCompareSelection(p.player_id)
                              }
                            }}
                            aria-label={`${p.web_name || 'Player'}, remove from compare`}
                          >
                            <td className="league-standings-bento-rank league-standings-bento-rank-value">
                              <span className="league-standings-bento-rank-inner">{rank}</span>
                            </td>
                            <td className="league-standings-bento-team">
                              <div className="research-stats-player-cell">
                                {p.team_short_name && (
                                  <img src={`/badges/${p.team_short_name}.svg`} alt="" className="research-stats-badge" />
                                )}
                                <div className="research-stats-player-cell-lines">
                                  <span
                                    className={`league-standings-bento-team-name${ownedPlayerIds != null && p.player_id != null && ownedPlayerIds.has(Number(p.player_id)) ? ' research-stats-player-name--owned' : ''}`}
                                    title={p.web_name}
                                  >
                                    {p.web_name && p.web_name.length > 12 ? p.web_name.slice(0, 12) + '..' : (p.web_name || '')}
                                  </span>
                                  <div className="research-stats-meta-line">
                                    {p.position != null && (
                                      <span className={`research-stats-position gw-top-points-position gw-top-points-position--${p.position}`}>
                                        {POSITION_LABELS[p.position] ?? '—'}
                                      </span>
                                    )}
                                    {p.cost_tenths != null && (
                                      <>
                                        <span className="research-stats-meta-dot">·</span>
                                        <span className="research-stats-price">£{(p.cost_tenths / 10).toFixed(1)}M</span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </td>
                            {visibleColumns.map(({ key, label, field }) => {
                              const value = p[field] ?? 0
                              const { main, sub } = formatStatValue(value, field, displayMode, p.minutes, p.cost_tenths, showPerM)
                              const isZero = value == null || Number(value) === 0
                              const fieldRank = rankByField[field]?.[p.player_id] ?? null
                              const N = topHighlightMode
                              const showPill = N != null && fieldRank != null && fieldRank <= N
                              const isDemoted = N != null && fieldRank != null && fieldRank > N
                              const demotedOpacity = isDemoted
                                ? Math.max(0.35, 0.6 - (fieldRank - N) * 0.02)
                                : null
                              const isCompareBest = compareSelectedPlayers.length > 1 && compareBestPlayerIdByField[field] === p.player_id
                              const mainCellClass = `research-stats-cell-main${isDemoted ? ' research-stats-cell-main--demoted' : ''}${isZero ? ' research-stats-cell-main--zero' : ''}`
                              const title = isCompareBest ? (showPill ? `Best in ${label} (#${fieldRank})` : `Best in ${label}`) : (showPill ? `#${fieldRank} in ${label}` : undefined)
                              // When Top 6/12 is on: blue pill for top rank; yellow border (no fill) for stat leader only; blue fill + yellow border when both.
                              // When Top 6/12 is off: yellow filled pill for stat leader only.
                              const topOn = N != null
                              const showBluePill = topOn && showPill
                              const showLeaderOutline = topOn && isCompareBest && !showPill
                              const showLeaderFilled = !topOn && isCompareBest
                              const showLeaderBorderOnBlue = topOn && showPill && isCompareBest
                              return (
                                <td key={key} className="league-standings-bento-total">
                                  {showBluePill ? (
                                    <span
                                      className={`research-stats-pts-pill${showLeaderBorderOnBlue ? ' research-stats-compare-best-border' : ''}`}
                                      data-rank={fieldRank}
                                      title={title}
                                    >
                                      <span className={`research-stats-cell-main${isZero ? ' research-stats-cell-main--zero' : ''}`}>{main}</span>
                                    </span>
                                  ) : showLeaderOutline ? (
                                    <span
                                      className="research-stats-compare-best-outline"
                                      title={title}
                                    >
                                      <span className={mainCellClass}>{main}</span>
                                    </span>
                                  ) : showLeaderFilled ? (
                                    <span
                                      className="research-stats-compare-best-pill"
                                      title={title}
                                    >
                                      <span className={`research-stats-cell-main${isZero ? ' research-stats-cell-main--zero' : ''}`}>{main}</span>
                                    </span>
                                  ) : (
                                    <span
                                      className={mainCellClass}
                                      style={demotedOpacity != null ? { opacity: demotedOpacity } : undefined}
                                    >
                                      {main}
                                    </span>
                                  )}
                                  {sub && (
                                    <span
                                      className={`research-stats-cell-per-m${isDemoted ? ' research-stats-cell-per-m--demoted' : ''}`}
                                      style={demotedOpacity != null ? { opacity: Math.max(0.3, demotedOpacity - 0.05) } : undefined}
                                    >
                                      {sub}
                                    </span>
                                  )}
                                </td>
                              )
                            })}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <div
              ref={mainTableWrapperRef}
              className="league-standings-bento-table-wrapper research-stats-table-wrapper-sync"
              onScroll={handleMainScroll}
              aria-busy={loading}
              aria-live="polite"
            >
              <table
                className="research-stats-table league-standings-bento-table"
                style={{ width: statsTableWidth, minWidth: statsTableWidth }}
              >
                <thead>
                  <tr>
                    <th className="league-standings-bento-rank">#</th>
                    <th className="league-standings-bento-team">Player</th>
                    {visibleColumns.map(({ key, label, field }) => (
                      <th key={key} className="league-standings-bento-total">
                        {isSortableColumn(field) ? (
                          <button
                            type="button"
                            className="league-standings-sort-header"
                            onClick={() => handleMainSort(field)}
                            aria-sort={mainSort.column === field ? (mainSort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                          >
                            {label}
                            <span className="league-standings-sort-triangle-slot">{mainSort.column === field ? <SortTriangle direction={mainSort.dir} /> : null}</span>
                          </button>
                        ) : (
                          label
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array.from({ length: 12 }, (_, i) => (
                      <tr key={`skeleton-${i}`} className="league-standings-bento-row research-stats-row-skeleton">
                        <td className="league-standings-bento-rank league-standings-bento-rank-value">
                          <span className="skeleton-text research-stats-skeleton-cell" />
                        </td>
                        <td className="league-standings-bento-team">
                          <div className="research-stats-player-cell">
                            <span className="skeleton-text research-stats-skeleton-badge" />
                            <div className="research-stats-player-cell-lines">
                              <span className="skeleton-text research-stats-skeleton-name" />
                              <span className="skeleton-text research-stats-skeleton-meta" />
                            </div>
                          </div>
                        </td>
                        {visibleColumns.map(({ key }) => (
                          <td key={key} className="league-standings-bento-total">
                            <span className="skeleton-text research-stats-skeleton-cell" />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : (
                    mainTablePlayers.map((p) => (
                      <tr
                        key={p.player_id}
                        className="league-standings-bento-row"
                        onClick={() => compareModeActive && toggleCompareSelection(p.player_id)}
                        role={compareModeActive ? 'button' : undefined}
                        tabIndex={compareModeActive ? 0 : undefined}
                        onKeyDown={compareModeActive ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            toggleCompareSelection(p.player_id)
                          }
                        } : undefined}
                        aria-label={compareModeActive ? `${p.web_name || 'Player'}, add to compare` : undefined}
                      >
                        <td className="league-standings-bento-rank league-standings-bento-rank-value">
                          <span className="league-standings-bento-rank-inner">{sortedRankByPlayerId[p.player_id] ?? '—'}</span>
                        </td>
                        <td className="league-standings-bento-team">
                          <div className="research-stats-player-cell">
                            {p.team_short_name && (
                              <img
                                src={`/badges/${p.team_short_name}.svg`}
                                alt=""
                                className="research-stats-badge"
                              />
                            )}
                            <div className="research-stats-player-cell-lines">
                              <span
                                className={`league-standings-bento-team-name${ownedPlayerIds != null && p.player_id != null && ownedPlayerIds.has(Number(p.player_id)) ? ' research-stats-player-name--owned' : ''}`}
                                title={p.web_name}
                              >
                                {p.web_name && p.web_name.length > 12 ? p.web_name.slice(0, 12) + '..' : (p.web_name || '')}
                              </span>
                              <div className="research-stats-meta-line">
                                {p.position != null && (
                                  <span className={`research-stats-position gw-top-points-position gw-top-points-position--${p.position}`}>
                                    {POSITION_LABELS[p.position] ?? '—'}
                                  </span>
                                )}
                                {p.cost_tenths != null && (
                                  <>
                                    <span className="research-stats-meta-dot">·</span>
                                    <span className="research-stats-price">£{(p.cost_tenths / 10).toFixed(1)}M</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        {visibleColumns.map(({ key, label, field }) => {
                          const value = p[field] ?? 0
                          const { main, sub } = formatStatValue(value, field, displayMode, p.minutes, p.cost_tenths, showPerM)
                          const isZero = value == null || Number(value) === 0
                          const rank = rankByField[field]?.[p.player_id] ?? null
                          const N = topHighlightMode
                          const showPill = N != null && rank != null && rank <= N
                          const isDemoted = N != null && rank != null && rank > N
                          const demotedOpacity = isDemoted
                            ? Math.max(0.35, 0.6 - (rank - N) * 0.02)
                            : null
                          const mainCellClass = `research-stats-cell-main${isDemoted ? ' research-stats-cell-main--demoted' : ''}${isZero ? ' research-stats-cell-main--zero' : ''}`
                          return (
                            <td key={key} className="league-standings-bento-total">
                              {showPill ? (
                                <span className="research-stats-pts-pill" data-rank={rank} title={`#${rank} in ${label}`}>
                                  <span className={`research-stats-cell-main${isZero ? ' research-stats-cell-main--zero' : ''}`}>{main}</span>
                                </span>
                              ) : (
                                <span
                                  className={mainCellClass}
                                  style={demotedOpacity != null ? { opacity: demotedOpacity } : undefined}
                                >
                                  {main}
                                </span>
                              )}
                              {sub && (
                                <span
                                  className={`research-stats-cell-per-m${isDemoted ? ' research-stats-cell-per-m--demoted' : ''}`}
                                  style={demotedOpacity != null ? { opacity: Math.max(0.3, demotedOpacity - 0.05) } : undefined}
                                >
                                  {sub}
                                </span>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {!loading && mainTablePlayers.length === 0 && (
              <div className="research-stats-empty" role="status">
                {compareSelectedPlayers.length > 0 ? 'All selected players are in Compare above.' : 'No players match the current filters.'}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
