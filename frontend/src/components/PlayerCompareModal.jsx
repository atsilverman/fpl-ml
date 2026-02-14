import { useState, useRef, useEffect } from 'react'
import { X } from 'lucide-react'
import { useLeaguePlayerSearch } from '../hooks/useLeaguePlayerSearch'
import { usePlayerGameweekStatsRange } from '../hooks/usePlayerGameweekStats'
import { useToast } from '../contexts/ToastContext'
import { getVisibleStats, formatStatValue, getCompareValue, getLeader } from '../utils/compareStats'
import './MiniLeaguePage.css'
import './PlayerCompareModal.css'

const GW_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'last6', label: 'Last 6' },
  { key: 'last12', label: 'Last 12' },
]

const POSITION_ABBREV = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' }

/** Build a stats object from a GW list row (player object from GameweekPointsView). */
function statsFromRow(player) {
  const pts = player.contributedPoints ?? player.points ?? 0
  return {
    points: pts,
    minutes: player.minutes ?? 0,
    goals_scored: player.goals_scored ?? 0,
    assists: player.assists ?? 0,
    clean_sheets: player.clean_sheets ?? 0,
    saves: player.saves ?? 0,
    bps: player.bps ?? 0,
    bonus: player.bonus ?? 0,
    defensive_contribution: player.defensive_contribution ?? 0,
    yellow_cards: player.yellow_cards ?? 0,
    red_cards: player.red_cards ?? 0,
    expected_goals: Number(player.expected_goals) || 0,
    expected_assists: Number(player.expected_assists) || 0,
    expected_goal_involvements: Number(player.expected_goal_involvements) || 0,
    expected_goals_conceded: Number(player.expected_goals_conceded) || 0,
  }
}

export default function PlayerCompareModal({
  player1,
  gameweek,
  onClose,
}) {
  const { toast } = useToast()
  const [searchQuery, setSearchQuery] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [selectedPlayer2, setSelectedPlayer2] = useState(null)
  const [gwFilter, setGwFilter] = useState('last6')
  const [per90, setPer90] = useState(false)
  const searchContainerRef = useRef(null)
  const debouncedQuery = useDebounce(searchQuery, 200)
  const player1Id = player1?.player_id ?? player1?.fpl_player_id ?? null
  const { players: searchPlayers, loading: searchLoading } = useLeaguePlayerSearch(debouncedQuery)
  const { stats: player1StatsRange, loading: p1RangeLoading } = usePlayerGameweekStatsRange(player1Id, gameweek, gwFilter)
  const { stats: player2Stats, loading: p2StatsLoading } = usePlayerGameweekStatsRange(
    selectedPlayer2?.fpl_player_id ?? null,
    gameweek,
    gwFilter
  )

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose])

  if (!player1) return null

  const stats1 = (p1RangeLoading ? null : player1StatsRange) ?? statsFromRow(player1)
  const stats2 = player2Stats
  const player1Name = player1.player_name ?? 'Player 1'
  const player2Name = selectedPlayer2?.web_name ?? '—'
  const pos1 = player1.player_position ?? null
  const pos2 = selectedPlayer2?.position ?? null
  const visibleStats = getVisibleStats(pos1, pos2)
  const minutes1 = stats1?.minutes ?? 0
  const minutes2 = stats2?.minutes ?? 0

  return (
    <div
      className="manager-detail-modal-overlay player-compare-modal-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="player-compare-modal-title"
    >
      <div
        className="manager-detail-modal-content player-compare-modal-content"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="manager-detail-modal-header">
          <h2 id="player-compare-modal-title" className="manager-detail-modal-title player-compare-modal-title">
            Compare players
          </h2>
          <button type="button" className="manager-detail-modal-close" onClick={onClose} aria-label="Close">
            <X size={20} strokeWidth={2} />
          </button>
        </div>
        <div className="manager-detail-modal-body player-compare-modal-body">
          <div className="player-compare-controls">
            <div className="player-compare-gw-filters">
              {GW_FILTERS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  className={`player-compare-gw-filter-btn ${gwFilter === key ? 'active' : ''}`}
                  onClick={() => setGwFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="player-compare-controls-divider" aria-hidden="true" />
            <button
              type="button"
              className={`player-compare-gw-filter-btn ${per90 ? 'active' : ''}`}
              onClick={() => {
                const next = !per90
                setPer90(next)
                toast(next ? 'Showing per 90 stats' : 'Showing total stats')
              }}
              aria-pressed={per90}
              aria-label={per90 ? 'Showing per 90 stats' : 'Show per 90 stats'}
            >
              Per 90
            </button>
          </div>

          <div className="player-compare-table-wrap">
            <table className="player-compare-table">
              <thead>
                <tr>
                  <th className="player-compare-th player-compare-th-p1">
                    <div className="player-compare-th-player">
                      {player1.player_team_short_name && (
                        <img
                          src={`/badges/${player1.player_team_short_name}.svg`}
                          alt=""
                          className="player-compare-badge"
                          onError={(e) => { e.target.style.display = 'none' }}
                        />
                      )}
                      <span className="player-compare-player-name">{player1Name}</span>
                      <button
                        type="button"
                        className="player-compare-th-clear"
                        onClick={onClose}
                        aria-label="Close and change player"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </th>
                  <th className="player-compare-th player-compare-th-stat">Stat</th>
                  <th className="player-compare-th player-compare-th-p2">
                    {selectedPlayer2 ? (
                      <div className="player-compare-th-player">
                        {selectedPlayer2.team_short_name && (
                          <img
                            src={`/badges/${selectedPlayer2.team_short_name}.svg`}
                            alt=""
                            className="player-compare-badge"
                            onError={(e) => { e.target.style.display = 'none' }}
                          />
                        )}
                        <span className="player-compare-player-name">{selectedPlayer2.web_name}</span>
                        <button
                          type="button"
                          className="player-compare-th-clear"
                          onClick={() => { setSelectedPlayer2(null); setSearchQuery('') }}
                          aria-label="Clear and select different player"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <div className="player-compare-th-search-wrap" ref={searchContainerRef}>
                        <input
                          type="text"
                          className="player-compare-search-input"
                          placeholder="Search player…"
                          value={searchQuery}
                          onChange={(e) => {
                            setSearchQuery(e.target.value)
                            setDropdownOpen(true)
                          }}
                          onFocus={() => searchQuery.trim().length >= 2 && setDropdownOpen(true)}
                          aria-autocomplete="list"
                          aria-expanded={dropdownOpen}
                          aria-controls="player-compare-autocomplete"
                        />
                        {dropdownOpen && searchQuery.trim().length >= 2 && (
                          <ul
                            id="player-compare-autocomplete"
                            className="player-compare-autocomplete league-ownership-autocomplete"
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
                                  onClick={() => {
                                    setSelectedPlayer2(p)
                                    setSearchQuery('')
                                    setDropdownOpen(false)
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault()
                                      setSelectedPlayer2(p)
                                      setSearchQuery('')
                                      setDropdownOpen(false)
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
                      </div>
                    )}
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleStats.map(({ key, label, higherBetter }) => {
                  const v1 = stats1[key]
                  const v2 = stats2?.[key] ?? (key === 'points' && stats2 ? stats2.points : undefined)
                  const compareV1 = getCompareValue(key, v1, minutes1, per90)
                  const compareV2 = getCompareValue(key, v2, minutes2, per90)
                  const leader = stats2 != null ? getLeader(key, higherBetter, compareV1, compareV2) : null
                  const fmtOpts1 = { per90, minutes: minutes1 }
                  const fmtOpts2 = { per90, minutes: minutes2 }
                  return (
                    <tr key={key} className="player-compare-tr">
                      <td className="player-compare-td player-compare-td-p1">
                        <span
                          className={`player-compare-pill ${leader === 'p1' ? 'player-compare-pill--leader' : ''}`}
                        >
                          {formatStatValue(key, v1, fmtOpts1)}
                        </span>
                      </td>
                      <td className="player-compare-td player-compare-td-stat">{label}</td>
                      <td className="player-compare-td player-compare-td-p2">
                        {p2StatsLoading && !stats2 ? (
                          <span className="player-compare-loading">…</span>
                        ) : (
                          <span
                            className={`player-compare-pill ${leader === 'p2' ? 'player-compare-pill--leader' : ''}`}
                          >
                            {stats2 != null ? formatStatValue(key, v2, fmtOpts2) : '—'}
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

function useDebounce(value, ms) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}
