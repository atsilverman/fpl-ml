import { useState, useMemo, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { Filter, X } from 'lucide-react'
import { useDefconGameweekPlayers } from '../hooks/useDefconGameweekPlayers'
import { useFixtures } from '../hooks/useFixtures'
import { useGameweekData } from '../hooks/useGameweekData'
import { useConfiguration } from '../contexts/ConfigurationContext'
import { supabase } from '../lib/supabase'
import AnimatedValue from './AnimatedValue'
import './DefconSubpage.css'

const POSITION_LABELS = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' }

function DefconRow({ player, opponentShortName, isDoubleGameweek }) {
  const { web_name, team_short_name, defcon, threshold, position, is_live, match_provisional, match_confirmed } = player
  const isGk = threshold >= 999
  const denomDisplay = isGk ? '—' : threshold
  const numDisplay = isGk ? 0 : (defcon ?? 0)
  const notches = isGk ? 0 : threshold
  const filledNotches = isGk ? 0 : Math.min(defcon, threshold)
  const positionLabel = POSITION_LABELS[position] ?? '—'
  const fractionTitle = isGk ? 'Goalkeepers cannot earn DEFCON (no threshold)' : undefined
  const defconAchieved = !isGk && defcon >= threshold

  const statusDot = is_live
    ? { className: 'defcon-status-dot defcon-status-dot--live', title: 'Live', ariaLabel: 'Live' }
    : null

  return (
    <div className={`defcon-row-card${defconAchieved ? ' defcon-row-card--achieved' : ''}`}>
      <div className="defcon-row">
      {team_short_name && (
        <img
          src={`/badges/${team_short_name}.svg`}
          alt=""
          className="defcon-badge"
        />
      )}
      <div className="defcon-player-info">
        <div className="defcon-name-row">
          <span className="defcon-name">{web_name}</span>
          {statusDot && (
            <span className="defcon-status-dot-wrap" aria-hidden>
              <span
                className={statusDot.className}
                title={statusDot.title}
                aria-label={statusDot.ariaLabel}
              />
            </span>
          )}
        </div>
        <div className="defcon-position-row">
          <span className={`defcon-position-badge defcon-position-badge--${position}`}>
            {positionLabel}
          </span>
          {isDoubleGameweek && opponentShortName && <span className="defcon-v-opp">vs {opponentShortName}</span>}
        </div>
      </div>
      {notches > 0 && (
        <div className="defcon-notch-badge">
          <div
            className="defcon-notch-bar"
            style={{
              '--notches': notches,
              '--progress-pct': notches ? `${(filledNotches / notches) * 100}%` : '0%',
            }}
            role="progressbar"
            aria-valuenow={defcon}
            aria-valuemin={0}
            aria-valuemax={threshold}
            aria-label={`DEFCON ${defcon} of ${threshold}`}
          >
            <div className="defcon-notch-cover" aria-hidden />
            <div className="defcon-notch-dividers" aria-hidden />
          </div>
        </div>
      )}
      <AnimatedValue value={defcon ?? 0} className="defcon-fraction" title={fractionTitle}>
        <span className="defcon-num">{numDisplay}</span>
        <span className="defcon-sep">/</span>
        <span className="defcon-denom">{denomDisplay}</span>
      </AnimatedValue>
      </div>
    </div>
  )
}

export default function DefconSubpage({ isActive = true }) {
  const { config } = useConfiguration()
  const { gameweek } = useGameweekData()
  const { players, loading, error } = useDefconGameweekPlayers()
  const { fixtures } = useFixtures(gameweek)
  const managerId = config?.managerId ?? null

  const prevActiveRef = useRef(false)
  const [barAnimationKey, setBarAnimationKey] = useState(0)
  useEffect(() => {
    if (isActive && !prevActiveRef.current) {
      setBarAnimationKey((k) => k + 1)
    }
    prevActiveRef.current = isActive
  }, [isActive])

  const [searchQuery, setSearchQuery] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [showFilterPopup, setShowFilterPopup] = useState(false)
  /** Section 1: ownership — all, owned only, not owned. Default: owned when visiting page. */
  const [scopeFilter, setScopeFilter] = useState('owned')
  /** Section 2: position — all, DEF (2), MID (3), FWD (4). Default: all. */
  const [positionFilter, setPositionFilter] = useState('all')
  /** Section 3: matchup — 'all' | 'live' | fixture id. Default: all matchups. */
  const [matchupFilter, setMatchupFilter] = useState('all')
  const inputRef = useRef(null)
  const dropdownRef = useRef(null)
  const filterPopupRef = useRef(null)

  const { data: teamsMap = {} } = useQuery({
    queryKey: ['teams-short-names'],
    queryFn: async () => {
      const { data, error } = await supabase.from('teams').select('team_id, short_name')
      if (error) throw error
      const map = {}
      ;(data || []).forEach(t => { map[t.team_id] = t.short_name })
      return map
    },
    staleTime: 5 * 60 * 1000,
  })

  const { data: managerPlayerIds = [] } = useQuery({
    queryKey: ['manager-gameweek-picks', managerId, gameweek],
    queryFn: async () => {
      if (!managerId || !gameweek) return []
      const { data, error } = await supabase
        .from('manager_picks')
        .select('player_id')
        .eq('manager_id', managerId)
        .eq('gameweek', gameweek)
      if (error) throw error
      return (data || []).map(r => r.player_id)
    },
    enabled: !!managerId && !!gameweek,
    staleTime: 60 * 1000,
  })
  const ownedPlayerIdSet = useMemo(() => new Set(managerPlayerIds), [managerPlayerIds])

  /** Player IDs that have more than one fixture this gameweek (double/triple gameweek) */
  const dgwPlayerIds = useMemo(() => {
    if (!players?.length) return new Set()
    const count = {}
    players.forEach(p => { count[p.player_id] = (count[p.player_id] || 0) + 1 })
    return new Set(Object.keys(count).filter(id => count[id] > 1).map(Number))
  }, [players])

  const matchups = useMemo(() => {
    return (fixtures || []).map(f => ({
      fixtureId: f.fpl_fixture_id,
      homeTeamId: f.home_team_id,
      awayTeamId: f.away_team_id,
      homeShort: teamsMap[f.home_team_id] ?? null,
      awayShort: teamsMap[f.away_team_id] ?? null,
      started: f.started,
      finished: f.finished,
    }))
  }, [fixtures, teamsMap])

  const suggestions = useMemo(() => {
    if (!players?.length) return []
    const q = searchQuery.trim().toLowerCase()
    if (!q) return []
    const teams = [...new Set(players.map(p => p.team_short_name).filter(Boolean))]
    const names = [...new Set(players.map(p => p.web_name).filter(Boolean))]
    const all = [...teams, ...names]
    return all.filter(s => s && s.toLowerCase().includes(q)).slice(0, 20)
  }, [players, searchQuery])

  const filteredPlayers = useMemo(() => {
    if (!players) return []
    let list = players
    const q = searchQuery.trim().toLowerCase()
    if (q) {
      list = list.filter(p => {
        const matchTeam = p.team_short_name && p.team_short_name.toLowerCase().includes(q)
        const matchName = p.web_name && p.web_name.toLowerCase().includes(q)
        return matchTeam || matchName
      })
    }
    if (scopeFilter === 'owned' && managerId && ownedPlayerIdSet.size > 0) {
      list = list.filter(p => ownedPlayerIdSet.has(p.player_id))
    } else if (scopeFilter === 'not-owned') {
      list = list.filter(p => !ownedPlayerIdSet.has(p.player_id))
    }
    if (matchupFilter === 'live') {
      list = list.filter(p => p.is_live)
    } else if (matchupFilter !== 'all' && typeof matchupFilter === 'number') {
      list = list.filter(p => p.fixture_id === matchupFilter)
    }
    if (positionFilter !== 'all') {
      list = list.filter(p => p.position === positionFilter)
    }
    return list
  }, [players, searchQuery, scopeFilter, positionFilter, matchupFilter, managerId, ownedPlayerIdSet, fixtures])

  useEffect(() => {
    if (isActive && !prevActiveRef.current) {
      setSearchQuery('')
      setShowSuggestions(false)
      setShowFilterPopup(false)
      setShowInfoPopup(false)
      setScopeFilter('owned')
      setPositionFilter('all')
      setMatchupFilter('all')
    }
    prevActiveRef.current = isActive
  }, [isActive])

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target) &&
        inputRef.current && !inputRef.current.contains(e.target)
      ) {
        setShowSuggestions(false)
      }
      if (filterPopupRef.current && !filterPopupRef.current.contains(e.target) && !e.target.closest('.defcon-filter-btn')) {
        setShowFilterPopup(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  if (loading) {
    return (
      <div className="defcon-subpage">
        <div className="defcon-loading">Loading DEFCON data…</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="defcon-subpage">
        <div className="defcon-error">Unable to load DEFCON data.</div>
      </div>
    )
  }

  const hasActiveFilters = scopeFilter !== 'owned' || positionFilter !== 'all' || matchupFilter !== 'all'

  return (
    <div className="defcon-subpage">
      <div className="defcon-subpage-sticky-header">
        <div className="defcon-search-row">
          <div className={`defcon-search-wrap${searchQuery.length > 0 ? ' defcon-search-wrap--has-value' : ''}`} ref={dropdownRef}>
            <input
              ref={inputRef}
              type="text"
              className="defcon-search-input"
              placeholder="Player name or team (e.g. NEW, LIV)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              aria-autocomplete="list"
              aria-expanded={showSuggestions && suggestions.length > 0}
              aria-controls="defcon-search-suggestions"
              id="defcon-search"
            />
            {searchQuery.length > 0 && (
              <button
                type="button"
                className="defcon-search-clear"
                onClick={() => setSearchQuery('')}
                onMouseDown={(e) => e.preventDefault()}
                aria-label="Clear search"
              >
                <X size={14} strokeWidth={2} aria-hidden />
              </button>
            )}
            {showSuggestions && suggestions.length > 0 && (
              <ul
                id="defcon-search-suggestions"
                className="defcon-search-suggestions"
                role="listbox"
              >
                {suggestions.map((s, i) => (
                  <li
                    key={`${s}-${i}`}
                    role="option"
                    className="defcon-search-suggestion"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      setSearchQuery(s)
                      setShowSuggestions(false)
                      inputRef.current?.blur()
                    }}
                  >
                    {s}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="defcon-search-row-actions">
            <button
              type="button"
              className={`defcon-filter-btn ${hasActiveFilters ? 'defcon-filter-btn--active' : ''}`}
              onClick={() => setShowFilterPopup(open => !open)}
              aria-label="Filter DEFCON players"
              aria-expanded={showFilterPopup}
              aria-haspopup="dialog"
            >
              <Filter size={14} strokeWidth={2} />
            </button>
          </div>
        </div>
        {filteredPlayers.length > 0 && (
          <div className="gameweek-list-header" aria-hidden="true">
            <div className="gameweek-list-header__player">Player</div>
            <div className="gameweek-list-header__center">Progress</div>
            <div className="gameweek-list-header__end">DEFCON</div>
          </div>
        )}
      </div>
      {showFilterPopup && typeof document !== 'undefined' && createPortal(
        <div className="stats-filter-overlay" role="dialog" aria-modal="true" aria-label="DEFCON filters">
          <div className="stats-filter-overlay-backdrop" onClick={() => setShowFilterPopup(false)} aria-hidden />
          <div className="stats-filter-overlay-panel" ref={filterPopupRef}>
            <div className="stats-filter-overlay-header">
              <span className="stats-filter-overlay-title">Filters</span>
              <div className="stats-filter-overlay-header-actions">
                {(scopeFilter !== 'owned' || positionFilter !== 'all' || matchupFilter !== 'all') && (
                  <button
                    type="button"
                    className="stats-filter-overlay-reset"
                    onClick={() => {
                      setScopeFilter('owned')
                      setPositionFilter('all')
                      setMatchupFilter('all')
                    }}
                    aria-label="Reset all filters to default"
                  >
                    Reset
                  </button>
                )}
                <button type="button" className="stats-filter-overlay-close" onClick={() => setShowFilterPopup(false)} aria-label="Close filters">
                  <X size={20} strokeWidth={2} />
                </button>
              </div>
            </div>
            <div className="stats-filter-overlay-body">
              <div className="defcon-filter-sections">
                <div className="defcon-filter-section">
                  <div className="defcon-filter-section-title">Ownership</div>
                  <div className="defcon-filter-buttons">
                    <button
                      type="button"
                      className={`defcon-matchup-btn ${scopeFilter === 'all' ? 'defcon-matchup-btn--active' : ''}`}
                      onClick={() => setScopeFilter('all')}
                      aria-pressed={scopeFilter === 'all'}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      className={`defcon-matchup-btn ${scopeFilter === 'owned' ? 'defcon-matchup-btn--active' : ''}`}
                      onClick={() => setScopeFilter('owned')}
                      aria-pressed={scopeFilter === 'owned'}
                    >
                      Owned
                    </button>
                    <button
                      type="button"
                      className={`defcon-matchup-btn ${scopeFilter === 'not-owned' ? 'defcon-matchup-btn--active' : ''}`}
                      onClick={() => setScopeFilter('not-owned')}
                      aria-pressed={scopeFilter === 'not-owned'}
                    >
                      Not owned
                    </button>
                  </div>
                </div>
                <div className="defcon-filter-section">
                  <div className="defcon-filter-section-title">Position</div>
                  <div className="defcon-filter-buttons">
                    <button
                      type="button"
                      className={`defcon-matchup-btn ${positionFilter === 'all' ? 'defcon-matchup-btn--active' : ''}`}
                      onClick={() => setPositionFilter('all')}
                      aria-pressed={positionFilter === 'all'}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      className={`defcon-matchup-btn ${positionFilter === 2 ? 'defcon-matchup-btn--active' : ''}`}
                      onClick={() => setPositionFilter(2)}
                      aria-pressed={positionFilter === 2}
                    >
                      DEF
                    </button>
                    <button
                      type="button"
                      className={`defcon-matchup-btn ${positionFilter === 3 ? 'defcon-matchup-btn--active' : ''}`}
                      onClick={() => setPositionFilter(3)}
                      aria-pressed={positionFilter === 3}
                    >
                      MID
                    </button>
                    <button
                      type="button"
                      className={`defcon-matchup-btn ${positionFilter === 4 ? 'defcon-matchup-btn--active' : ''}`}
                      onClick={() => setPositionFilter(4)}
                      aria-pressed={positionFilter === 4}
                    >
                      FWD
                    </button>
                  </div>
                </div>
                <div className="defcon-filter-section">
                  <div className="defcon-filter-section-title">Matchups</div>
                  <div className="defcon-filter-matchups">
                    <button
                      type="button"
                      className={`defcon-matchup-btn ${matchupFilter === 'all' ? 'defcon-matchup-btn--active' : ''}`}
                      onClick={() => setMatchupFilter('all')}
                      aria-pressed={matchupFilter === 'all'}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      className={`defcon-matchup-btn defcon-matchup-btn--live ${matchupFilter === 'live' ? 'defcon-matchup-btn--active' : ''}`}
                      onClick={() => setMatchupFilter('live')}
                      aria-pressed={matchupFilter === 'live'}
                    >
                      Live
                    </button>
                    {matchups.map((m) => (
                      <button
                        key={m.fixtureId}
                        type="button"
                        className={`defcon-matchup-btn ${matchupFilter === m.fixtureId ? 'defcon-matchup-btn--active' : ''}`}
                        onClick={() => setMatchupFilter(m.fixtureId)}
                        aria-pressed={matchupFilter === m.fixtureId}
                        title={`${m.homeShort ?? ''} vs ${m.awayShort ?? ''}`}
                      >
                        {m.homeShort && <img src={`/badges/${m.homeShort}.svg`} alt="" className="defcon-matchup-badge" />}
                        <span>{m.homeShort ?? '?'}</span>
                        <span className="defcon-matchup-vs">v</span>
                        {m.awayShort && <img src={`/badges/${m.awayShort}.svg`} alt="" className="defcon-matchup-badge" />}
                        <span>{m.awayShort ?? '?'}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="stats-filter-overlay-footer">
              <button type="button" className="stats-filter-overlay-done" onClick={() => setShowFilterPopup(false)} aria-label="Done">
                Done
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      <div className="defcon-list">
        {filteredPlayers.length === 0 ? (
          <p className="defcon-list-empty">No players fit the current criteria.</p>
        ) : (
          filteredPlayers.map((player) => (
            <DefconRow
              key={`${player.player_id}-${player.fixture_id ?? 0}-${barAnimationKey}`}
              player={player}
              opponentShortName={player.opponent_team_id != null ? (teamsMap[player.opponent_team_id] ?? null) : null}
              isDoubleGameweek={dgwPlayerIds.has(player.player_id)}
            />
          ))
        )}
      </div>
    </div>
  )
}
