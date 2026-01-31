import { useState, useMemo, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CircleCheck, Filter, Info } from 'lucide-react'
import { useDefconGameweekPlayers } from '../hooks/useDefconGameweekPlayers'
import { useFixtures } from '../hooks/useFixtures'
import { useGameweekData } from '../hooks/useGameweekData'
import { useConfiguration } from '../contexts/ConfigurationContext'
import { supabase } from '../lib/supabase'
import './DefconSubpage.css'

const POSITION_LABELS = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' }

function DefconRow({ player }) {
  const { web_name, team_short_name, defcon, threshold, position, match_complete, match_provisional, is_live } = player
  const isGk = threshold >= 999
  const denomDisplay = isGk ? '—' : threshold
  const numDisplay = isGk ? 0 : (defcon ?? 0)
  const notches = isGk ? 0 : threshold
  const filledNotches = isGk ? 0 : Math.min(defcon, threshold)
  const percent = isGk ? 0 : Math.min(100, Math.round((defcon / threshold) * 100))
  const positionLabel = POSITION_LABELS[position] ?? '—'
  const fractionTitle = isGk ? 'Goalkeepers cannot earn DEFCON (no threshold)' : undefined
  const defconAchieved = !isGk && defcon >= threshold

  return (
    <div className={`defcon-row-card${defconAchieved ? ' defcon-row-card--achieved' : ''}`}>
      <div className="defcon-row">
      {(match_complete || is_live) && (
        <span className="defcon-row-status" aria-hidden>
          {match_complete ? (
            <span
              className={`defcon-status-complete ${match_provisional ? 'defcon-status-complete--provisional' : ''}`}
              title={match_provisional ? 'Match complete (provisional)' : 'Match complete'}
            >
              <CircleCheck size={14} strokeWidth={2} />
            </span>
          ) : (
            <span className="defcon-status-live-dot" title="Live" aria-label="Live" />
          )}
        </span>
      )}
      {team_short_name && (
        <img
          src={`/badges/${team_short_name}.svg`}
          alt=""
          className="defcon-badge"
        />
      )}
      <div className="defcon-player-info">
        <span className="defcon-name">{web_name}</span>
        <span className={`defcon-position-badge defcon-position-badge--${position}`}>
          {positionLabel}
        </span>
      </div>
      <span className="defcon-fraction" title={fractionTitle}>
        <span className="defcon-num">{numDisplay}</span>
        <span className="defcon-sep">/</span>
        <span className="defcon-denom">{denomDisplay}</span>
      </span>
      {notches > 0 && (
        <div
          className="defcon-notch-bar"
          style={{ '--notches': notches }}
          role="progressbar"
          aria-valuenow={defcon}
          aria-valuemin={0}
          aria-valuemax={threshold}
          aria-label={`DEFCON ${defcon} of ${threshold}`}
        >
          <div
            className="defcon-notch-fill"
            style={{ width: `${notches ? (filledNotches / notches) * 100 : 0}%` }}
          />
          <div className="defcon-notch-dividers" aria-hidden />
        </div>
      )}
      {notches > 0 && (
        <span className="defcon-percent-value" aria-label={`${percent}% to threshold`}>
          {percent}%
        </span>
      )}
      </div>
    </div>
  )
}

export default function DefconSubpage() {
  const { config } = useConfiguration()
  const { gameweek } = useGameweekData()
  const { players, loading, error } = useDefconGameweekPlayers()
  const { fixtures } = useFixtures(gameweek)
  const managerId = config?.managerId ?? null

  const [searchQuery, setSearchQuery] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [showFilterPopup, setShowFilterPopup] = useState(false)
  const [showInfoPopup, setShowInfoPopup] = useState(false)
  /** One of: 'all' | 'owned' | 'live' | number (fixture id). Only one filter active at a time. */
  const [filterSelection, setFilterSelection] = useState('owned')
  const inputRef = useRef(null)
  const dropdownRef = useRef(null)
  const filterPopupRef = useRef(null)
  const infoPopupRef = useRef(null)

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
    if (filterSelection === 'owned' && managerId && ownedPlayerIdSet.size > 0) {
      list = list.filter(p => ownedPlayerIdSet.has(p.player_id))
    } else if (filterSelection === 'live') {
      list = list.filter(p => p.is_live)
    } else if (typeof filterSelection === 'number') {
      const fixture = fixtures?.find(f => f.fpl_fixture_id === filterSelection)
      if (fixture) {
        const teamIds = new Set([fixture.home_team_id, fixture.away_team_id])
        list = list.filter(p => p.team_id != null && teamIds.has(p.team_id))
      }
    }
    return list
  }, [players, searchQuery, filterSelection, managerId, ownedPlayerIdSet, fixtures])

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
      if (infoPopupRef.current && !infoPopupRef.current.contains(e.target) && !e.target.closest('.defcon-info-btn')) {
        setShowInfoPopup(false)
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

  const hasActiveFilters = filterSelection !== 'all'

  const showBackdrop = showInfoPopup || showFilterPopup

  return (
    <div className="defcon-subpage">
      {showBackdrop && (
        <div
          className="defcon-popup-backdrop"
          aria-hidden
          onClick={() => {
            setShowInfoPopup(false)
            setShowFilterPopup(false)
          }}
        />
      )}
      <div className="defcon-search-row">
        <div className="defcon-search-wrap" ref={dropdownRef}>
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
          className="defcon-info-btn"
          onClick={() => setShowInfoPopup(open => !open)}
          aria-label="Status indicators explained"
          aria-expanded={showInfoPopup}
          aria-haspopup="dialog"
        >
          <Info size={14} strokeWidth={2} />
        </button>
        {showInfoPopup && (
          <div className="gw-legend-popup" ref={infoPopupRef} role="dialog" aria-label="Status indicators">
            <div className="gw-legend-popup-title">Legend</div>
            <div className="gw-legend-popup-row">
              <span className="gw-legend-popup-row-icon">
                <span className="defcon-status-complete" aria-hidden><CircleCheck size={14} strokeWidth={2} /></span>
              </span>
              <span className="gw-legend-popup-text">Match finished (confirmed)</span>
            </div>
            <div className="gw-legend-popup-row">
              <span className="gw-legend-popup-row-icon">
                <span className="defcon-status-complete defcon-status-complete--provisional" aria-hidden><CircleCheck size={14} strokeWidth={2} /></span>
              </span>
              <span className="gw-legend-popup-text">Match finished (provisional, stats may update)</span>
            </div>
            <div className="gw-legend-popup-row">
              <span className="gw-legend-popup-live-dot-wrap">
                <span className="gw-legend-popup-live-dot" aria-hidden />
              </span>
              <span className="gw-legend-popup-text">Match in progress (live)</span>
            </div>
            <div className="gw-legend-popup-row">
              <span className="gw-legend-popup-row-icon">
                <span className="gw-legend-popup-defcon-achieved-sample" aria-hidden />
              </span>
              <span className="gw-legend-popup-text">DEFCON achieved</span>
            </div>
          </div>
        )}
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
      {showFilterPopup && (
        <div className="defcon-filter-popup" ref={filterPopupRef} role="dialog" aria-label="DEFCON filters">
          <div className="defcon-filter-matchups">
            <button
              type="button"
              className={`defcon-matchup-btn ${filterSelection === 'all' ? 'defcon-matchup-btn--active' : ''}`}
              onClick={() => setFilterSelection('all')}
            >
              All
            </button>
            <button
              type="button"
              className={`defcon-matchup-btn ${filterSelection === 'owned' ? 'defcon-matchup-btn--active' : ''}`}
              onClick={() => setFilterSelection('owned')}
            >
              Owned
            </button>
            <button
              type="button"
              className={`defcon-matchup-btn ${filterSelection === 'live' ? 'defcon-matchup-btn--active' : ''}`}
              onClick={() => setFilterSelection('live')}
            >
              Live
            </button>
            {matchups.map((m) => (
              <button
                key={m.fixtureId}
                type="button"
                className={`defcon-matchup-btn ${filterSelection === m.fixtureId ? 'defcon-matchup-btn--active' : ''}`}
                onClick={() => setFilterSelection(filterSelection === m.fixtureId ? 'all' : m.fixtureId)}
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
      )}
      <div className="defcon-list">
        {filteredPlayers.map(player => (
          <DefconRow key={player.player_id} player={player} />
        ))}
      </div>
    </div>
  )
}
