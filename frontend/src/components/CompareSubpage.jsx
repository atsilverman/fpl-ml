import { useState, useRef, useEffect } from 'react'
import { X } from 'lucide-react'
import { useGameweekData } from '../hooks/useGameweekData'
import { useLeaguePlayerSearch } from '../hooks/useLeaguePlayerSearch'
import { usePlayerGameweekStatsRange, usePlayerCompareStatRanks } from '../hooks/usePlayerGameweekStats'
import { useToast } from '../contexts/ToastContext'
import { getVisibleStats, formatStatValue, formatRankDisplay, getCompareValue, getLeader } from '../utils/compareStats'
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
  const { toast } = useToast()
  const [selectedPlayer1, setSelectedPlayer1] = useState(null)
  const [selectedPlayer2, setSelectedPlayer2] = useState(null)
  const [gwFilter, setGwFilter] = useState('last6')
  const [per90, setPer90] = useState(false)
  const [perMillion, setPerMillion] = useState(false)
  const [showRank, setShowRank] = useState(false)
  const [dropdownOpen1, setDropdownOpen1] = useState(false)
  const [dropdownOpen2, setDropdownOpen2] = useState(false)
  const searchContainerRef1 = useRef(null)
  const searchContainerRef2 = useRef(null)

  const player1Id = selectedPlayer1?.fpl_player_id ?? null
  const player2Id = selectedPlayer2?.fpl_player_id ?? null
  const { stats: player1Stats, loading: p1Loading } = usePlayerGameweekStatsRange(player1Id, gameweek, gwFilter)
  const { stats: player2Stats, loading: p2Loading } = usePlayerGameweekStatsRange(player2Id, gameweek, gwFilter)
  const rankBy = per90 ? 'per90' : 'total'
  const { ranks: ranks1, loading: ranks1Loading } = usePlayerCompareStatRanks(player1Id, gameweek, gwFilter, rankBy)
  const { ranks: ranks2, loading: ranks2Loading } = usePlayerCompareStatRanks(player2Id, gameweek, gwFilter, rankBy)

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
  const priceTenths1 = selectedPlayer1?.cost_tenths ?? null
  const priceTenths2 = selectedPlayer2?.cost_tenths ?? null

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
        <div className="player-compare-controls-divider" aria-hidden="true" />
        <button
          type="button"
          className={`player-compare-gw-filter-btn ${per90 ? 'active' : ''}`}
          onClick={() => {
            setPer90((prev) => !prev)
            setPerMillion(false)
            toast(!per90 ? 'Showing per 90 stats' : 'Showing total stats')
          }}
          aria-pressed={per90}
          aria-label={per90 ? 'Showing per 90 stats' : 'Show per 90 stats'}
        >
          Per 90
        </button>
        <button
          type="button"
          className={`player-compare-gw-filter-btn ${perMillion ? 'active' : ''}`}
          onClick={() => {
            setPerMillion((prev) => !prev)
            setPer90(false)
            toast(!perMillion ? 'Showing per £ stats' : 'Showing total stats')
          }}
          aria-pressed={perMillion}
          aria-label={perMillion ? 'Showing per £ stats' : 'Show per £ stats'}
        >
          Per £
        </button>
        <div className="player-compare-controls-divider" aria-hidden="true" />
        <button
          type="button"
          className={`player-compare-gw-filter-btn ${showRank ? 'active' : ''}`}
          onClick={() => {
            const next = !showRank
            setShowRank(next)
            toast(next ? 'Showing ranked stats (1 = best)' : 'Showing raw stats')
          }}
          aria-pressed={showRank}
          aria-label={showRank ? 'Showing ranked stats' : 'Show ranked stats'}
        >
          Rank
        </button>
      </div>

      <div className="player-stats-wrap">
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
              <th className="player-compare-th player-compare-th-stat" aria-label="Stat" />
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
              const r1 = showRank ? ranks1?.[key] : null
              const r2 = showRank ? ranks2?.[key] : null
              const compareV1 = showRank ? (r1 != null ? r1 : Infinity) : getCompareValue(key, v1, minutes1, per90, perMillion, priceTenths1)
              const compareV2 = showRank ? (r2 != null ? r2 : Infinity) : getCompareValue(key, v2, minutes2, per90, perMillion, priceTenths2)
              const rowLeader = leader
                ? showRank
                  ? getLeader(key, false, compareV1, compareV2)
                  : getLeader(key, higherBetter, compareV1, compareV2)
                : null
              const fmtOpts1 = { per90, perMillion, minutes: minutes1, priceTenths: priceTenths1 }
              const fmtOpts2 = { per90, perMillion, minutes: minutes2, priceTenths: priceTenths2 }
              const display1 = showRank ? formatRankDisplay(ranks1, key) : formatStatValue(key, v1, fmtOpts1)
              const display2 = showRank ? formatRankDisplay(ranks2, key) : formatStatValue(key, v2, fmtOpts2)
              return (
                <tr key={key} className="player-compare-tr">
                  <td className="player-compare-td player-compare-td-p1">
                    {selectedPlayer1 ? (
                      showRank ? (ranks1Loading || ranks1 == null ? <span className="player-compare-loading">…</span> : (
                        <span
                          className={`player-compare-pill ${rowLeader === 'p1' ? 'player-compare-pill--leader' : ''}`}
                        >
                          {display1}
                        </span>
                      )) : p1Loading && !stats1 ? (
                        <span className="player-compare-loading">…</span>
                      ) : (
                        <span
                          className={`player-compare-pill ${rowLeader === 'p1' ? 'player-compare-pill--leader' : ''}`}
                        >
                          {display1}
                        </span>
                      )
                    ) : (
                      <span className="player-compare-pill">—</span>
                    )}
                  </td>
                  <td className="player-compare-td player-compare-td-stat">{label}</td>
                  <td className="player-compare-td player-compare-td-p2">
                    {selectedPlayer2 ? (
                      showRank ? (ranks2Loading || ranks2 == null ? <span className="player-compare-loading">…</span> : (
                        <span
                          className={`player-compare-pill ${rowLeader === 'p2' ? 'player-compare-pill--leader' : ''}`}
                        >
                          {display2}
                        </span>
                      )) : p2Loading && !stats2 ? (
                        <span className="player-compare-loading">…</span>
                      ) : (
                        <span
                          className={`player-compare-pill ${rowLeader === 'p2' ? 'player-compare-pill--leader' : ''}`}
                        >
                          {display2}
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
    </div>
  )
}
