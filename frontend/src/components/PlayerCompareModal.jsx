import { useState, useRef, useEffect } from 'react'
import { X } from 'lucide-react'
import { useLeaguePlayerSearch } from '../hooks/useLeaguePlayerSearch'
import { usePlayerGameweekStats } from '../hooks/usePlayerGameweekStats'
import './MiniLeaguePage.css'
import './PlayerCompareModal.css'

const COMPARE_STATS = [
  { key: 'points', label: 'Points', higherBetter: true },
  { key: 'minutes', label: 'Minutes', higherBetter: true },
  { key: 'goals_scored', label: 'Goals', higherBetter: true },
  { key: 'assists', label: 'Assists', higherBetter: true },
  { key: 'clean_sheets', label: 'Clean sheets', higherBetter: true },
  { key: 'saves', label: 'Saves', higherBetter: true },
  { key: 'bps', label: 'BPS', higherBetter: true },
  { key: 'bonus', label: 'Bonus', higherBetter: true },
  { key: 'defensive_contribution', label: 'DEF', higherBetter: true },
  { key: 'yellow_cards', label: 'Yellow cards', higherBetter: false },
  { key: 'red_cards', label: 'Red cards', higherBetter: false },
  { key: 'expected_goals', label: 'xG', higherBetter: true },
  { key: 'expected_assists', label: 'xA', higherBetter: true },
  { key: 'expected_goal_involvements', label: 'xGI', higherBetter: true },
  { key: 'expected_goals_conceded', label: 'xGC', higherBetter: false },
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

function formatStatValue(key, value) {
  if (value == null) return '—'
  if (['expected_goals', 'expected_assists', 'expected_goal_involvements', 'expected_goals_conceded'].includes(key)) {
    const n = Number(value)
    return n === 0 ? '0' : n.toFixed(2)
  }
  return String(value)
}

/** Returns 'p1' | 'p2' | 'tie' for who leads (or tie). */
function getLeader(key, higherBetter, v1, v2) {
  const a = Number(v1) ?? 0
  const b = Number(v2) ?? 0
  if (a === b) return 'tie'
  const p1Wins = higherBetter ? a > b : a < b
  return p1Wins ? 'p1' : 'p2'
}

export default function PlayerCompareModal({
  player1,
  gameweek,
  onClose,
}) {
  const [searchQuery, setSearchQuery] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [selectedPlayer2, setSelectedPlayer2] = useState(null)
  const searchContainerRef = useRef(null)
  const debouncedQuery = useDebounce(searchQuery, 200)
  const { players: searchPlayers, loading: searchLoading } = useLeaguePlayerSearch(debouncedQuery)
  const { stats: player2Stats, loading: p2StatsLoading } = usePlayerGameweekStats(
    selectedPlayer2?.fpl_player_id ?? null,
    gameweek
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

  const stats1 = statsFromRow(player1)
  const stats2 = player2Stats
  const player1Name = player1.player_name ?? 'Player 1'
  const player2Name = selectedPlayer2?.web_name ?? '—'

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
            Compare players (GW{gameweek ?? '—'})
          </h2>
          <button type="button" className="manager-detail-modal-close" onClick={onClose} aria-label="Close">
            <X size={20} strokeWidth={2} />
          </button>
        </div>
        <div className="manager-detail-modal-body player-compare-modal-body">
          <div className="player-compare-players-row">
            <div className="player-compare-player-head player-compare-player-1">
              {player1.player_team_short_name && (
                <img
                  src={`/badges/${player1.player_team_short_name}.svg`}
                  alt=""
                  className="player-compare-badge"
                  onError={(e) => { e.target.style.display = 'none' }}
                />
              )}
              <span className="player-compare-player-name">{player1Name}</span>
            </div>
            <div className="player-compare-vs" aria-hidden>vs</div>
            <div className="player-compare-player-head player-compare-player-2">
              {selectedPlayer2 ? (
                <>
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
                    className="player-compare-clear-p2"
                    onClick={() => { setSelectedPlayer2(null); setSearchQuery('') }}
                    aria-label="Clear second player"
                  >
                    <X size={14} />
                  </button>
                </>
              ) : (
                <div className="player-compare-search-wrap" ref={searchContainerRef}>
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
            </div>
          </div>

          <div className="player-compare-table-wrap">
            <table className="player-compare-table">
              <thead>
                <tr>
                  <th className="player-compare-th player-compare-th-p1">Player 1</th>
                  <th className="player-compare-th player-compare-th-stat">Stat</th>
                  <th className="player-compare-th player-compare-th-p2">Player 2</th>
                </tr>
              </thead>
              <tbody>
                {COMPARE_STATS.map(({ key, label, higherBetter }) => {
                  const v1 = stats1[key]
                  const v2 = stats2?.[key] ?? (key === 'points' && stats2 ? stats2.points : undefined)
                  const leader = stats2 != null ? getLeader(key, higherBetter, v1, v2) : null
                  return (
                    <tr key={key} className="player-compare-tr">
                      <td className="player-compare-td player-compare-td-p1">
                        <span
                          className={`player-compare-pill ${leader === 'p1' ? 'player-compare-pill--leader' : ''}`}
                        >
                          {formatStatValue(key, v1)}
                        </span>
                      </td>
                      <td className="player-compare-td player-compare-td-stat">{label}</td>
                      <td className="player-compare-td player-compare-td-p2">
                        {p2StatsLoading && !stats2 ? (
                          <span className="player-compare-loading">…</span>
                        ) : (
                          <span
                            className={`player-compare-pill ${leader === 'p2' ? 'player-compare-pill--leader' : ''} ${leader === 'tie' ? 'player-compare-pill--tie' : ''}`}
                          >
                            {stats2 != null ? formatStatValue(key, v2) : '—'}
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
