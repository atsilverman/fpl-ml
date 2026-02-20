import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Search, Filter, X, UserRound, UsersRound, Home, PlaneTakeoff, Swords, ShieldHalf, Hand, Scale } from 'lucide-react'
import { useAllPlayersGameweekStats } from '../hooks/useAllPlayersGameweekStats'
import { useGameweekData } from '../hooks/useGameweekData'
import { useCurrentGameweekPlayers } from '../hooks/useCurrentGameweekPlayers'
import { useBentoOrder } from '../contexts/BentoOrderContext'
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
const OWNERSHIP_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'owned', label: 'Owned' },
  { key: 'unowned', label: 'Unowned' }
]

const POSITION_LABELS = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' }

/** Stat columns: key, label, field, category (all | attacking | defending | goalie) */
const STAT_COLUMNS = [
  { key: 'points', label: 'PTS', field: 'points', category: 'all' },
  { key: 'tsb', label: 'TSB%', field: 'selected_by_percent', category: 'all' },
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

/**
 * Stats that must not be summed for team view (duplication / not meaningful at team level).
 * - clean_sheets: summing counts player-CS credits (up to 11 per match), not matches with a clean sheet.
 * - expected_goals_conceded: same chance attributed to multiple defenders; sum overstates team xGC.
 * - selected_by_percent (TSB%): player-level ownership; not meaningful at team level.
 * Team aggregation and team visible columns are derived from STAT_COLUMNS excluding these.
 * Minutes is still aggregated (for Per 90 denominator) but not shown or ranked in team view.
 */
const TEAM_AGGREGATION_EXCLUDED = ['clean_sheets', 'expected_goals_conceded', 'selected_by_percent']

/** Fields we aggregate for team rows (STAT_COLUMNS minus TEAM_AGGREGATION_EXCLUDED). Single source of truth. */
const TEAM_AGGREGATION_FIELDS = STAT_COLUMNS
  .map((c) => c.field)
  .filter((f) => !TEAM_AGGREGATION_EXCLUDED.includes(f))

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
  if (field === 'selected_by_percent') {
    const v = value != null ? Number(value) : NaN
    return { main: !Number.isNaN(v) ? v.toFixed(1) : '—', sub: null }
  }
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
  const { statsMinMinutesPercent } = useBentoOrder()
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
  const [ownershipFilter, setOwnershipFilter] = useState('all')
  const [mainSort, setMainSort] = useState({ column: 'points', dir: 'desc' })
  const [compareSort, setCompareSort] = useState({ column: 'points', dir: 'desc' })
  /** Player IDs selected for compare (order preserved via array) */
  const [compareSelectedIds, setCompareSelectedIds] = useState([])
  /** Team keys (team_id or team_short_name) selected for compare when in team view */
  const [compareSelectedTeamKeys, setCompareSelectedTeamKeys] = useState([])
  /** True only after user has pressed Compare button; gates row-tap add-to-compare in main table */
  const [compareModeActive, setCompareModeActive] = useState(false)
  /** When true, show toast "Select more than 1 player to compare" */
  const [showCompareMessage, setShowCompareMessage] = useState(false)
  /** When true, show modal with transposed compare table (vertical stat-by-stat view) */
  const [showCompareDetailsModal, setShowCompareDetailsModal] = useState(false)

  const { players, loading } = useAllPlayersGameweekStats(gwFilter, locationFilter)
  const { data: currentGameweekPlayers } = useCurrentGameweekPlayers()
  const ownedPlayerIds = useMemo(() => {
    if (!currentGameweekPlayers?.length) return null
    return new Set(currentGameweekPlayers.map((p) => Number(p.player_id)).filter(Boolean))
  }, [currentGameweekPlayers])

  const visibleColumns = useMemo(() => {
    let base = STAT_COLUMNS.filter((c) => c.field !== 'minutes')
    if (teamView) {
      base = base.filter((c) => !TEAM_AGGREGATION_EXCLUDED.includes(c.field))
    }
    if (statCategory === 'all') return base
    return base.filter((c) => {
      const cat = c.category
      const matches = Array.isArray(cat) ? cat.includes(statCategory) : cat === statCategory
      return matches || cat === 'all'
    })
  }, [statCategory, teamView])

  /** Max possible minutes in the selected GW range (for minutes % filter). */
  const maxPossibleMinutes = useMemo(() => {
    const matches = gwFilter === 'last6' ? 6 : gwFilter === 'last12' ? 12 : (gameweek ? Number(gameweek) : 38)
    return matches * 90
  }, [gwFilter, gameweek])

  /** Players that meet the customize modal "min minutes %" threshold; used for both player list and team aggregation. */
  const playersAboveMinMinutes = useMemo(() => {
    if (!players?.length) return []
    if (statsMinMinutesPercent <= 0 || maxPossibleMinutes <= 0) return players
    const minMinutes = (statsMinMinutesPercent / 100) * maxPossibleMinutes
    return players.filter((p) => (Number(p.minutes) || 0) >= minMinutes)
  }, [players, statsMinMinutesPercent, maxPossibleMinutes])

  const filteredPlayers = useMemo(() => {
    if (!playersAboveMinMinutes.length) return []
    let list = playersAboveMinMinutes
    if (positionFilter !== 'all') {
      const pos = Number(positionFilter)
      if (!Number.isNaN(pos)) list = list.filter((p) => p.position != null && p.position === pos)
    }
    if (ownershipFilter !== 'all' && ownedPlayerIds != null) {
      if (ownershipFilter === 'owned') list = list.filter((p) => p.player_id != null && ownedPlayerIds.has(Number(p.player_id)))
      else if (ownershipFilter === 'unowned') list = list.filter((p) => p.player_id == null || !ownedPlayerIds.has(Number(p.player_id)))
    }
    const q = searchQuery.trim().toLowerCase()
    if (!q) return list
    return list.filter(
      (p) =>
        (p.web_name && p.web_name.toLowerCase().includes(q)) ||
        (p.team_short_name && p.team_short_name.toLowerCase().includes(q))
    )
  }, [playersAboveMinMinutes, positionFilter, ownershipFilter, searchQuery, ownedPlayerIds])

  /** Aggregated stats per team (one row per team); used when teamView is true. Only TEAM_AGGREGATION_FIELDS are summed to avoid misleading CS/xGC. Excludes players below min minutes %. */
  const teamStats = useMemo(() => {
    if (!playersAboveMinMinutes.length) return []
    const byTeam = new Map()
    for (const p of playersAboveMinMinutes) {
      const tid = p.team_id ?? p.team_short_name
      if (tid == null) continue
      const key = typeof tid === 'number' ? tid : String(tid)
      const existing = byTeam.get(key)
      if (!existing) {
        byTeam.set(key, {
          team_id: p.team_id,
          team_short_name: p.team_short_name,
          team_name: p.team_name ?? p.team_short_name ?? 'Unknown',
          ...Object.fromEntries(TEAM_AGGREGATION_FIELDS.map((f) => [f, Number(p[f]) || 0]))
        })
      } else {
        TEAM_AGGREGATION_FIELDS.forEach((f) => { existing[f] += Number(p[f]) || 0 })
      }
    }
    return Array.from(byTeam.values())
  }, [playersAboveMinMinutes])

  const filteredTeams = useMemo(() => {
    if (!teamStats.length) return []
    const q = searchQuery.trim().toLowerCase()
    if (!q) return teamStats
    return teamStats.filter(
      (t) =>
        (t.team_name && t.team_name.toLowerCase().includes(q)) ||
        (t.team_short_name && t.team_short_name.toLowerCase().includes(q))
    )
  }, [teamStats, searchQuery])

  const sortedTeams = useMemo(() => {
    const list = [...filteredTeams]
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
  }, [filteredTeams, mainSort.column, mainSort.dir])

  /** 1-based rank in sorted team list */
  const sortedRankByTeamId = useMemo(() => {
    const m = {}
    const key = (t) => t.team_id ?? t.team_short_name
    sortedTeams.forEach((t, i) => { m[key(t)] = i + 1 })
    return m
  }, [sortedTeams])

  /** Rank per stat field for teams (1-based): field -> team key -> rank. Only TEAM_AGGREGATION_FIELDS. */
  const rankByFieldTeams = useMemo(() => {
    const out = {}
    const key = (t) => t.team_id ?? t.team_short_name
    TEAM_AGGREGATION_FIELDS.forEach((field) => {
      const sorted = [...filteredTeams].sort(
        (a, b) => (Number(b[field]) ?? 0) - (Number(a[field]) ?? 0)
      )
      const rankMap = {}
      sorted.forEach((t, i) => { rankMap[key(t)] = i + 1 })
      out[field] = rankMap
    })
    return out
  }, [filteredTeams])

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

  const getTeamKey = useCallback((t) => t.team_id ?? t.team_short_name, [])
  const compareSelectedSet = useMemo(() => new Set(compareSelectedIds), [compareSelectedIds])
  const compareSelectedTeamKeySet = useMemo(() => new Set(compareSelectedTeamKeys), [compareSelectedTeamKeys])
  const compareSelectedPlayers = useMemo(() => {
    const idToPlayer = new Map((players ?? []).map((p) => [p.player_id, p]))
    return compareSelectedIds.map((id) => idToPlayer.get(id)).filter(Boolean)
  }, [players, compareSelectedIds])
  const compareSelectedTeams = useMemo(() => {
    const keyToTeam = new Map(sortedTeams.map((t) => [getTeamKey(t), t]))
    return compareSelectedTeamKeys.map((key) => keyToTeam.get(key)).filter(Boolean)
  }, [sortedTeams, compareSelectedTeamKeys, getTeamKey])

  /** When compare has selection, main table shows only non-selected players */
  const mainTablePlayers = useMemo(() => {
    if (compareSelectedIds.length === 0) return sortedPlayers
    return sortedPlayers.filter((p) => !compareSelectedSet.has(p.player_id))
  }, [sortedPlayers, compareSelectedIds.length, compareSelectedSet])

  /** When compare has selection in team view, main table shows only non-selected teams */
  const mainTableTeams = useMemo(() => {
    if (compareSelectedTeamKeys.length === 0) return sortedTeams
    return sortedTeams.filter((t) => !compareSelectedTeamKeySet.has(getTeamKey(t)))
  }, [sortedTeams, compareSelectedTeamKeys.length, compareSelectedTeamKeySet, getTeamKey])

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

  /** In compare table (team view): best team key per stat column. */
  const compareBestTeamKeyByField = useMemo(() => {
    if (compareSelectedTeams.length < 2) return {}
    const lowerIsBetter = new Set(['expected_goals_conceded', 'yellow_cards', 'red_cards'])
    const out = {}
    visibleColumns.forEach(({ field }) => {
      let bestKey = null
      let bestVal = null
      compareSelectedTeams.forEach((t) => {
        const key = getTeamKey(t)
        const v = t[field] != null ? Number(t[field]) : NaN
        if (Number.isNaN(v)) return
        const isBetter =
          bestVal == null
            ? true
            : lowerIsBetter.has(field)
              ? v < bestVal
              : v > bestVal
        if (isBetter) {
          bestVal = v
          bestKey = key
        }
      })
      if (bestKey != null) out[field] = bestKey
    })
    return out
  }, [compareSelectedTeams, visibleColumns, getTeamKey])

  /** Compare table rows (teams) sorted by compare sort */
  const compareTableTeams = useMemo(() => {
    if (compareSelectedTeams.length === 0) return []
    const col = compareSort.column
    const dir = compareSort.dir === 'asc' ? 1 : -1
    const list = [...compareSelectedTeams]
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
  }, [compareSelectedTeams, compareSort.column, compareSort.dir])

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

  const toggleCompareSelectionTeam = useCallback((teamKey) => {
    setCompareSelectedTeamKeys((prev) => {
      const set = new Set(prev)
      if (set.has(teamKey)) {
        set.delete(teamKey)
        return [...set]
      }
      return [...prev, teamKey]
    })
  }, [])

  const handleCompareClick = useCallback(() => {
    setCompareModeActive(true)
    if (teamView) {
      if (compareSelectedTeamKeys.length < 2) {
        setShowCompareMessage(true)
        setTimeout(() => setShowCompareMessage(false), 3000)
      }
    } else {
      if (compareSelectedIds.length < 2) {
        setShowCompareMessage(true)
        setTimeout(() => setShowCompareMessage(false), 3000)
      }
    }
  }, [teamView, compareSelectedIds.length, compareSelectedTeamKeys.length])

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
  /** When switching to team view, if current sort column is excluded (CS/xGC) or minutes, reset to points */
  useEffect(() => {
    if (!teamView) return
    const bad = [...TEAM_AGGREGATION_EXCLUDED, 'minutes']
    if (bad.includes(mainSort.column)) {
      setMainSort({ column: 'points', dir: 'desc' })
    }
  }, [teamView])

  useEffect(() => {
    const hasCompare = teamView ? compareSelectedTeamKeys.length > 0 : compareSelectedPlayers.length > 0
    if (!hasCompare) return
    const main = mainTableWrapperRef.current
    const compare = compareTableWrapperRef.current
    if (!main || !compare) return
    compare.scrollLeft = main.scrollLeft
  }, [teamView, compareSelectedPlayers.length, compareSelectedTeamKeys.length])

  const isSortableColumn = (field) =>
    ['points', 'selected_by_percent', 'minutes', 'goals_scored', 'assists', 'clean_sheets', 'saves', 'bps', 'defensive_contribution', 'expected_goals', 'expected_assists', 'expected_goal_involvements', 'expected_goals_conceded', 'yellow_cards', 'red_cards'].includes(field)

  const filterSummaryText = useMemo(() => {
    const viewLabel = teamView ? 'Teams' : 'Players'
    const gwLabel = gwFilter === 'all' ? (gameweek != null ? `GW1-${gameweek}` : 'All gameweeks') : gwFilter === 'last6' ? 'Last 6' : 'Last 12'
    const locationLabel = locationFilter === 'all' ? 'All locations' : locationFilter === 'home' ? 'Home' : 'Away'
    const positionLabel = teamView ? null : (positionFilter === 'all' ? 'All positions' : (POSITION_LABELS[Number(positionFilter)] ?? 'All positions'))
    const ownershipLabel = !teamView && ownershipFilter !== 'all' ? (ownershipFilter === 'owned' ? 'Owned' : 'Unowned') : null
    const parts = [viewLabel, gwLabel, locationLabel, ...(positionLabel ? [positionLabel] : []), ...(ownershipLabel ? [ownershipLabel] : [])]
    if (!teamView) {
      parts.push(displayMode === 'total' ? 'Total' : 'Per 90')
      if (showPerM) parts.push('Per £M')
      if (topHighlightMode === 6) parts.push('Top 6')
      if (topHighlightMode === 12) parts.push('Top 12')
    }
    if (statCategory !== 'all') parts.push(statCategory === 'attacking' ? 'Attacking' : statCategory === 'goalie' ? 'Goalie' : 'Defending')
    return parts.join(' · ')
  }, [gwFilter, gameweek, locationFilter, positionFilter, ownershipFilter, displayMode, statCategory, showPerM, topHighlightMode, teamView])

  const filtersHaveChanged = useMemo(() => {
    return (
      teamView ||
      gwFilter !== 'all' ||
      locationFilter !== 'all' ||
      positionFilter !== 'all' ||
      ownershipFilter !== 'all' ||
      statCategory !== 'all' ||
      displayMode !== 'total' ||
      showPerM ||
      topHighlightMode != null
    )
  }, [teamView, gwFilter, locationFilter, positionFilter, ownershipFilter, statCategory, displayMode, showPerM, topHighlightMode])

  const handleResetFilters = useCallback(() => {
    setTeamView(false)
    setGwFilter('all')
    setLocationFilter('all')
    setPositionFilter('all')
    setOwnershipFilter('all')
    setStatCategory('all')
    setDisplayMode('total')
    setShowPerM(false)
    setTopHighlightMode(null)
  }, [])

  return (
    <div className="research-stats-subpage research-stats-page league-standings-page">
      <div className="research-stats-sticky-header">
        <div className="research-stats-toolbar">
          <div className="research-stats-toolbar-left">
            {/* Desktop: slider with full Player | Team labels */}
            <nav
              className="subpage-view-toggle research-stats-view-toggle"
              role="tablist"
              aria-label="Player or team stats"
              data-options="2"
              style={{ '--slider-offset': teamView ? 1 : 0 }}
            >
              <span className="subpage-view-toggle-slider" aria-hidden />
              <button
                type="button"
                role="tab"
                aria-selected={!teamView}
                className={`subpage-view-toggle-button ${!teamView ? 'active' : ''}`}
                onClick={() => setTeamView(false)}
                aria-label="Player stats"
                title="Player stats"
              >
                <UserRound size={12} strokeWidth={2} className="subpage-view-toggle-icon" aria-hidden />
                <span className="subpage-view-toggle-label">Player</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={teamView}
                className={`subpage-view-toggle-button ${teamView ? 'active' : ''}`}
                onClick={() => setTeamView(true)}
                aria-label="Team stats"
                title="Team stats"
              >
                <UsersRound size={12} strokeWidth={2} className="subpage-view-toggle-icon" aria-hidden fill={teamView ? 'currentColor' : undefined} />
                <span className="subpage-view-toggle-label">Team</span>
              </button>
            </nav>
            {/* Mobile: single toggle button */}
            <button
              type="button"
              className="stats-filter-btn stats-view-toggle-btn stats-view-toggle-btn-mobile"
              onClick={() => setTeamView((v) => !v)}
              aria-label={teamView ? 'Show player stats' : 'Show team stats'}
              aria-pressed={teamView}
            >
              {teamView ? (
                <UsersRound size={14} strokeWidth={2} fill="currentColor" />
              ) : (
                <UserRound size={14} strokeWidth={2} />
              )}
              <span className="stats-toolbar-btn-label">{teamView ? 'Team' : 'Player'}</span>
            </button>
          </div>
          <div className="research-stats-toolbar-right">
            <div className="research-stats-search-wrap">
              <Search className="research-stats-search-icon" size={14} strokeWidth={2} aria-hidden />
              <input
                type="search"
                className="research-stats-search-input"
                placeholder={teamView ? 'Search team' : 'Search player or team'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label={teamView ? 'Search teams' : 'Search players'}
              />
            </div>
            <button
              type="button"
              className={`stats-filter-btn stats-compare-btn ${(teamView ? compareSelectedTeamKeys.length > 0 : compareSelectedIds.length > 0) ? 'stats-compare-btn--active' : ''}`}
              onClick={handleCompareClick}
              aria-label={teamView ? 'Compare selected teams' : 'Compare selected players'}
              aria-pressed={teamView ? compareSelectedTeamKeys.length > 0 : compareSelectedIds.length > 0}
              title={teamView
                ? (compareModeActive ? (compareSelectedTeamKeys.length > 0 ? 'Compare mode: tap rows to add or remove teams' : 'Compare mode: tap rows to add teams (need 2+ to compare)') : 'Press to enter compare mode, then tap rows to add teams')
                : (compareModeActive ? (compareSelectedIds.length > 0 ? 'Compare mode: tap rows to add or remove' : 'Compare mode: tap rows to add players (need 2+ to compare)') : 'Press to enter compare mode, then tap rows to add players')}
            >
              <Scale size={14} strokeWidth={2} />
              <span className="stats-toolbar-btn-label">Compare</span>
            </button>
            <button
              type="button"
              className={`stats-filter-btn ${showFilters ? 'stats-filter-btn-close' : ''}`}
              onClick={() => setShowFilters((v) => !v)}
              aria-label={showFilters ? 'Close filters' : 'Show filters'}
              aria-expanded={showFilters}
            >
              <Filter size={14} strokeWidth={2} />
              <span className="stats-toolbar-btn-label">Filter</span>
            </button>
          </div>
        </div>
        {showCompareMessage && (
          <p className="research-stats-compare-message" role="alert">
            {teamView ? 'Select more than 1 team to compare.' : 'Select more than 1 player to compare.'}
          </p>
        )}
        <p className="research-stats-filter-summary" aria-live="polite">
          <span className="research-stats-filter-summary-viewing">Viewing:</span> {filterSummaryText}
        </p>
      </div>
      <div className="research-stats-card research-card bento-card bento-card-animate bento-card-expanded">
        {showFilters && typeof document !== 'undefined' && createPortal(
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
                    <div className="stats-filter-section-title">View</div>
                    <div className="stats-filter-buttons">
                      <button
                        type="button"
                        className={`stats-filter-option-btn ${!teamView ? 'stats-filter-option-btn--active' : ''}`}
                        onClick={() => setTeamView(false)}
                        aria-pressed={!teamView}
                      >
                        <UserRound size={14} strokeWidth={2} className="stats-filter-option-icon" aria-hidden />
                        Players
                      </button>
                      <button
                        type="button"
                        className={`stats-filter-option-btn ${teamView ? 'stats-filter-option-btn--active' : ''}`}
                        onClick={() => setTeamView(true)}
                        aria-pressed={teamView}
                      >
                        <UsersRound size={14} strokeWidth={2} className="stats-filter-option-icon" aria-hidden />
                        Teams
                      </button>
                    </div>
                  </div>
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
                  {!teamView && (
                    <>
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
                      {ownedPlayerIds != null && (
                        <div className="stats-filter-section">
                          <div className="stats-filter-section-title">Ownership</div>
                          <div className="stats-filter-buttons">
                            {OWNERSHIP_OPTIONS.map(({ key, label }) => (
                              <button
                                key={key}
                                type="button"
                                className={`stats-filter-option-btn ${ownershipFilter === key ? 'stats-filter-option-btn--active' : ''}`}
                                onClick={() => setOwnershipFilter(key)}
                                aria-pressed={ownershipFilter === key}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
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
              <div className="stats-filter-overlay-footer">
                <button type="button" className="stats-filter-overlay-done" onClick={() => setShowFilters(false)} aria-label="Done">
                  Done
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

        {teamView ? (
          <>
            {compareSelectedTeamKeys.length > 0 && (
              <div className="research-stats-compare-section" role="region" aria-label="Compare selected teams">
                <div className="research-stats-compare-table-header-wrap">
                  <span className="research-stats-compare-title">Compare</span>
                  <div className="research-stats-compare-header-actions">
                    <button
                      type="button"
                      className="research-stats-compare-details"
                      onClick={() => setShowCompareDetailsModal(true)}
                      aria-label="View compare details"
                    >
                      Details
                    </button>
                    <button
                      type="button"
                      className="research-stats-compare-clear"
                      onClick={() => {
                        setCompareSelectedTeamKeys([])
                        setCompareModeActive(false)
                      }}
                      aria-label="Clear compare selection"
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <div
                  ref={compareTableWrapperRef}
                  className="league-standings-bento-table-wrapper research-stats-compare-table-wrapper research-stats-table-wrapper-sync"
                  onScroll={handleCompareScroll}
                >
                  <table
                    className="research-stats-table league-standings-bento-table research-stats-compare-table"
                    style={{ width: 'auto', minWidth: 0 }}
                  >
                    <thead>
                      <tr>
                        <th className="league-standings-bento-team">Team</th>
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
                      {compareTableTeams.map((t) => {
                        const teamKey = getTeamKey(t)
                        return (
                          <tr
                            key={teamKey}
                            className="league-standings-bento-row research-stats-compare-row"
                            onClick={() => toggleCompareSelectionTeam(teamKey)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                toggleCompareSelectionTeam(teamKey)
                              }
                            }}
                            aria-label={`${t.team_name || t.team_short_name || 'Team'}, remove from compare`}
                          >
                            <td className="league-standings-bento-team">
                              <div className="research-stats-sticky-cell-inner">
                                <div className="research-stats-player-cell research-stats-team-cell">
                                  {t.team_short_name && (
                                    <img src={`/badges/${t.team_short_name}.svg`} alt="" className="research-stats-badge" />
                                  )}
                                  <div className="research-stats-player-cell-lines">
                                    <span className="league-standings-bento-team-name" title={t.team_name}>
                                      {t.team_name || t.team_short_name || '—'}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </td>
                            {visibleColumns.map(({ key, label, field }) => {
                              const value = t[field] ?? 0
                              const { main, sub } = formatStatValue(value, field, 'total', t.minutes, null, false)
                              const isZero = value == null || Number(value) === 0
                              const fieldRank = rankByFieldTeams[field]?.[teamKey] ?? null
                              const N = null /* no top styling in team mode */
                              const showPill = N != null && fieldRank != null && fieldRank <= N
                              const isDemoted = N != null && fieldRank != null && fieldRank > N
                              const demotedOpacity = isDemoted ? Math.max(0.35, 0.6 - (fieldRank - N) * 0.02) : null
                              const isCompareBest = compareSelectedTeams.length > 1 && compareBestTeamKeyByField[field] === teamKey
                              const mainCellClass = `research-stats-cell-main${isDemoted ? ' research-stats-cell-main--demoted' : ''}${isZero ? ' research-stats-cell-main--zero' : ''}`
                              const title = isCompareBest ? (showPill ? `Best in ${label} (#${fieldRank})` : `Best in ${label}`) : (showPill ? `#${fieldRank} in ${label}` : undefined)
                              const topOn = N != null
                              const showBluePill = topOn && showPill
                              const showLeaderOutline = topOn && isCompareBest && !showPill
                              const showLeaderFilled = !topOn && isCompareBest
                              const showLeaderBorderOnBlue = topOn && showPill && isCompareBest
                              const pillStrength = showPill && fieldRank != null && N != null ? Math.max(0.35, 1 - (fieldRank - 1) / N * 0.65) : undefined
                              return (
                                <td key={key} className="league-standings-bento-total">
                                  {showBluePill ? (
                                    <span className={`research-stats-pts-pill${showLeaderBorderOnBlue ? ' research-stats-compare-best-border' : ''}`} data-rank={fieldRank} title={title} style={pillStrength != null ? { '--pill-strength': pillStrength } : undefined}>
                                      <span className={`research-stats-cell-main${isZero ? ' research-stats-cell-main--zero' : ''}`}>{main}</span>
                                    </span>
                                  ) : showLeaderOutline ? (
                                    <span className="research-stats-compare-best-outline" title={title}>
                                      <span className={mainCellClass}>{main}</span>
                                    </span>
                                  ) : showLeaderFilled ? (
                                    <span className="research-stats-compare-best-pill" title={title}>
                                      <span className={`research-stats-cell-main${isZero ? ' research-stats-cell-main--zero' : ''}`}>{main}</span>
                                    </span>
                                  ) : (
                                    <span className={mainCellClass} style={demotedOpacity != null ? { opacity: demotedOpacity } : undefined}>
                                      {main}
                                    </span>
                                  )}
                                  {sub && (
                                    <span className={`research-stats-cell-per-m${isDemoted ? ' research-stats-cell-per-m--demoted' : ''}`} style={demotedOpacity != null ? { opacity: Math.max(0.3, demotedOpacity - 0.05) } : undefined}>
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
                {compareSelectedTeams.length > 1 && (
                  <div className="research-stats-compare-legend-wrap">
                    <span className="research-stats-compare-legend" aria-hidden>
                      <span className="research-stats-compare-legend-item">
                        <span className="research-stats-compare-legend-swatch" aria-hidden />
                        <span className="research-stats-compare-legend-text">Stat leader</span>
                      </span>
                    </span>
                  </div>
                )}
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
                style={{ width: 'auto', minWidth: 0 }}
              >
                <thead>
                  <tr>
                    <th className="league-standings-bento-team">Team</th>
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
                        <td className="league-standings-bento-team">
                          <div className="research-stats-sticky-cell-inner">
                            <div className="research-stats-player-cell">
                              <span className="skeleton-text research-stats-skeleton-badge" />
                              <div className="research-stats-player-cell-lines">
                                <span className="skeleton-text research-stats-skeleton-name" />
                              </div>
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
                    mainTableTeams.map((t) => {
                      const teamKey = getTeamKey(t)
                      return (
                        <tr
                          key={teamKey}
                          className="league-standings-bento-row"
                          onClick={() => compareModeActive && toggleCompareSelectionTeam(teamKey)}
                          role={compareModeActive ? 'button' : undefined}
                          tabIndex={compareModeActive ? 0 : undefined}
                          onKeyDown={compareModeActive ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              toggleCompareSelectionTeam(teamKey)
                            }
                          } : undefined}
                          aria-label={compareModeActive ? `${t.team_name || t.team_short_name || 'Team'}, add to compare` : undefined}
                        >
                        <td className="league-standings-bento-team">
                          <div className="research-stats-sticky-cell-inner">
                            <div className="research-stats-player-cell research-stats-team-cell">
                              {t.team_short_name && (
                                <img
                                  src={`/badges/${t.team_short_name}.svg`}
                                  alt=""
                                  className="research-stats-badge"
                                />
                              )}
                              <div className="research-stats-player-cell-lines">
                                <span className="league-standings-bento-team-name" title={t.team_name}>
                                  {t.team_name || t.team_short_name || '—'}
                                </span>
                              </div>
                            </div>
                          </div>
                        </td>
                        {visibleColumns.map(({ key, label, field }) => {
                          const value = t[field] ?? 0
                              const { main, sub } = formatStatValue(value, field, 'total', t.minutes, null, false)
                              const isZero = value == null || Number(value) === 0
                              const fieldRank = rankByFieldTeams[field]?.[teamKey] ?? null
                              const N = null /* no top styling in team mode */
                              const showPill = N != null && fieldRank != null && fieldRank <= N
                              const isDemoted = N != null && fieldRank != null && fieldRank > N
                              const demotedOpacity = isDemoted
                            ? Math.max(0.35, 0.6 - (fieldRank - N) * 0.02)
                            : null
                          const mainCellClass = `research-stats-cell-main${isDemoted ? ' research-stats-cell-main--demoted' : ''}${isZero ? ' research-stats-cell-main--zero' : ''}`
                          const pillStrength = showPill && fieldRank != null && N != null ? Math.max(0.35, 1 - (fieldRank - 1) / N * 0.65) : undefined
                          return (
                            <td key={key} className="league-standings-bento-total">
                              {showPill ? (
                                <span className="research-stats-pts-pill" data-rank={fieldRank} title={`#${fieldRank} in ${label}`} style={pillStrength != null ? { '--pill-strength': pillStrength } : undefined}>
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
                  })
                )}
              </tbody>
            </table>
          </div>
            {!loading && mainTableTeams.length === 0 && (
              <div className="research-stats-empty" role="status">
                {compareSelectedTeamKeys.length > 0 ? 'All selected teams are in Compare above.' : 'No teams match the current filters.'}
              </div>
            )}
          </>
        ) : (
          <>
            {compareSelectedPlayers.length > 0 && (
              <div className="research-stats-compare-section" role="region" aria-label="Compare selected players">
                <div className="research-stats-compare-table-header-wrap">
                  <span className="research-stats-compare-title">Compare</span>
                  <div className="research-stats-compare-header-actions">
                    <button
                      type="button"
                      className="research-stats-compare-details"
                      onClick={() => setShowCompareDetailsModal(true)}
                      aria-label="View compare details"
                    >
                      Details
                    </button>
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
                </div>
                <div
                  ref={compareTableWrapperRef}
                  className="league-standings-bento-table-wrapper research-stats-compare-table-wrapper research-stats-table-wrapper-sync"
                  onScroll={handleCompareScroll}
                >
                  <table
                    className="research-stats-table league-standings-bento-table research-stats-compare-table"
                    style={{ width: 'auto', minWidth: 0 }}
                  >
                    <thead>
                      <tr>
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
                            <td className="league-standings-bento-team">
                              <div className="research-stats-sticky-cell-inner">
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
                                          <span className="research-stats-price">£{(p.cost_tenths / 10).toFixed(1)}</span>
                                        </>
                                      )}
                                    </div>
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
                              const pillStrength = showPill && fieldRank != null && N != null ? Math.max(0.35, 1 - (fieldRank - 1) / N * 0.65) : undefined
                              return (
                                <td key={key} className="league-standings-bento-total">
                                  {showBluePill ? (
                                    <span
                                      className={`research-stats-pts-pill${showLeaderBorderOnBlue ? ' research-stats-compare-best-border' : ''}`}
                                      data-rank={fieldRank}
                                      title={title}
                                      style={pillStrength != null ? { '--pill-strength': pillStrength } : undefined}
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
                {compareSelectedPlayers.length > 1 && (
                  <div className="research-stats-compare-legend-wrap">
                    <span className="research-stats-compare-legend" aria-hidden>
                      <span className="research-stats-compare-legend-item">
                        <span className="research-stats-compare-legend-swatch" aria-hidden />
                        <span className="research-stats-compare-legend-text">Stat leader</span>
                      </span>
                      {(topHighlightMode === 6 || topHighlightMode === 12) && (
                        <span className="research-stats-compare-legend-item">
                          <span className="research-stats-compare-legend-swatch research-stats-compare-legend-swatch--blue-yellow">
                            <span className="research-stats-compare-legend-x" aria-hidden>×</span>
                          </span>
                          <span className="research-stats-compare-legend-text">
                            {topHighlightMode === 6 ? 'Stat leader + Top 6' : 'Stat leader + Top 12'}
                          </span>
                        </span>
                      )}
                    </span>
                  </div>
                )}
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
                style={{ width: 'auto', minWidth: 0 }}
              >
                <thead>
                  <tr>
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
                        <td className="league-standings-bento-team">
                          <div className="research-stats-sticky-cell-inner">
                            <div className="research-stats-player-cell">
                              <span className="skeleton-text research-stats-skeleton-badge" />
                              <div className="research-stats-player-cell-lines">
                                <span className="skeleton-text research-stats-skeleton-name" />
                                <span className="skeleton-text research-stats-skeleton-meta" />
                              </div>
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
                        <td className="league-standings-bento-team">
                          <div className="research-stats-sticky-cell-inner">
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
                                      <span className="research-stats-price">£{(p.cost_tenths / 10).toFixed(1)}</span>
                                    </>
                                  )}
                                </div>
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
                          const pillStrength = showPill && rank != null && N != null ? Math.max(0.35, 1 - (rank - 1) / N * 0.65) : undefined
                          return (
                            <td key={key} className="league-standings-bento-total">
                              {showPill ? (
                                <span className="research-stats-pts-pill" data-rank={rank} title={`#${rank} in ${label}`} style={pillStrength != null ? { '--pill-strength': pillStrength } : undefined}>
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
        {!loading && (teamView ? teamStats.length : playersAboveMinMinutes.length) > 0 && (
          <p className="research-stats-count-footer" role="status" aria-live="polite">
            Showing {teamView ? filteredTeams.length : filteredPlayers.length} of {teamView ? teamStats.length : playersAboveMinMinutes.length} {teamView ? 'teams' : 'players'}
          </p>
        )}
      </div>

      {showCompareDetailsModal && (teamView ? compareTableTeams : compareTablePlayers).length > 0 && (
        <div
          className="research-stats-compare-details-overlay"
          onClick={() => setShowCompareDetailsModal(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="research-stats-compare-details-title"
        >
          <div
            className="research-stats-compare-details-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="research-stats-compare-details-header">
              <h2 id="research-stats-compare-details-title" className="research-stats-compare-details-title">
                {teamView ? 'Compare teams' : 'Compare players'}
              </h2>
              <button
                type="button"
                className="research-stats-compare-details-close"
                onClick={() => setShowCompareDetailsModal(false)}
                aria-label="Close"
              >
                <X size={20} strokeWidth={2} />
              </button>
            </div>
            <div className="research-stats-compare-details-body">
              <div className="research-stats-compare-details-table-wrap">
                <table className="research-stats-compare-details-table">
                  <thead>
                    <tr>
                      <th className="research-stats-compare-details-th-stat">Stat</th>
                      {teamView
                        ? compareTableTeams.map((t) => {
                            const teamKey = getTeamKey(t)
                            return (
                              <th key={teamKey} className="research-stats-compare-details-th-entity">
                                <div className="research-stats-compare-details-entity">
                                  {t.team_short_name && (
                                    <img src={`/badges/${t.team_short_name}.svg`} alt="" className="research-stats-badge" />
                                  )}
                                  <span>{t.team_name || t.team_short_name || '—'}</span>
                                </div>
                              </th>
                            )
                          })
                        : compareTablePlayers.map((p) => (
                            <th key={p.player_id} className="research-stats-compare-details-th-entity">
                              <div className="research-stats-compare-details-entity">
                                {p.team_short_name && (
                                  <img src={`/badges/${p.team_short_name}.svg`} alt="" className="research-stats-badge" />
                                )}
                                <span>{p.web_name || '—'}</span>
                                {p.position != null && (
                                  <span className={`research-stats-position gw-top-points-position gw-top-points-position--${p.position}`}>
                                    {POSITION_LABELS[p.position]}
                                  </span>
                                )}
                              </div>
                            </th>
                          ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleColumns.map(({ key, label, field }) => {
                      const entities = teamView ? compareTableTeams : compareTablePlayers
                      const bestKey = teamView
                        ? compareBestTeamKeyByField[field]
                        : compareBestPlayerIdByField[field]
                      return (
                        <tr key={key} className="research-stats-compare-details-tr">
                          <td className="research-stats-compare-details-td-stat">{label}</td>
                          {entities.map((entity) => {
                            const entityKey = teamView ? getTeamKey(entity) : entity.player_id
                            const value = entity[field] ?? 0
                            const { main, sub } = teamView
                              ? formatStatValue(value, field, 'total', entity.minutes, null, false)
                              : formatStatValue(value, field, displayMode, entity.minutes, entity.cost_tenths, showPerM)
                            const isBest = entityKey === bestKey && entities.length > 1
                            return (
                              <td key={entityKey} className="research-stats-compare-details-td-value">
                                <span
                                  className={`research-stats-compare-details-pill${isBest ? ' research-stats-compare-details-pill--leader' : ''}`}
                                >
                                  {main}
                                  {sub && <span className="research-stats-compare-details-pill-sub">{sub}</span>}
                                </span>
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
          </div>
        </div>
      )}
    </div>
  )
}
