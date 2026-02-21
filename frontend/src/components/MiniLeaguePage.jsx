import { useMemo, useState, useCallback, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMiniLeagueStandings } from '../hooks/useMiniLeagueStandings'
import { useLeagueManagerLiveStatus } from '../hooks/useLeagueManagerLiveStatus'
import { useLeagueActiveChips } from '../hooks/useLeagueActiveChips'
import { useGameweekData } from '../hooks/useGameweekData'
import { useLeaguePlayerSearch } from '../hooks/useLeaguePlayerSearch'
import { useLeaguePlayerOwnershipMultiple } from '../hooks/useLeaguePlayerOwnership'
import { useCurrentGameweekPlayers, useCurrentGameweekPlayersForManager } from '../hooks/useCurrentGameweekPlayers'
import { useGameweekTop10ByStat } from '../hooks/useGameweekTop10ByStat'
import { usePlayerImpactForManager } from '../hooks/usePlayerImpact'
import { useLiveGameweekStatus } from '../hooks/useLiveGameweekStatus'
import { useManagerLiveStatus } from '../hooks/useManagerLiveStatus'
import { useManagerData, useManagerDataForManager } from '../hooks/useManagerData'
import { useTransferImpactsForManager, useLeagueTransferImpacts } from '../hooks/useTransferImpacts'
import { useLeagueTopTransfers } from '../hooks/useLeagueTopTransfers'
import { useLeagueCaptainPicks } from '../hooks/useLeagueCaptainPicks'
import { useLeagueChipUsage } from '../hooks/useLeagueChipUsage'
import { useConfiguration } from '../contexts/ConfigurationContext'
import { ChevronUp, ChevronDown, ChevronsUp, ChevronsDown, Search, X, Info, ArrowDownRight, ArrowUpRight, Minimize2, MoveDiagonal, ListOrdered, ArrowRightLeft, Sparkles, TriangleAlert } from 'lucide-react'
import GameweekPointsView from './GameweekPointsView'
import PlayerDetailModal from './PlayerDetailModal'
import { useAxisLockedScroll } from '../hooks/useAxisLockedScroll'
import './MiniLeaguePage.css'
import './BentoCard.css'
import './GameweekPointsView.css'
import './MatchesSubpage.css'

const SORT_COLUMNS = ['rank', 'manager', 'total', 'gw', 'left', 'live', 'captain', 'vice']
const DEFAULT_SORT = { column: 'total', dir: 'desc' }
const MANAGER_TEAM_NAME_MAX_LENGTH = 15
const MANAGER_TEAM_NAME_MAX_LENGTH_TRANSFERS_VIEW = 20
const MANAGER_ABBREV_MAX_WIDTH = 400

function abbreviateName(name, maxLength = MANAGER_TEAM_NAME_MAX_LENGTH) {
  if (!name || typeof name !== 'string') return name ?? ''
  return name.length > maxLength ? name.slice(0, maxLength) + '..' : name
}

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

const CHIP_LABELS = {
  wildcard: 'WC',
  freehit: 'FH',
  bboost: 'BB',
  '3xc': 'TC'
}

const CHIP_COLORS = {
  wildcard: '#8b5cf6',
  freehit: '#3b82f6',
  bboost: '#06b6d4',
  '3xc': '#b91c1c' /* red-700: distinct from captain (C) orange */
}

/** Display label for active chip badge: WC1/WC2 for wildcard by gameweek, else short label. Normalizes chip to lowercase for lookup. */
function getChipDisplayLabel(activeChip, gameweek) {
  const chip = typeof activeChip === 'string' ? activeChip.toLowerCase() : null
  if (!chip) return null
  if (chip === 'wildcard') return gameweek != null && gameweek <= 19 ? 'WC1' : 'WC2'
  return CHIP_LABELS[chip] ?? chip
}

const POSITION_ABBREV = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' }

const LEAGUE_VIEW_ORDER = ['table', 'captain', 'transfers', 'chips']
const LEAGUE_VIEW_LABELS = { table: 'Standings', captain: 'Captains', transfers: 'Transfers', chips: 'Chips' }
const LEAGUE_VIEW_ICONS = { table: ListOrdered, captain: null, transfers: ArrowRightLeft, chips: Sparkles }

/** Captain "C" badge matching standings header; uses currentColor to match icon/tab color scheme */
function CaptainBadgeIcon({ className, size = 12 }) {
  return (
    <span
      className={`captain-badge-icon ${className ?? ''}`.trim()}
      style={{ '--captain-badge-size': `${size}px` }}
      aria-hidden
    >
      C
    </span>
  )
}

export default function MiniLeaguePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const leagueViewMode = (() => {
    const v = searchParams.get('view')
    return v === 'captain' || v === 'transfers' || v === 'chips' ? v : 'table'
  })()
  const leagueViewIndex = LEAGUE_VIEW_ORDER.indexOf(leagueViewMode) >= 0 ? LEAGUE_VIEW_ORDER.indexOf(leagueViewMode) : 0
  const setLeagueView = (viewId) => setSearchParams({ view: viewId }, { replace: true })
  const { config } = useConfiguration()
  const LEAGUE_ID = config?.leagueId || import.meta.env.VITE_LEAGUE_ID || null
  const currentManagerId = config?.managerId ?? null
  const { gameweek } = useGameweekData()
  const { standings, loading: standingsLoading, error: standingsError } = useMiniLeagueStandings(gameweek)
  const { liveStatusByManager, loading: liveStatusLoading } = useLeagueManagerLiveStatus(LEAGUE_ID, gameweek)
  const { activeChipByManager, loading: activeChipLoading } = useLeagueActiveChips(gameweek)
  const { leagueCaptainData, loading: leagueCaptainLoading } = useLeagueCaptainPicks(gameweek)
  const { chipUsageByManager, loading: chipUsageLoading } = useLeagueChipUsage()
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('')
  const { players: searchPlayers, loading: searchLoading } = useLeaguePlayerSearch(debouncedSearchQuery)
  const [selectedPlayers, setSelectedPlayers] = useState([])
  const selectedPlayerIds = useMemo(() => selectedPlayers.map((p) => p.fpl_player_id), [selectedPlayers])
  const leagueManagerIds = useMemo(() => (standings ?? []).map((s) => s.manager_id), [standings])
  const captainByManagerId = useMemo(() => {
    const m = {}
    ;(leagueCaptainData ?? []).forEach((r) => {
      m[r.manager_id] = r
    })
    return m
  }, [leagueCaptainData])
  const { managerIdsOwningAny, loading: ownershipLoading } = useLeaguePlayerOwnershipMultiple(selectedPlayerIds, gameweek, leagueManagerIds)

  const [sort, setSort] = useState(DEFAULT_SORT)
  const [searchQuery, setSearchQuery] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [selectedManagerId, setSelectedManagerId] = useState(null)
  const [selectedManagerDisplayName, setSelectedManagerDisplayName] = useState('')
  const [selectedManagerName, setSelectedManagerName] = useState('')
  const [showManagerDetailLegend, setShowManagerDetailLegend] = useState(false)
  const [selectedPlayerId, setSelectedPlayerId] = useState(null)
  const [selectedPlayerName, setSelectedPlayerName] = useState('')
  const [isNarrowScreen, setIsNarrowScreen] = useState(() => typeof window !== 'undefined' && window.innerWidth < MANAGER_ABBREV_MAX_WIDTH)
  const showCView = leagueViewMode === 'captain'
  const showTransfersView = leagueViewMode === 'transfers'
  const showChipsView = leagueViewMode === 'chips'
  const [transfersSummaryExpanded, setTransfersSummaryExpanded] = useState(true)
  const searchContainerRef = useRef(null)
  const managerDetailLegendRef = useRef(null)
  const standingsTableScrollRef = useRef(null)
  const transfersTableScrollRef = useRef(null)
  const managerDetailModalBodyRef = useRef(null)
  const toolbarWrapRef = useRef(null)
  useAxisLockedScroll(standingsTableScrollRef)
  useAxisLockedScroll(transfersTableScrollRef)
  useAxisLockedScroll(managerDetailModalBodyRef)

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MANAGER_ABBREV_MAX_WIDTH - 1}px)`)
    const handler = () => setIsNarrowScreen(mql.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])

  /* Measure toolbar height so desktop sticky table header can use top: var(--league-toolbar-height) */
  useEffect(() => {
    const el = toolbarWrapRef.current
    if (!el) return
    const parent = el.parentElement
    if (!parent) return
    const setHeight = () => {
      parent.style.setProperty('--league-toolbar-height', `${el.offsetHeight}px`)
    }
    setHeight()
    const ro = new ResizeObserver(setHeight)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { data: selectedManagerPlayers, fixtures: selectedManagerFixtures, isLoading: selectedManagerPlayersLoading } = useCurrentGameweekPlayersForManager(selectedManagerId)
  const { data: configuredManagerPlayers } = useCurrentGameweekPlayers()
  const { top10ByStat } = useGameweekTop10ByStat()
  const { impactByPlayerId: selectedManagerImpact, loading: selectedManagerImpactLoading } = usePlayerImpactForManager(selectedManagerId, LEAGUE_ID)
  const { hasLiveGames } = useLiveGameweekStatus(gameweek)
  const { inPlay: selectedManagerInPlay } = useManagerLiveStatus(selectedManagerId, gameweek)
  const isSelectedManagerLiveUpdating = hasLiveGames && (selectedManagerInPlay ?? 0) > 0
  const { managerData: selectedManagerSummary, loading: selectedManagerSummaryLoading } = useManagerDataForManager(selectedManagerId)
  const { transfers: selectedManagerTransfers, loading: selectedManagerTransfersLoading } = useTransferImpactsForManager(selectedManagerId, gameweek)
  const { managerData: configuredManagerData } = useManagerData()
  const { transfersOut: leagueTopTransfersOut, transfersIn: leagueTopTransfersIn, loading: leagueTopTransfersLoading } = useLeagueTopTransfers(LEAGUE_ID, gameweek)
  const leagueManagerCount = standings?.length ?? 0

  // GW points for configured manager: same source as home bento (live sum from players when available, else history)
  const currentManagerGwPoints = useMemo(() => {
    if (!configuredManagerPlayers?.length) return configuredManagerData?.gameweekPoints ?? null
    const starters = configuredManagerPlayers.filter((p) => p.position >= 1 && p.position <= 11)
    let total = starters.reduce((sum, p) => sum + (p.contributedPoints ?? 0), 0)
    const subbedOutRows = configuredManagerPlayers.filter((p) => p.was_auto_subbed_out)
    const subbedInRows = configuredManagerPlayers.filter((p) => p.was_auto_subbed_in)
    if (subbedOutRows.length && subbedInRows.length) {
      total = total - subbedOutRows.reduce((s, p) => s + (p.contributedPoints ?? 0), 0) + subbedInRows.reduce((s, p) => s + (p.contributedPoints ?? 0), 0)
    }
    const transferCost = configuredManagerData?.transferCost ?? 0
    return total - transferCost
  }, [configuredManagerPlayers, configuredManagerData?.transferCost])
  const currentManagerGwPointsDisplay = currentManagerGwPoints != null ? currentManagerGwPoints : (configuredManagerData?.gameweekPoints ?? 0)
  const currentManagerTotalPointsDisplay = (configuredManagerData?.previousGameweekTotalPoints ?? 0) + currentManagerGwPointsDisplay

  // When selected manager has auto-subs (indicator shown), use table-derived GW/total so row matches the table.
  // Subbed-in player stays in bench position (12–15) in the data, so add their points and subtract subbed-out's.
  const selectedManagerGwFromTable = useMemo(() => {
    if (!selectedManagerPlayers?.length || selectedManagerSummary?.transferCost == null) return null
    const starters = selectedManagerPlayers.filter((p) => p.position >= 1 && p.position <= 11)
    let raw = starters.reduce((sum, p) => sum + (p.contributedPoints ?? 0), 0)
    const subbedOutRows = selectedManagerPlayers.filter((p) => p.was_auto_subbed_out)
    const subbedInRows = selectedManagerPlayers.filter((p) => p.was_auto_subbed_in)
    if (subbedOutRows.length && subbedInRows.length) {
      raw = raw - subbedOutRows.reduce((s, p) => s + (p.contributedPoints ?? 0), 0) + subbedInRows.reduce((s, p) => s + (p.contributedPoints ?? 0), 0)
    }
    return raw - (selectedManagerSummary.transferCost ?? 0)
  }, [selectedManagerPlayers, selectedManagerSummary?.transferCost])
  const selectedManagerHasAutoSub = selectedManagerPlayers?.some((p) => p.was_auto_subbed_out || p.was_auto_subbed_in)
  const selectedManagerGwDisplay = selectedManagerHasAutoSub && selectedManagerGwFromTable != null ? selectedManagerGwFromTable : null
  const selectedManagerTotalDisplay = selectedManagerGwDisplay != null && selectedManagerSummary?.totalPoints != null && selectedManagerSummary?.gameweekPoints != null
    ? selectedManagerSummary.totalPoints + (selectedManagerGwDisplay - selectedManagerSummary.gameweekPoints)
    : null

  const isViewingAnotherManager = selectedManagerId != null && currentManagerId != null && Number(selectedManagerId) !== Number(currentManagerId)
  const ownedByYouPlayerIds = isViewingAnotherManager && configuredManagerPlayers?.length
    ? new Set(configuredManagerPlayers.map((p) => p.player_id))
    : undefined

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearchQuery(searchQuery), 150)
    return () => clearTimeout(t)
  }, [searchQuery])

  useEffect(() => {
    if (!dropdownOpen) return
    const handleClickOutside = (e) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [dropdownOpen])

  useEffect(() => {
    if (!selectedManagerId) return
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        setSelectedManagerId(null)
        setSelectedManagerDisplayName('')
        setSelectedManagerName('')
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [selectedManagerId])

  useEffect(() => {
    if (selectedManagerId != null) {
      const prev = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = prev
      }
    }
  }, [selectedManagerId])

  useEffect(() => {
    if (selectedManagerId == null) setShowManagerDetailLegend(false)
  }, [selectedManagerId])

  useEffect(() => {
    if (!showManagerDetailLegend) return
    const handleClickOutside = (e) => {
      if (managerDetailLegendRef.current && !managerDetailLegendRef.current.contains(e.target)) {
        setShowManagerDetailLegend(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showManagerDetailLegend])

  const handleManagerRowClick = useCallback((managerId, teamNameForTitle, managerNameForSubtitle) => {
    setSelectedManagerId(managerId)
    setSelectedManagerDisplayName(teamNameForTitle || `Manager ${managerId}`)
    setSelectedManagerName(managerNameForSubtitle || '')
  }, [])

  const handleSort = useCallback((column) => {
    if (!SORT_COLUMNS.includes(column)) return
    if (leagueViewMode === 'captain' || leagueViewMode === 'transfers') return
    setSort((prev) => {
      if (prev.column === column) {
        return { column, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      }
      const defaultAsc = ['manager', 'captain', 'vice'].includes(column)
      return { column, dir: defaultAsc ? 'asc' : 'desc' }
    })
  }, [leagueViewMode])

  const effectiveSort = (leagueViewMode === 'captain' || leagueViewMode === 'transfers')
    ? { column: 'rank', dir: 'asc' }
    : sort

  const sortedRows = useMemo(() => {
    if (!standings.length) return []
    const rows = standings.map((s, index) => {
      // Use calculated_rank from MV (correct per league); mini_league_rank is stored per manager and can be from another league
      const rank = s.calculated_rank != null ? s.calculated_rank : (s.mini_league_rank != null ? s.mini_league_rank : index + 1)
      // Use calculated_rank_change from MV (per-league); mini_league_rank_change can be from another league
      const rankChange = s.calculated_rank_change != null ? s.calculated_rank_change : s.mini_league_rank_change
      const displayName = (s.manager_team_name && s.manager_team_name.trim())
        ? s.manager_team_name
        : (s.manager_name || `Manager ${s.manager_id}`)
      const liveStatus = liveStatusByManager[s.manager_id]
      const leftToPlay = liveStatus?.left_to_play ?? null
      const inPlay = liveStatus?.in_play ?? null
      const isYou = currentManagerId != null && s.manager_id === currentManagerId
      const cap = captainByManagerId[s.manager_id]
      const captainName = cap?.captain_name ?? ''
      const viceName = cap?.vice_captain_name ?? ''
      return {
        ...s,
        _rank: rank,
        _rankChange: rankChange,
        _displayName: displayName,
        _leftToPlay: leftToPlay,
        _inPlay: inPlay,
        _totalForSort: isYou ? currentManagerTotalPointsDisplay : (s.total_points ?? 0),
        _gwForSort: isYou ? currentManagerGwPointsDisplay : (s.gameweek_points ?? 0),
        _captainName: captainName,
        _viceName: viceName
      }
    })
    const mult = effectiveSort.dir === 'asc' ? 1 : -1
    const cmp = (a, b) => {
      switch (effectiveSort.column) {
        case 'rank':
          return mult * (a._rank - b._rank)
        case 'manager':
          return mult * (a._displayName || '').localeCompare(b._displayName || '')
        case 'total':
          return mult * ((a._totalForSort ?? 0) - (b._totalForSort ?? 0))
        case 'gw':
          return mult * ((a._gwForSort ?? 0) - (b._gwForSort ?? 0))
        case 'left':
          return mult * ((a._leftToPlay ?? -1) - (b._leftToPlay ?? -1))
        case 'live':
          return mult * ((a._inPlay ?? -1) - (b._inPlay ?? -1))
        case 'captain':
          return mult * (a._captainName || '').localeCompare(b._captainName || '')
        case 'vice':
          return mult * (a._viceName || '').localeCompare(b._viceName || '')
        default:
          return 0
      }
    }
    return [...rows].sort(cmp)
  }, [standings, liveStatusByManager, captainByManagerId, effectiveSort.column, effectiveSort.dir, currentManagerId, currentManagerTotalPointsDisplay, currentManagerGwPointsDisplay])

  const { transfersByManager, loading: leagueTransfersLoading } = useLeagueTransferImpacts(leagueManagerIds, gameweek)

  const displayRows = sortedRows

  /** Top third by GW points (league page only): manager_id -> 1..N for tapering fill on GW column; class capped at 5. No highlight when all GW points are 0. */
  const gwTopRankByManagerId = useMemo(() => {
    if (!standings.length) return new Map()
    const withGw = standings.map((s) => {
      const gw = currentManagerId != null && s.manager_id === currentManagerId
        ? (currentManagerGwPointsDisplay ?? 0)
        : (s.gameweek_points ?? 0)
      return { manager_id: s.manager_id, gw: Number(gw) || 0 }
    })
    const anyNonZero = withGw.some((x) => x.gw > 0)
    if (!anyNonZero) return new Map()
    const sorted = [...withGw].sort((a, b) => b.gw - a.gw || a.manager_id - b.manager_id)
    const topN = Math.max(1, Math.ceil(sorted.length / 3))
    const map = new Map()
    for (let i = 0; i < Math.min(topN, sorted.length); i++) {
      map.set(sorted[i].manager_id, i + 1)
    }
    return map
  }, [standings, currentManagerId, currentManagerGwPointsDisplay])

  /** Top third by total points (league page only): manager_id -> 1..N for tapering fill on total column; class capped at 5 */
  const totalTopRankByManagerId = useMemo(() => {
    if (!standings.length) return new Map()
    const withTotal = standings.map((s) => {
      const total = currentManagerId != null && s.manager_id === currentManagerId
        ? (currentManagerTotalPointsDisplay ?? 0)
        : selectedManagerId != null && s.manager_id === selectedManagerId && selectedManagerTotalDisplay != null
          ? selectedManagerTotalDisplay
          : (s.total_points ?? 0)
      return { manager_id: s.manager_id, total: Number(total) || 0 }
    })
    const sorted = [...withTotal].sort((a, b) => b.total - a.total || a.manager_id - b.manager_id)
    const topN = Math.max(1, Math.ceil(sorted.length / 3))
    const map = new Map()
    for (let i = 0; i < Math.min(topN, sorted.length); i++) {
      map.set(sorted[i].manager_id, i + 1)
    }
    return map
  }, [standings, currentManagerId, currentManagerTotalPointsDisplay, selectedManagerId, selectedManagerTotalDisplay])

  const managerIdsOwningAnySet = useMemo(
    () => new Set(managerIdsOwningAny),
    [managerIdsOwningAny]
  )

  const handleSelectPlayer = useCallback((player) => {
    setSelectedPlayers((prev) =>
      prev.some((p) => p.fpl_player_id === player.fpl_player_id) ? prev : [...prev, player]
    )
    setSearchQuery('')
    setDropdownOpen(false)
  }, [])

  const handleRemovePlayer = useCallback((fplPlayerId) => {
    setSelectedPlayers((prev) => prev.filter((p) => p.fpl_player_id !== fplPlayerId))
  }, [])

  const handleClearFilter = useCallback(() => {
    setSelectedPlayers([])
    setSearchQuery('')
    setDropdownOpen(false)
  }, [])

  if (standingsLoading) {
    return <div className="loading-state">Loading standings...</div>
  }

  if (standingsError) {
    return <div className="error-state">Error: {standingsError.message}</div>
  }

  if (!LEAGUE_ID) {
    return <div className="empty-state">No league configured. Please configure a league in Settings.</div>
  }

  if (!standingsLoading && standings.length === 0) {
    return (
      <div className="mini-league-page">
        <div className="empty-state">
          <p>No standings data available for this league.</p>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '8px' }}>
            This usually means either:
          </p>
          <ul style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '6px', paddingLeft: '20px', textAlign: 'left' }}>
            <li><strong>League not loaded</strong> — Add this league in Settings/Onboarding or run the backend <code style={{ fontSize: '12px' }}>load_leagues</code> script so the league and its managers are in the database.</li>
            <li><strong>No data for the current gameweek yet</strong> — Standings for a new gameweek appear after the post-deadline refresh runs (picks, history, then materialized views). Check the Debug panel: if the latest &quot;Deadline batch&quot; for the current GW failed or never ran, fix that and re-run the batch or wait for the next cycle.</li>
          </ul>
        </div>
      </div>
    )
  }

  const leagueOwnershipSearchContent = (
      <div className="league-ownership-search-container" ref={searchContainerRef}>
        <div className={`league-ownership-search-bar${searchQuery.length > 0 ? ' league-ownership-search-bar--has-value' : ''}`}>
          <Search className="league-ownership-search-icon" size={16} aria-hidden />
          <input
            type="text"
            className="league-ownership-search-input"
            placeholder="Search player to view league ownership"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              setDropdownOpen(true)
            }}
            onFocus={() => searchQuery.trim().length >= 2 && setDropdownOpen(true)}
            aria-autocomplete="list"
            aria-expanded={dropdownOpen}
            aria-controls="league-player-autocomplete"
            id="league-ownership-search"
          />
          {searchQuery.length > 0 && (
            <button
              type="button"
              className="league-ownership-search-clear"
              onClick={() => setSearchQuery('')}
              onMouseDown={(e) => e.preventDefault()}
              aria-label="Clear search"
            >
              <X size={14} strokeWidth={2} aria-hidden />
            </button>
          )}
        </div>
        {selectedPlayers.length > 0 && (
          <div className="league-ownership-selected-container">
            {selectedPlayers.map((p) => (
              <span key={p.fpl_player_id} className="league-ownership-selected-chip">
                {p.team_short_name && (
                  <img
                    src={`/badges/${p.team_short_name}.svg`}
                    alt=""
                    className="league-ownership-player-badge"
                    width={16}
                    height={16}
                  />
                )}
                <span className="league-ownership-player-name">{p.web_name}</span>
                <button
                  type="button"
                  className="league-ownership-clear"
                  onClick={() => handleRemovePlayer(p.fpl_player_id)}
                  aria-label={`Remove ${p.web_name}`}
                >
                  <X size={14} />
                </button>
              </span>
            ))}
            <button
              type="button"
              className="league-ownership-clear-all"
              onClick={handleClearFilter}
              aria-label="Clear all players"
            >
              Clear all
            </button>
          </div>
        )}
        {dropdownOpen && searchQuery.trim().length >= 2 && (
          <ul
            id="league-player-autocomplete"
            className="league-ownership-autocomplete"
            role="listbox"
          >
            {searchLoading ? (
              <li className="league-ownership-autocomplete-item league-ownership-autocomplete-loading" role="option">Loading…</li>
            ) : searchPlayers.length === 0 ? (
              <li className="league-ownership-autocomplete-item league-ownership-autocomplete-empty" role="option">No players found</li>
            ) : (
              searchPlayers.map((p) => (
                <li
                  key={p.fpl_player_id}
                  role="option"
                  className="league-ownership-autocomplete-item"
                  onClick={() => handleSelectPlayer(p)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      handleSelectPlayer(p)
                    }
                  }}
                >
                  {p.team_short_name && (
                    <img
                      src={`/badges/${p.team_short_name}.svg`}
                      alt=""
                      className="league-ownership-player-badge"
                      width={16}
                      height={16}
                    />
                  )}
                  <span className="league-ownership-player-name">{p.web_name}</span>
                  {p.position != null && POSITION_ABBREV[p.position] && (
                    <span className="league-ownership-autocomplete-position" title={`Position: ${POSITION_ABBREV[p.position]}`}>
                      {POSITION_ABBREV[p.position]}
                    </span>
                  )}
                </li>
              ))
            )}
          </ul>
        )}
        {selectedPlayers.length > 0 && !ownershipLoading && (
          <p className="league-ownership-filter-hint">
            <strong className="league-ownership-filter-hint-count">{managerIdsOwningAny.length}</strong> manager{managerIdsOwningAny.length !== 1 ? 's' : ''} own {selectedPlayers.length === 1 ? (
              <strong>{selectedPlayers[0].web_name}</strong>
            ) : selectedPlayers.length === 2 ? (
              <strong>{selectedPlayers[0].web_name} and {selectedPlayers[1].web_name}</strong>
            ) : (
              <strong>{selectedPlayers.slice(0, -1).map((p) => p.web_name).join(', ')} and {selectedPlayers[selectedPlayers.length - 1].web_name}</strong>
            )}{' '}
            this gameweek
          </p>
        )}
      </div>
    )

  const showStandingsView = leagueViewMode === 'table'

  return (
    <div className={`mini-league-page${showStandingsView ? ' league-page--standings-view' : ''}`}>
      <div ref={toolbarWrapRef} className="subpage-toolbar-wrap">
        <nav
          className="subpage-view-toggle"
          role="tablist"
          aria-label="League view"
          data-options="4"
          style={{ '--slider-offset': leagueViewIndex }}
        >
          <span className="subpage-view-toggle-slider" aria-hidden />
          {LEAGUE_VIEW_ORDER.map((viewId) => {
            const Icon = LEAGUE_VIEW_ICONS[viewId]
            return (
              <button
                key={viewId}
                type="button"
                role="tab"
                aria-selected={leagueViewMode === viewId}
                className={`subpage-view-toggle-button ${leagueViewMode === viewId ? 'active' : ''}`}
                onClick={() => setLeagueView(viewId)}
                aria-label={LEAGUE_VIEW_LABELS[viewId]}
                title={LEAGUE_VIEW_LABELS[viewId]}
              >
                {viewId === 'captain' ? (
                  <CaptainBadgeIcon className="subpage-view-toggle-icon" size={12} />
                ) : (
                  Icon && <Icon size={12} strokeWidth={2} className="subpage-view-toggle-icon" aria-hidden />
                )}
                <span className="subpage-view-toggle-label">{LEAGUE_VIEW_LABELS[viewId]}</span>
              </button>
            )
          })}
        </nav>
        {showStandingsView && (
          <div className="league-sticky-search-row">
            {leagueOwnershipSearchContent}
          </div>
        )}
      </div>
      <div className="league-standings-bento league-standings-page">
        <div className="league-standings-bento-body">
        {showTransfersView && <div className="league-standings-transfers-spacer" aria-hidden="true" />}
        {showTransfersView && (() => {
          const outList = (leagueTopTransfersOut || []).slice(0, 5)
          const inList = (leagueTopTransfersIn || []).slice(0, 5)
          const transfersSummary = configuredManagerData != null
            ? {
                used: configuredManagerData.transfersMade ?? 0,
                available: configuredManagerData.freeTransfersAvailable ?? 0,
                activeChip: configuredManagerData.activeChip ?? null,
              }
            : null
          const chipLabel = transfersSummary?.activeChip != null ? getChipDisplayLabel(transfersSummary.activeChip, gameweek) : null
          const chipColor = transfersSummary?.activeChip != null ? (CHIP_COLORS[String(transfersSummary.activeChip).toLowerCase()] ?? 'var(--text-secondary)') : null
          return (
            <div className="league-page-transfers-summary">
              <div className={`gw-top-points-card ${transfersSummaryExpanded ? 'gw-top-points-card--expanded' : 'gw-top-points-card--collapsed'}`}>
                <div className="gw-top-points-content">
                  <div
                    className="gw-top-points-header"
                    role="button"
                    tabIndex={0}
                    onClick={() => setTransfersSummaryExpanded((v) => !v)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setTransfersSummaryExpanded((v) => !v); } }}
                    aria-expanded={transfersSummaryExpanded}
                    aria-label={transfersSummaryExpanded ? 'Collapse Top League Transfers' : 'Expand Top League Transfers'}
                  >
                    <span className="gw-top-points-title">Top League Transfers</span>
                    <span className="gw-top-points-expand-icon" title={transfersSummaryExpanded ? 'Collapse' : 'Expand'} aria-hidden>
                      {transfersSummaryExpanded ? (
                        <Minimize2 className="gw-top-points-expand-icon-svg" size={11} strokeWidth={1.5} />
                      ) : (
                        <MoveDiagonal className="gw-top-points-expand-icon-svg" size={11} strokeWidth={1.5} />
                      )}
                    </span>
                  </div>
                  {transfersSummaryExpanded && (
                    <>
                      {chipLabel && (
                        <div className="league-transfers-summary-chip-row">
                          <span
                            className="bento-card-transfers-chip-badge bento-card-transfers-chip-badge--colored"
                            style={{ backgroundColor: chipColor, color: '#fff' }}
                          >
                            {chipLabel}
                          </span>
                        </div>
                      )}
                      {leagueTopTransfersLoading ? (
                        <div className="gw-top-points-loading">Loading...</div>
                      ) : (outList.length + inList.length) === 0 ? (
                        <div className="gw-top-points-empty">No data</div>
                      ) : (
                        <div className="transfers-summary-columns-wrapper">
                          <div className="transfers-summary-column transfers-summary-column-out">
                            <div className="transfers-summary-column-header">
                              <span className="transfers-summary-column-title transfers-summary-column-title-out">→OUT</span>
                            </div>
                            <div className="transfers-summary-column-list">
                              {outList.map((row, i) => (
                                <div key={i} className="transfers-summary-column-item">
                                  <span className="transfers-summary-badge-slot">
                                    {row.teamShortName ? (
                                      <img src={`/badges/${row.teamShortName}.svg`} alt="" className="transfers-summary-badge" />
                                    ) : (
                                      <span className="transfers-summary-badge-placeholder" aria-hidden />
                                    )}
                                  </span>
                                  <span className="transfers-summary-column-name">{row.playerName}</span>
                                  <span className="transfers-summary-column-count">{row.count}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                          <div className="transfers-summary-column transfers-summary-column-in">
                            <div className="transfers-summary-column-header">
                              <span className="transfers-summary-column-title transfers-summary-column-title-in">←IN</span>
                            </div>
                            <div className="transfers-summary-column-list">
                              {inList.map((row, i) => (
                                <div key={i} className="transfers-summary-column-item">
                                  <span className="transfers-summary-badge-slot">
                                    {row.teamShortName ? (
                                      <img src={`/badges/${row.teamShortName}.svg`} alt="" className="transfers-summary-badge" />
                                    ) : (
                                      <span className="transfers-summary-badge-placeholder" aria-hidden />
                                    )}
                                  </span>
                                  <span className="transfers-summary-column-name">{row.playerName}</span>
                                  <span className="transfers-summary-column-count">{row.count}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          )
        })()}
        <div ref={standingsTableScrollRef} className={`league-standings-bento-table-wrapper${dropdownOpen && searchQuery.trim().length >= 2 ? ' league-standings-bento-table-wrapper--dimmed' : ''}`}>
          {showChipsView ? (
          <div className="league-standings-chips-view-wrap">
          <table className="league-standings-bento-table league-standings-chips-table">
            <colgroup>
              <col className="league-standings-chips-col-manager" style={{ width: '40%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '15%' }} />
            </colgroup>
            <thead>
              <tr>
                <th className="league-standings-bento-team league-standings-chips-th-manager">
                  <button
                    type="button"
                    className="league-standings-sort-header"
                    onClick={() => handleSort('manager')}
                    aria-sort={sort.column === 'manager' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  >
                    Manager
                    <span className="league-standings-sort-triangle-slot">{sort.column === 'manager' ? <SortTriangle direction={sort.dir} /> : null}</span>
                  </button>
                </th>
                <th className="league-standings-chips-th-chip" title="Wildcard (second half)">WC2</th>
                <th className="league-standings-chips-th-chip" title="Triple Captain">TC2</th>
                <th className="league-standings-chips-th-chip" title="Bench Boost">BB2</th>
                <th className="league-standings-chips-th-chip" title="Free Hit">FH2</th>
              </tr>
            </thead>
            <tbody key="chips">
              {chipUsageLoading ? (
                <tr><td colSpan={5} className="league-standings-chips-loading">Loading chips…</td></tr>
              ) : (
                displayRows.map((s, index) => {
                  const displayName = s._displayName
                  const isCurrentUser = currentManagerId != null && Number(s.manager_id) === Number(currentManagerId)
                  const usage = chipUsageByManager[s.manager_id] ?? { wc2: null, tc2: null, bb2: null, fh2: null }
                  return (
                    <tr
                      key={s.manager_id}
                      className={`league-standings-bento-row league-standings-row-animate ${isCurrentUser ? 'league-standings-bento-row-you' : ''}`}
                      style={{ animationDelay: `${index * 28}ms` }}
                      onClick={() => handleManagerRowClick(s.manager_id, displayName, s.manager_name)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          handleManagerRowClick(s.manager_id, displayName, s.manager_name)
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      title={`View GW points for ${displayName}`}
                    >
                      <td className="league-standings-bento-team league-standings-chips-td-manager" title={displayName}>
                        <span className="league-standings-bento-team-name">{isNarrowScreen ? abbreviateName(displayName) : displayName}</span>
                        {isCurrentUser && (
                          <span className="league-standings-bento-you-badge" title="Configured owner (you)">You</span>
                        )}
                      </td>
                      {['wc2', 'tc2', 'bb2', 'fh2'].map((key) => {
                        const gw = usage[key]
                        const chipKey = key === 'wc2' ? 'wildcard' : key === 'tc2' ? '3xc' : key === 'bb2' ? 'bboost' : 'freehit'
                        const color = CHIP_COLORS[chipKey]
                        return (
                          <td key={key} className="league-standings-chips-td-chip">
                            {gw != null ? (
                              <span
                                className="league-standings-bento-chip-badge league-standings-chips-badge-played"
                                style={{ backgroundColor: color, color: '#fff' }}
                                title={`GW ${gw}`}
                              >
                                {gw}
                              </span>
                            ) : (
                              <span className="league-standings-chips-badge-unplayed" aria-hidden>—</span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
          </div>
          ) : !showTransfersView ? (
          <div className={showCView ? 'league-standings-c-view-wrap' : undefined}>
          <table className={`league-standings-bento-table${showCView ? ' league-standings-c-view-table' : ''}`}>
            <colgroup>
              {showCView ? (
                <>
                  <col style={{ width: '35%' }} />
                  <col style={{ width: '32.5%' }} />
                  <col style={{ width: '32.5%' }} />
                </>
              ) : (
                <>
                  <col style={{ width: '12%' }} />
                  <col className="league-standings-bento-col-manager" style={{ width: '32%' }} />
                  <col style={{ width: '14%' }} />
                  <col style={{ width: '14%' }} />
                  <col style={{ width: '14%' }} />
                  <col style={{ width: '14%' }} />
                </>
              )}
            </colgroup>
            <thead>
              <tr>
                {!showCView && (
                <th className="league-standings-bento-rank">
                  <button
                    type="button"
                    className="league-standings-sort-header"
                    onClick={() => handleSort('rank')}
                    aria-sort={sort.column === 'rank' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  >
                    Rank
                    <span className="league-standings-sort-triangle-slot">{sort.column === 'rank' ? <SortTriangle direction={sort.dir} /> : null}</span>
                  </button>
                </th>
                )}
                <th className="league-standings-bento-team">
                  <button
                    type="button"
                    className="league-standings-sort-header"
                    onClick={() => handleSort('manager')}
                    aria-sort={sort.column === 'manager' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  >
                    Manager
                    <span className="league-standings-sort-triangle-slot">{sort.column === 'manager' ? <SortTriangle direction={sort.dir} /> : null}</span>
                  </button>
                </th>
                {!showCView && (
                  <>
                    <th className="league-standings-bento-total">
                      <button
                        type="button"
                        className="league-standings-sort-header"
                        onClick={() => handleSort('total')}
                        aria-sort={sort.column === 'total' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                      >
                        Total
                        <span className="league-standings-sort-triangle-slot">{sort.column === 'total' ? <SortTriangle direction={sort.dir} /> : null}</span>
                      </button>
                    </th>
                    <th className="league-standings-bento-gw">
                      <button
                        type="button"
                        className="league-standings-sort-header"
                        onClick={() => handleSort('gw')}
                        aria-sort={sort.column === 'gw' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                      >
                        GW
                        <span className="league-standings-sort-triangle-slot">{sort.column === 'gw' ? <SortTriangle direction={sort.dir} /> : null}</span>
                      </button>
                    </th>
                    <th className="league-standings-bento-left-to-play">
                      <button
                        type="button"
                        className="league-standings-sort-header"
                        onClick={() => handleSort('left')}
                        aria-sort={sort.column === 'left' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                      >
                        LEFT
                        <span className="league-standings-sort-triangle-slot">{sort.column === 'left' ? <SortTriangle direction={sort.dir} /> : null}</span>
                      </button>
                    </th>
                    <th className="league-standings-bento-in-play">
                      <button
                        type="button"
                        className="league-standings-sort-header"
                        onClick={() => handleSort('live')}
                        aria-sort={sort.column === 'live' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                      >
                        LIVE
                        <span className="league-standings-sort-triangle-slot">{sort.column === 'live' ? <SortTriangle direction={sort.dir} /> : null}</span>
                      </button>
                    </th>
                  </>
                )}
                {showCView && (
                  <>
                    <th className="captain-standings-bento-captain league-standings-c-view-th-captain">
                      <button
                        type="button"
                        className="league-standings-sort-header captain-standings-bento-header-cell"
                        onClick={() => handleSort('captain')}
                        aria-sort={sort.column === 'captain' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                      >
                        Captain <span className="captain-standings-bento-badge-c">C</span>
                        <span className="league-standings-sort-triangle-slot">{sort.column === 'captain' ? <SortTriangle direction={sort.dir} /> : null}</span>
                      </button>
                    </th>
                    <th className="captain-standings-bento-vice league-standings-c-view-th-vice">
                      <button
                        type="button"
                        className="league-standings-sort-header captain-standings-bento-header-cell"
                        onClick={() => handleSort('vice')}
                        aria-sort={sort.column === 'vice' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                      >
                        Vice <span className="captain-standings-bento-badge-v">V</span>
                        <span className="league-standings-sort-triangle-slot">{sort.column === 'vice' ? <SortTriangle direction={sort.dir} /> : null}</span>
                      </button>
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody key={`standings-${showCView ? 'captain' : 'table'}`}>
              {displayRows.map((s, index) => {
                const rank = s._rank
                const change = s._rankChange != null ? s._rankChange : null
                const displayName = s._displayName
                const isCurrentUser = currentManagerId != null && Number(s.manager_id) === Number(currentManagerId)
                const leftToPlay = liveStatusLoading ? null : (s._leftToPlay ?? null)
                const inPlay = liveStatusLoading ? null : (s._inPlay ?? null)
                const activeChipRaw = activeChipLoading ? null : (activeChipByManager[s.manager_id] ?? null)
                const activeChip = typeof activeChipRaw === 'string' ? activeChipRaw.toLowerCase() : activeChipRaw
                const chipLabel = activeChip ? (CHIP_LABELS[activeChip] ?? activeChip) : null
                const chipColor = activeChip ? (CHIP_COLORS[activeChip] ?? 'var(--text-secondary)') : null
                const ownsSelected = selectedPlayers.length > 0 && !ownershipLoading && managerIdsOwningAnySet.has(s.manager_id)
                const isDemoted = selectedPlayers.length > 0 && !ownershipLoading && !ownsSelected
                const isSearchMode = searchQuery.trim().length >= 2

                return (
                  <tr
                    key={s.manager_id}
                    className={`league-standings-bento-row league-standings-row-animate ${isCurrentUser ? 'league-standings-bento-row-you' : ''} ${selectedManagerId === Number(s.manager_id) ? 'league-standings-bento-row-selected' : ''} ${ownsSelected ? 'league-standings-bento-row--owns-selected' : ''} ${isDemoted ? 'league-standings-bento-row--demoted' : ''}`}
                    style={{ animationDelay: `${index * 28}ms` }}
                    onClick={() => handleManagerRowClick(s.manager_id, displayName, s.manager_name)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        handleManagerRowClick(s.manager_id, displayName, s.manager_name)
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    title={`View GW points for ${displayName}`}
                  >
                    {!showCView && (
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
                    )}
                    {showCView ? (
                      <td className="league-standings-bento-team league-standings-c-view-manager-cell" title={displayName}>
                        <span className="league-standings-bento-team-name">{isNarrowScreen ? abbreviateName(displayName) : displayName}</span>
                        {isCurrentUser && (
                          <span className="league-standings-bento-you-badge" title="Configured owner (you)">You</span>
                        )}
                      </td>
                    ) : (
                      <td className="league-standings-bento-team" title={displayName}>
                        <span className="league-standings-bento-team-name">{isNarrowScreen ? abbreviateName(displayName) : displayName}</span>
                        {isCurrentUser && (
                          <span className="league-standings-bento-you-badge" title="Configured owner (you)">You</span>
                        )}
                        {chipLabel && (
                          <span
                            className="league-standings-bento-chip-badge"
                            style={{ backgroundColor: chipColor }}
                            title={activeChip && gameweek != null ? `${activeChip} (GW ${gameweek})` : activeChip}
                          >
                            {chipLabel}
                          </span>
                        )}
                      </td>
                    )}
                    {!showCView && (
                      <>
                        <td className={`league-standings-bento-total ${((currentManagerId != null && s.manager_id === currentManagerId ? currentManagerTotalPointsDisplay : selectedManagerId != null && s.manager_id === selectedManagerId ? selectedManagerTotalDisplay : s.total_points) ?? null) === 0 ? 'league-standings-bento-cell-muted' : ''}${(() => { const r = totalTopRankByManagerId.get(s.manager_id); const totalVal = (currentManagerId != null && s.manager_id === currentManagerId ? currentManagerTotalPointsDisplay : selectedManagerId != null && s.manager_id === selectedManagerId ? selectedManagerTotalDisplay : s.total_points) ?? null; return r != null && totalVal != null && totalVal !== 0 ? ` league-standings-total-top-${Math.min(r, 5)}` : ''; })()}`}>
                          {currentManagerId != null && s.manager_id === currentManagerId
                            ? (currentManagerTotalPointsDisplay ?? '—')
                            : selectedManagerId != null && s.manager_id === selectedManagerId && selectedManagerTotalDisplay != null
                              ? selectedManagerTotalDisplay
                              : (s.total_points ?? '—')}
                        </td>
                        <td className={`league-standings-bento-gw ${((currentManagerId != null && s.manager_id === currentManagerId ? currentManagerGwPointsDisplay : selectedManagerId != null && s.manager_id === selectedManagerId ? selectedManagerGwDisplay : s.gameweek_points) ?? null) === 0 ? 'league-standings-bento-cell-muted' : ''}${(() => { const r = gwTopRankByManagerId.get(s.manager_id); const gwVal = (currentManagerId != null && s.manager_id === currentManagerId ? currentManagerGwPointsDisplay : selectedManagerId != null && s.manager_id === selectedManagerId ? selectedManagerGwDisplay : s.gameweek_points) ?? null; return r != null && gwVal != null && gwVal !== 0 ? ` league-standings-gw-top-${Math.min(r, 5)}` : ''; })()}`}>
                          {currentManagerId != null && s.manager_id === currentManagerId
                            ? (currentManagerGwPointsDisplay ?? '—')
                            : selectedManagerId != null && s.manager_id === selectedManagerId && selectedManagerGwDisplay != null
                              ? selectedManagerGwDisplay
                              : (s.gameweek_points ?? '—')}
                        </td>
                        <td className={`league-standings-bento-left-to-play ${leftToPlay === 0 ? 'league-standings-bento-cell-muted' : ''}`}>
                          {leftToPlay !== null && leftToPlay !== undefined ? leftToPlay : '—'}
                        </td>
                        <td className={`league-standings-bento-in-play ${inPlay === 0 ? 'league-standings-bento-cell-muted' : ''}`}>
                          {inPlay !== null && inPlay !== undefined ? inPlay : '—'}
                        </td>
                      </>
                    )}
                    {showCView && (() => {
                      const cap = captainByManagerId[s.manager_id]
                      const captainName = cap?.captain_name ?? '—'
                      const viceName = cap?.vice_captain_name ?? '—'
                      const captainTeam = cap?.captain_team_short_name
                      const viceTeam = cap?.vice_captain_team_short_name
                      return (
                        <>
                          <td className="captain-standings-bento-captain league-standings-c-view-td-captain" title={captainName}>
                            <span className="captain-standings-bento-player-cell">
                              {captainTeam && (
                                <img
                                  src={`/badges/${captainTeam}.svg`}
                                  alt=""
                                  className="captain-standings-bento-player-badge"
                                  onError={(e) => { e.target.style.display = 'none' }}
                                />
                              )}
                              <span className="captain-standings-bento-player-name">{captainName}</span>
                            </span>
                          </td>
                          <td className="captain-standings-bento-vice league-standings-c-view-td-vice" title={viceName}>
                            <span className="captain-standings-bento-player-cell">
                              {viceTeam && (
                                <img
                                  src={`/badges/${viceTeam}.svg`}
                                  alt=""
                                  className="captain-standings-bento-player-badge"
                                  onError={(e) => { e.target.style.display = 'none' }}
                                />
                              )}
                              <span className="captain-standings-bento-player-name">{viceName}</span>
                            </span>
                          </td>
                        </>
                      )
                    })()}
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
          ) : (
          <div ref={transfersTableScrollRef} className="league-transfers-table-wrap">
            <table className="league-transfers-table league-transfers-table-cols">
              <colgroup>
                <col className="league-transfers-col-manager" />
                <col className="league-transfers-col-transfers" />
              </colgroup>
              <thead>
                <tr>
                  <th className="league-transfers-th-manager league-standings-bento-team">
                    <button
                      type="button"
                      className="league-standings-sort-header"
                      onClick={() => handleSort('manager')}
                      aria-sort={sort.column === 'manager' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    >
                      Manager
                      <span className="league-standings-sort-triangle-slot">{sort.column === 'manager' ? <SortTriangle direction={sort.dir} /> : null}</span>
                    </button>
                  </th>
                  <th className="league-transfers-th-transfers">Transfers</th>
                </tr>
              </thead>
              <tbody key="transfers">
                {leagueTransfersLoading ? (
                  <tr><td colSpan={2} className="league-transfers-loading">Loading transfers…</td></tr>
                ) : (
                  displayRows.map((s, index) => {
                    const rank = s._rank
                    const change = s._rankChange != null ? s._rankChange : null
                    const displayName = s._displayName
                    const isCurrentUser = currentManagerId != null && Number(s.manager_id) === Number(currentManagerId)
                    const transfers = transfersByManager[Number(s.manager_id)] ?? []
                    const transferViewChipRaw = activeChipLoading ? null : (activeChipByManager[s.manager_id] ?? null)
                    const transferViewChip = typeof transferViewChipRaw === 'string' ? transferViewChipRaw.toLowerCase() : transferViewChipRaw
                    const transferViewChipLabel = transferViewChip ? (CHIP_LABELS[transferViewChip] ?? transferViewChip) : null
                    const transferViewChipColor = transferViewChip ? (CHIP_COLORS[transferViewChip] ?? 'var(--text-secondary)') : null
                    const hasSingleOrNoTransfers = transfers.length <= 1
                    const hasNoTransfers = transfers.length === 0
                    return (
                      <tr
                        key={s.manager_id}
                        className={`league-transfers-row league-transfers-row-animate ${isCurrentUser ? 'league-standings-bento-row-you' : ''} ${hasSingleOrNoTransfers ? 'league-transfers-row--single-or-none' : ''} ${hasNoTransfers ? 'league-transfers-row--no-transfers' : ''}`}
                        style={{ animationDelay: `${index * 28}ms` }}
                        onClick={() => handleManagerRowClick(s.manager_id, displayName, s.manager_name)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            handleManagerRowClick(s.manager_id, displayName, s.manager_name)
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        title={`View GW points for ${displayName}`}
                      >
                        <td className="league-transfers-cell-manager league-standings-bento-team" title={displayName}>
                          <div className="league-transfers-cell-manager-inner">
                            <span className="league-transfers-cell-manager-name-line">
                              <span className="league-standings-bento-team-name">{abbreviateName(displayName, MANAGER_TEAM_NAME_MAX_LENGTH_TRANSFERS_VIEW)}</span>
                              {isCurrentUser && <span className="league-standings-bento-you-badge" title="Configured owner (you)">You</span>}
                              {transferViewChipLabel && (transferViewChip === 'freehit' || transferViewChip === 'wildcard') && (
                                <span
                                  className="league-standings-bento-chip-badge"
                                  style={{ backgroundColor: transferViewChipColor }}
                                  title={transferViewChip && gameweek != null ? `${transferViewChip} (GW ${gameweek})` : transferViewChip}
                                >
                                  {transferViewChipLabel}
                                </span>
                              )}
                            </span>
                          </div>
                        </td>
                        <td className="league-transfers-cell-transfers">
                          {transfers.length > 0 ? (
                            <div className="league-transfers-list-scroll">
                              <div className="bento-card-transfers-list">
                                {transfers.map((t, i) => (
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
                                {transfers.length >= 1 && (() => {
                                  const net = transfers.reduce((sum, t) => sum + (t.pointImpact ?? 0), 0)
                                  const netClass = net > 0 ? 'positive' : net < 0 ? 'negative' : 'neutral'
                                  return (
                                    <div className="league-transfers-net-row">
                                      <span className="league-transfers-net-label">Net</span>
                                      <span className={`league-transfers-net-badge league-transfers-net-badge--${netClass}`}>
                                        {net >= 0 ? '+' : ''}{net}
                                      </span>
                                    </div>
                                  )
                                })()}
                              </div>
                            </div>
                          ) : (
                            <span className="league-transfers-empty">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
          )}
        </div>
        </div>
      </div>

      {selectedManagerId != null && (
        <div
          className="manager-detail-modal-overlay"
          onClick={() => {
            setSelectedManagerId(null)
            setSelectedManagerDisplayName('')
            setSelectedManagerName('')
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="manager-detail-modal-title"
        >
          <div
            className="manager-detail-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="manager-detail-modal-header">
              <div className="manager-detail-modal-header-title-wrap">
                <h2 id="manager-detail-modal-title" className="manager-detail-modal-title">
                  {selectedManagerSummary?.managerTeamName || selectedManagerDisplayName}
                </h2>
                {(() => {
                  const personName = (selectedManagerSummary?.managerName ?? selectedManagerName)?.trim?.() ?? ''
                  if (!personName) return null
                  return (
                    <p className="manager-detail-modal-subtitle">{personName}</p>
                  )
                })()}
              </div>
              <div className="manager-detail-modal-header-actions" ref={managerDetailLegendRef}>
                <div
                  className="bento-card-info-icon manager-detail-modal-legend-icon"
                  title="Legend"
                  onClick={() => setShowManagerDetailLegend((v) => !v)}
                  role="button"
                  aria-expanded={showManagerDetailLegend}
                  aria-haspopup="dialog"
                >
                  <Info className="bento-card-expand-icon-svg" size={12} strokeWidth={1.5} />
                </div>
                {showManagerDetailLegend && (
                  <div className="gw-legend-popup manager-detail-modal-legend-popup" role="dialog" aria-label="GW points legend">
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
                      <span className="gw-legend-popup-live-dot-wrap">
                        <span className="gw-legend-popup-live-dot" aria-hidden />
                      </span>
                      <span className="gw-legend-popup-text">Live match</span>
                    </div>
                    {isViewingAnotherManager && (
                      <div className="gw-legend-popup-row">
                        <span className="gw-legend-popup-row-icon">
                          <span className="gw-legend-popup-text gw-legend-popup-text--name-green">Name</span>
                        </span>
                        <span className="gw-legend-popup-text">Owned by you</span>
                      </div>
                    )}
                  </div>
                )}
                <button
                  type="button"
                  className="manager-detail-modal-close"
                  onClick={() => {
                    setSelectedManagerId(null)
                    setSelectedManagerDisplayName('')
                    setSelectedManagerName('')
                  }}
                  aria-label="Close"
                >
                  <X size={20} strokeWidth={2} />
                </button>
              </div>
            </div>
            <div ref={managerDetailModalBodyRef} className="manager-detail-modal-body bento-card-chart">
              <div className="manager-detail-modal-chart-wrap">
                <GameweekPointsView
                  data={selectedManagerPlayers || []}
                  fixtures={selectedManagerFixtures ?? []}
                  loading={selectedManagerPlayersLoading || selectedManagerImpactLoading}
                  top10ByStat={top10ByStat}
                  impactByPlayerId={selectedManagerImpact ?? {}}
                  isLiveUpdating={isSelectedManagerLiveUpdating}
                  ownedByYouPlayerIds={ownedByYouPlayerIds}
                  sortable={false}
                  onPlayerRowClick={(player) => {
                    const id = player.effective_player_id ?? player.player_id
                    if (id != null) {
                      setSelectedPlayerId(Number(id))
                      setSelectedPlayerName(player.player_name ?? '')
                    }
                  }}
                />
              </div>
              <div className="manager-detail-transfers-section">
                <div className="manager-detail-transfers-bento bento-card bento-card-animate">
                  <span className="bento-card-label manager-detail-transfers-label">Transfers made</span>
                  {selectedManagerSummaryLoading || selectedManagerTransfersLoading ? (
                    <div className="bento-card-value loading">...</div>
                  ) : (
                    <>
                      <div className="manager-detail-transfers-summary">
                        <span className="manager-detail-transfers-summary-text">
                          {selectedManagerSummary != null
                            ? `${selectedManagerSummary.transfersMade} of ${selectedManagerSummary.freeTransfersAvailable}`
                            : '—'}
                        </span>
                        {(() => {
                          const chip = selectedManagerSummary?.activeChip != null ? String(selectedManagerSummary.activeChip).toLowerCase() : null
                          const label = chip ? getChipDisplayLabel(selectedManagerSummary.activeChip, gameweek) : null
                          const color = chip ? (CHIP_COLORS[chip] ?? 'var(--text-secondary)') : null
                          return label ? (
                            <span
                              className="manager-detail-transfers-chip-badge"
                              style={{ backgroundColor: color, color: '#fff' }}
                              title={chip}
                            >
                              {label}
                            </span>
                          ) : null
                        })()}
                      </div>
                      {selectedManagerTransfers?.length > 0 ? (
                        <div className="manager-detail-transfers-list">
                          {selectedManagerTransfers.map((t, i) => (
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
                          {selectedManagerTransfers.length > 1 && (() => {
                            const net = selectedManagerTransfers.reduce((sum, t) => sum + (t.pointImpact ?? 0), 0)
                            const netClass = net > 0 ? 'positive' : net < 0 ? 'negative' : 'neutral'
                            return (
                              <div className="league-transfers-net-row">
                                <span className="league-transfers-net-label">Net</span>
                                <span className={`league-transfers-net-badge league-transfers-net-badge--${netClass}`}>
                                  {net >= 0 ? '+' : ''}{net}
                                </span>
                              </div>
                            )
                          })()}
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedPlayerId != null && (
        <PlayerDetailModal
          playerId={selectedPlayerId}
          playerName={selectedPlayerName}
          gameweek={gameweek}
          leagueManagerCount={leagueManagerCount}
          leagueManagerIds={leagueManagerIds}
          onClose={() => {
            setSelectedPlayerId(null)
            setSelectedPlayerName('')
          }}
        />
      )}
    </div>
  )
}
