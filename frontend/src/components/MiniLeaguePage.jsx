import { useMemo, useState, useCallback, useEffect, useRef } from 'react'
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
import { useConfiguration } from '../contexts/ConfigurationContext'
import { ChevronUp, ChevronDown, ChevronsUp, ChevronsDown, Search, X, Info, ArrowDownRight, ArrowUpRight } from 'lucide-react'
import GameweekPointsView from './GameweekPointsView'
import './MiniLeaguePage.css'
import './BentoCard.css'
import './GameweekPointsView.css'

const SORT_COLUMNS = ['rank', 'manager', 'total', 'gw', 'left', 'live']
const DEFAULT_SORT = { column: 'total', dir: 'desc' }
const MANAGER_TEAM_NAME_MAX_LENGTH = 15

function abbreviateName(name) {
  if (!name || typeof name !== 'string') return name ?? ''
  return name.length > MANAGER_TEAM_NAME_MAX_LENGTH ? name.slice(0, MANAGER_TEAM_NAME_MAX_LENGTH) + '..' : name
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
  '3xc': '#f97316'
}

const POSITION_ABBREV = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' }

export default function MiniLeaguePage() {
  const { config } = useConfiguration()
  const LEAGUE_ID = config?.leagueId || import.meta.env.VITE_LEAGUE_ID || null
  const currentManagerId = config?.managerId ?? null
  const { gameweek } = useGameweekData()
  const { standings, loading: standingsLoading, error: standingsError } = useMiniLeagueStandings(gameweek)
  const { liveStatusByManager, loading: liveStatusLoading } = useLeagueManagerLiveStatus(LEAGUE_ID, gameweek)
  const { activeChipByManager, loading: activeChipLoading } = useLeagueActiveChips(gameweek)
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('')
  const { players: searchPlayers, loading: searchLoading } = useLeaguePlayerSearch(debouncedSearchQuery)
  const [selectedPlayers, setSelectedPlayers] = useState([])
  const selectedPlayerIds = useMemo(() => selectedPlayers.map((p) => p.fpl_player_id), [selectedPlayers])
  const { managerIdsOwningAny, loading: ownershipLoading } = useLeaguePlayerOwnershipMultiple(selectedPlayerIds, gameweek)

  const [sort, setSort] = useState(DEFAULT_SORT)
  const [searchQuery, setSearchQuery] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [selectedManagerId, setSelectedManagerId] = useState(null)
  const [selectedManagerDisplayName, setSelectedManagerDisplayName] = useState('')
  const [selectedManagerName, setSelectedManagerName] = useState('')
  const [showManagerDetailLegend, setShowManagerDetailLegend] = useState(false)
  const searchContainerRef = useRef(null)
  const managerDetailLegendRef = useRef(null)

  const { data: selectedManagerPlayers, isLoading: selectedManagerPlayersLoading } = useCurrentGameweekPlayersForManager(selectedManagerId)
  const { data: configuredManagerPlayers } = useCurrentGameweekPlayers()
  const { top10ByStat } = useGameweekTop10ByStat()
  const { impactByPlayerId: selectedManagerImpact, loading: selectedManagerImpactLoading } = usePlayerImpactForManager(selectedManagerId, LEAGUE_ID)
  const { hasLiveGames } = useLiveGameweekStatus(gameweek)
  const { inPlay: selectedManagerInPlay } = useManagerLiveStatus(selectedManagerId, gameweek)
  const isSelectedManagerLiveUpdating = hasLiveGames && (selectedManagerInPlay ?? 0) > 0
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

  const handleManagerRowClick = useCallback((managerId, teamName, managerName) => {
    setSelectedManagerId(managerId)
    setSelectedManagerDisplayName(teamName || `Manager ${managerId}`)
    setSelectedManagerName(managerName || '')
  }, [])

  const handleSort = useCallback((column) => {
    if (!SORT_COLUMNS.includes(column)) return
    setSort((prev) => {
      if (prev.column === column) {
        return { column, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      }
      return { column, dir: column === 'manager' ? 'asc' : 'desc' }
    })
  }, [])

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
      return {
        ...s,
        _rank: rank,
        _rankChange: rankChange,
        _displayName: displayName,
        _leftToPlay: leftToPlay,
        _inPlay: inPlay
      }
    })
    const mult = sort.dir === 'asc' ? 1 : -1
    const cmp = (a, b) => {
      switch (sort.column) {
        case 'rank':
          return mult * (a._rank - b._rank)
        case 'manager':
          return mult * (a._displayName || '').localeCompare(b._displayName || '')
        case 'total':
          return mult * ((a.total_points ?? 0) - (b.total_points ?? 0))
        case 'gw':
          return mult * ((a.gameweek_points ?? 0) - (b.gameweek_points ?? 0))
        case 'left':
          return mult * ((a._leftToPlay ?? -1) - (b._leftToPlay ?? -1))
        case 'live':
          return mult * ((a._inPlay ?? -1) - (b._inPlay ?? -1))
        default:
          return 0
      }
    }
    return [...rows].sort(cmp)
  }, [standings, liveStatusByManager, sort.column, sort.dir])

  const displayRows = useMemo(() => {
    if (selectedPlayers.length === 0 || ownershipLoading) return sortedRows
    const set = new Set(managerIdsOwningAny)
    return sortedRows.filter((r) => set.has(r.manager_id))
  }, [sortedRows, selectedPlayers.length, managerIdsOwningAny, ownershipLoading])

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
            This may mean the league hasn&apos;t been loaded into the database yet, or there&apos;s no data for the current gameweek.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="mini-league-page">
      <div className="league-standings-bento league-standings-page">
        <div className="league-ownership-search-container" ref={searchContainerRef}>
          <div className="league-ownership-search-bar">
            <Search className="league-ownership-search-icon" size={16} aria-hidden />
            <input
              type="text"
              className="league-ownership-search-input"
              placeholder="Search player to see league ownership…"
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
              Showing {displayRows.length} (of {standings.length}) manager{displayRows.length !== 1 ? 's' : ''} who own {selectedPlayers.length === 1 ? (
                <strong>{selectedPlayers[0].web_name}</strong>
              ) : (
                <>
                  <strong>{selectedPlayers.map((p) => p.web_name).join(', ')}</strong>
                </>
              )}{' '}
              this gameweek
            </p>
          )}
        </div>
        <div className={`league-standings-bento-table-wrapper${dropdownOpen && searchQuery.trim().length >= 2 ? ' league-standings-bento-table-wrapper--dimmed' : ''}`}>
          <table className="league-standings-bento-table">
            <thead>
              <tr>
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
              </tr>
            </thead>
            <tbody>
              {displayRows.map((s) => {
                const rank = s._rank
                const change = s._rankChange != null ? s._rankChange : null
                const displayName = s._displayName
                const isCurrentUser = currentManagerId != null && Number(s.manager_id) === Number(currentManagerId)
                const leftToPlay = liveStatusLoading ? null : (s._leftToPlay ?? null)
                const inPlay = liveStatusLoading ? null : (s._inPlay ?? null)
                const activeChip = activeChipLoading ? null : (activeChipByManager[s.manager_id] ?? null)
                const chipLabel = activeChip ? (CHIP_LABELS[activeChip] ?? activeChip) : null
                const chipColor = activeChip ? (CHIP_COLORS[activeChip] ?? 'var(--text-secondary)') : null

                return (
                  <tr
                    key={s.manager_id}
                    className={`league-standings-bento-row ${isCurrentUser ? 'league-standings-bento-row-you' : ''} ${selectedManagerId === Number(s.manager_id) ? 'league-standings-bento-row-selected' : ''}`}
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
                    <td className="league-standings-bento-team" title={displayName}>
                      <span className="league-standings-bento-team-name">{abbreviateName(displayName)}</span>
                      {chipLabel && (
                        <span
                          className="league-standings-bento-chip-badge"
                          style={{ backgroundColor: chipColor }}
                          title={activeChip}
                        >
                          {chipLabel}
                        </span>
                      )}
                    </td>
                    <td className={`league-standings-bento-total ${(s.total_points ?? null) === 0 ? 'league-standings-bento-cell-muted' : ''}`}>{s.total_points ?? '—'}</td>
                    <td className={`league-standings-bento-gw ${(s.gameweek_points ?? null) === 0 ? 'league-standings-bento-cell-muted' : ''}`}>{s.gameweek_points ?? '—'}</td>
                    <td className={`league-standings-bento-left-to-play ${leftToPlay === 0 ? 'league-standings-bento-cell-muted' : ''}`}>
                      {leftToPlay !== null && leftToPlay !== undefined ? leftToPlay : '—'}
                    </td>
                    <td className={`league-standings-bento-in-play ${inPlay === 0 ? 'league-standings-bento-cell-muted' : ''}`}>
                      {inPlay !== null && inPlay !== undefined ? inPlay : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
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
                  {selectedManagerDisplayName}
                </h2>
                {selectedManagerName && (
                  <p className="manager-detail-modal-subtitle">{selectedManagerName}</p>
                )}
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
                  <Info className="bento-card-expand-icon-svg" size={11} strokeWidth={1.5} />
                </div>
                {showManagerDetailLegend && (
                  <div className="gw-legend-popup manager-detail-modal-legend-popup" role="dialog" aria-label="GW points legend">
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
            <div className="manager-detail-modal-body bento-card-chart">
              <GameweekPointsView
                data={selectedManagerPlayers || []}
                loading={selectedManagerPlayersLoading || selectedManagerImpactLoading}
                top10ByStat={top10ByStat}
                impactByPlayerId={selectedManagerImpact ?? {}}
                isLiveUpdating={isSelectedManagerLiveUpdating}
                ownedByYouPlayerIds={ownedByYouPlayerIds}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
