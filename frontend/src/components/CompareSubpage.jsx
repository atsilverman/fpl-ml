import { useState, useRef, useEffect } from 'react'
import { X } from 'lucide-react'
import { useGameweekData } from '../hooks/useGameweekData'
import { useLeaguePlayerSearch } from '../hooks/useLeaguePlayerSearch'
import { usePlayerGameweekStatsRange } from '../hooks/usePlayerGameweekStats'
import { getVisibleStats, formatStatValue, getCompareValue, getLeader } from '../utils/compareStats'
import './PlayerCompareModal.css'
import './MiniLeaguePage.css'

const GW_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'last6', label: 'Last 6' },
  { key: 'last12', label: 'Last 12' },
]

const POSITION_ABBREV = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' }

function useDebounce(value, ms) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

function PlayerSearchSlot({ selectedPlayer, onSelect, onClear, placeholder, slotId, searchContainerRef, dropdownOpen, setDropdownOpen }) {
  const [searchQuery, setSearchQuery] = useState('')
  const debouncedQuery = useDebounce(searchQuery, 200)
  const { players: searchPlayers, loading: searchLoading } = useLeaguePlayerSearch(debouncedQuery)
  const listboxId = `player-compare-autocomplete-${slotId}`

  if (selectedPlayer) {
    return (
      <div className="player-compare-th-player">
        {selectedPlayer.team_short_name && (
          <img
            src={`/badges/${selectedPlayer.team_short_name}.svg`}
            alt=""
            className="player-compare-badge"
            onError={(e) => { e.target.style.display = 'none' }}
          />
        )}
        <span className="player-compare-player-name">{selectedPlayer.web_name}</span>
        <button
          type="button"
          className="player-compare-th-clear"
          onClick={onClear}
          aria-label="Clear and select different player"
        >
          <X size={14} />
        </button>
      </div>
    )
  }

  return (
    <div className="player-compare-th-search-wrap" ref={searchContainerRef}>
      <input
        type="text"
        className="player-compare-search-input"
        placeholder={placeholder}
        value={searchQuery}
        onChange={(e) => {
          setSearchQuery(e.target.value)
          setDropdownOpen(true)
        }}
        onFocus={() => searchQuery.trim().length >= 2 && setDropdownOpen(true)}
        aria-autocomplete="list"
        aria-expanded={dropdownOpen}
        aria-controls={listboxId}
      />
      {dropdownOpen && searchQuery.trim().length >= 2 && (
        <ul
          id={listboxId}
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
                  onSelect(p)
                  setSearchQuery('')
                  setDropdownOpen(false)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelect(p)
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
  )
}

export default function CompareSubpage() {
  const { gameweek } = useGameweekData()
  const [selectedPlayer1, setSelectedPlayer1] = useState(null)
  const [selectedPlayer2, setSelectedPlayer2] = useState(null)
  const [gwFilter, setGwFilter] = useState('last6')
  const [per90, setPer90] = useState(false)
  const [dropdownOpen1, setDropdownOpen1] = useState(false)
  const [dropdownOpen2, setDropdownOpen2] = useState(false)
  const searchContainerRef1 = useRef(null)
  const searchContainerRef2 = useRef(null)

  const player1Id = selectedPlayer1?.fpl_player_id ?? null
  const player2Id = selectedPlayer2?.fpl_player_id ?? null
  const { stats: player1Stats, loading: p1Loading } = usePlayerGameweekStatsRange(player1Id, gameweek, gwFilter)
  const { stats: player2Stats, loading: p2Loading } = usePlayerGameweekStatsRange(player2Id, gameweek, gwFilter)

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (searchContainerRef1.current && !searchContainerRef1.current.contains(e.target)) setDropdownOpen1(false)
      if (searchContainerRef2.current && !searchContainerRef2.current.contains(e.target)) setDropdownOpen2(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const stats1 = player1Stats
  const stats2 = player2Stats
  const hasBoth = selectedPlayer1 && selectedPlayer2
  const leader = hasBoth && stats1 != null && stats2 != null
  const pos1 = selectedPlayer1?.position ?? null
  const pos2 = selectedPlayer2?.position ?? null
  const visibleStats = getVisibleStats(pos1, pos2)
  const minutes1 = stats1?.minutes ?? 0
  const minutes2 = stats2?.minutes ?? 0

  return (
    <div className="compare-subpage">
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
        <label className="player-compare-per90-toggle">
          <input
            type="checkbox"
            checked={per90}
            onChange={(e) => setPer90(e.target.checked)}
            aria-label="Show stats per 90 minutes"
          />
          <span className="player-compare-per90-label">Per 90</span>
        </label>
      </div>

      <div className="player-compare-table-wrap">
        <table className="player-compare-table">
          <thead>
            <tr>
              <th className="player-compare-th player-compare-th-p1">
                <PlayerSearchSlot
                  selectedPlayer={selectedPlayer1}
                  onSelect={setSelectedPlayer1}
                  onClear={() => setSelectedPlayer1(null)}
                  placeholder="Search player…"
                  slotId="p1"
                  searchContainerRef={searchContainerRef1}
                  dropdownOpen={dropdownOpen1}
                  setDropdownOpen={setDropdownOpen1}
                />
              </th>
              <th className="player-compare-th player-compare-th-stat">Stat</th>
              <th className="player-compare-th player-compare-th-p2">
                <PlayerSearchSlot
                  selectedPlayer={selectedPlayer2}
                  onSelect={setSelectedPlayer2}
                  onClear={() => setSelectedPlayer2(null)}
                  placeholder="Search player…"
                  slotId="p2"
                  searchContainerRef={searchContainerRef2}
                  dropdownOpen={dropdownOpen2}
                  setDropdownOpen={setDropdownOpen2}
                />
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleStats.map(({ key, label, higherBetter }) => {
              const v1 = stats1?.[key] ?? (key === 'points' && stats1 ? stats1.points : undefined)
              const v2 = stats2?.[key] ?? (key === 'points' && stats2 ? stats2.points : undefined)
              const compareV1 = getCompareValue(key, v1, minutes1, per90)
              const compareV2 = getCompareValue(key, v2, minutes2, per90)
              const rowLeader = leader ? getLeader(key, higherBetter, compareV1, compareV2) : null
              const fmtOpts1 = { per90, minutes: minutes1 }
              const fmtOpts2 = { per90, minutes: minutes2 }
              return (
                <tr key={key} className="player-compare-tr">
                  <td className="player-compare-td player-compare-td-p1">
                    {selectedPlayer1 ? (
                      p1Loading && !stats1 ? (
                        <span className="player-compare-loading">…</span>
                      ) : (
                        <span
                          className={`player-compare-pill ${rowLeader === 'p1' ? 'player-compare-pill--leader' : ''}`}
                        >
                          {formatStatValue(key, v1, fmtOpts1)}
                        </span>
                      )
                    ) : (
                      <span className="player-compare-pill">—</span>
                    )}
                  </td>
                  <td className="player-compare-td player-compare-td-stat">{label}</td>
                  <td className="player-compare-td player-compare-td-p2">
                    {selectedPlayer2 ? (
                      p2Loading && !stats2 ? (
                        <span className="player-compare-loading">…</span>
                      ) : (
                        <span
                          className={`player-compare-pill ${rowLeader === 'p2' ? 'player-compare-pill--leader' : ''}`}
                        >
                          {formatStatValue(key, v2, fmtOpts2)}
                        </span>
                      )
                    ) : (
                      <span className="player-compare-pill">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
