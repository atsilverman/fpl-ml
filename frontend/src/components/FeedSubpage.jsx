import { useState, useMemo, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { Filter, HelpCircle, X } from 'lucide-react'
import { useFixtures } from '../hooks/useFixtures'
import { useGameweekData } from '../hooks/useGameweekData'
import { useConfiguration } from '../contexts/ConfigurationContext'
import { useLeagueGameweekPicks } from '../hooks/useLeagueGameweekPicks'
import { supabase } from '../lib/supabase'
import './FeedSubpage.css'

const POSITION_LABELS = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' }

const IMPACT_TOOLTIP = 'Your share of this player\'s points vs the league average (100% = in XI, 200% = captain, 300% = triple captain). Positive = you gain more than the league average; negative = the league gains more on average.'

const POPUP_PADDING = 12
const POPUP_MAX_WIDTH = 320
const POPUP_MIN_WIDTH = 260

function eventLabel(event) {
  const { event_type, points_delta, metadata } = event
  const pts = points_delta >= 0 ? `+${points_delta}` : `${points_delta}`
  const ptsSuffix = Math.abs(points_delta) === 1 ? ' pt' : ' pts'
  switch (event_type) {
    case 'goal':
      return { label: 'Goal', delta: `${pts}${ptsSuffix}` }
    case 'assist':
      return { label: 'Assist', delta: `${pts}${ptsSuffix}` }
    case 'own_goal':
      return { label: 'Own goal', delta: `${pts}${ptsSuffix}` }
    case 'penalty_missed':
      return { label: 'Penalty missed', delta: `${pts}${ptsSuffix}` }
    case 'penalty_saved':
      return { label: 'Penalty save', delta: `${pts}${ptsSuffix}` }
    case 'bonus_change':
      if (metadata?.from_bonus != null && metadata?.to_bonus != null) {
        return { label: `Bonus: ${metadata.from_bonus}→${metadata.to_bonus}`, delta: `${pts}${ptsSuffix}` }
      }
      if (points_delta > 0) {
        return { label: `${points_delta} Bonus ${points_delta === 1 ? 'pt' : 'pts'}`, delta: `${pts}${ptsSuffix}` }
      }
      return { label: 'Bonus change', delta: `${pts}${ptsSuffix}` }
    case 'yellow_card':
      return { label: 'Yellow card', delta: `${pts}${ptsSuffix}` }
    case 'red_card':
      return { label: 'Red card', delta: `${pts}${ptsSuffix}` }
    case 'clean_sheet':
      return { label: 'Clean sheet', delta: `${pts}${ptsSuffix}` }
    case 'saves_point':
      return { label: 'Saves', delta: `${pts}${ptsSuffix}` }
    case 'goals_conceded':
      return { label: 'Goals conceded', delta: `${pts}${ptsSuffix}` }
    case 'defcon_achieved':
      return { label: 'DEFCON', delta: `${pts}${ptsSuffix}` }
    case 'defcon_removed':
      return { label: 'DEFCON removed', delta: `${pts}${ptsSuffix}` }
    case 'sixty_plus_minutes':
      return { label: '60+ minutes', delta: `${pts}${ptsSuffix}` }
    default:
      return { label: event_type, delta: `${pts}${ptsSuffix}` }
  }
}

function FeedEventCard({ event, playerName, playerNameLoading, teamShortName, position, impact, isOwned }) {
  const { label, delta } = eventLabel(event)
  const isPositive = event.points_delta > 0
  const isNegative = event.points_delta < 0
  const isReversed = event.metadata?.reversed === true
  const positionLabel = position != null ? (POSITION_LABELS[position] ?? '—') : null

  const impactDisplay = impact != null
    ? (impact > 0 ? `+${impact.toFixed(1)}` : impact === 0 ? '0' : `−${Math.abs(impact).toFixed(1)}`)
    : null
  const impactIsPositive = impact != null && impact > 0
  const impactIsNegative = impact != null && impact < 0

  return (
    <article
      className={`feed-event-card${isReversed ? ' feed-event-card--reversed' : ''}${isOwned ? ' feed-event-card--owned' : ''}${impactIsPositive ? ' feed-event-card--impact-positive' : ''}${impactIsNegative ? ' feed-event-card--impact-negative' : ''}`}
      title={isOwned ? 'Owned by your squad' : undefined}
    >
      <div className="feed-event-card__player">
        {teamShortName && (
          <img
            src={`/badges/${teamShortName}.svg`}
            alt=""
            className="feed-event-card__team-badge"
            onError={(e) => { e.target.style.display = 'none' }}
          />
        )}
        <div className="feed-event-card__player-info">
          {playerNameLoading ? (
            <span className="feed-event-card__player-name feed-event-card__player-name--loading" aria-hidden> </span>
          ) : (
            <span className="feed-event-card__player-name">{playerName ?? `Player ${event.player_id}`}</span>
          )}
          {positionLabel != null && (
            <span className={`feed-event-card__position-badge feed-event-card__position-badge--${position}`}>
              {positionLabel}
            </span>
          )}
        </div>
      </div>
      <div className="feed-event-card__event">
        <span className="feed-event-card__event-label">{label}</span>
        <span
          className={`feed-event-card__event-delta ${
            isPositive ? 'feed-event-card__event-delta--positive' : ''
          } ${isNegative ? 'feed-event-card__event-delta--negative' : ''}`}
        >
          {delta}
        </span>
      </div>
      <div className="feed-event-card__impact" title="League impact: net pts vs league average">
        <span
          className={`feed-event-card__impact-value ${
            impactIsPositive ? 'feed-event-card__impact-value--positive' : ''
          } ${impactIsNegative ? 'feed-event-card__impact-value--negative' : ''}`}
        >
          {impactDisplay ?? '—'}
        </span>
      </div>
    </article>
  )
}

export default function FeedSubpage({ isActive = true }) {
  const { config } = useConfiguration()
  const { gameweek, isCurrent, loading: gwLoading } = useGameweekData()
  const managerId = config?.managerId ?? null
  const leagueId = config?.leagueId ?? null

  const { picks: leaguePicks, managerCount } = useLeagueGameweekPicks(leagueId, gameweek)

  const [searchQuery, setSearchQuery] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [showFilterPopup, setShowFilterPopup] = useState(false)
  const [scopeFilter, setScopeFilter] = useState('all')
  const [positionFilter, setPositionFilter] = useState('all')
  const [matchupFilter, setMatchupFilter] = useState('all')
  const [sortBy, setSortBy] = useState('time')
  const [showImpactPopup, setShowImpactPopup] = useState(false)
  const [popupPlacement, setPopupPlacement] = useState({ top: 0, left: 0, width: POPUP_MAX_WIDTH })
  const prevActiveRef = useRef(false)
  const inputRef = useRef(null)
  const dropdownRef = useRef(null)
  const filterPopupRef = useRef(null)
  const impactPopupRef = useRef(null)
  const impactIconRef = useRef(null)

  const { data: events = [], isLoading: eventsLoading, error: eventsError } = useQuery({
    queryKey: ['gameweek-feed-events', gameweek],
    queryFn: async () => {
      if (!gameweek) return []
      const { data, error } = await supabase
        .from('gameweek_feed_events')
        .select('id, gameweek, player_id, fixture_id, event_type, points_delta, total_points_after, occurred_at, metadata')
        .eq('gameweek', gameweek)
        .order('occurred_at', { ascending: false })
        .order('id', { ascending: false })
      if (error) throw error
      return data ?? []
    },
    enabled: !!gameweek && isCurrent,
    staleTime: 30 * 1000,
  })

  const { fixtures = [] } = useFixtures(gameweek)
  const kickoffByFixtureId = useMemo(() => {
    const map = {}
    fixtures.forEach((f) => {
      const id = f.fpl_fixture_id ?? f.id
      if (id != null && f.kickoff_time) map[id] = new Date(f.kickoff_time).getTime()
    })
    return map
  }, [fixtures])

  const sortedEvents = useMemo(() => {
    const list = [...(events || [])]
    list.sort((a, b) => {
      const kickA = kickoffByFixtureId[a.fixture_id] ?? 0
      const kickB = kickoffByFixtureId[b.fixture_id] ?? 0
      if (kickB !== kickA) return kickB - kickA
      const ta = new Date(a.occurred_at).getTime()
      const tb = new Date(b.occurred_at).getTime()
      if (tb !== ta) return tb - ta
      return (b.id ?? 0) - (a.id ?? 0)
    })
    return list
  }, [events, kickoffByFixtureId])

  const playerIds = useMemo(() => [...new Set((sortedEvents || []).map((e) => e.player_id))], [sortedEvents])

  const { data: playersMap = {}, isLoading: playersLoading } = useQuery({
    queryKey: ['players-feed', playerIds],
    queryFn: async () => {
      if (playerIds.length === 0) return {}
      const { data, error } = await supabase
        .from('players')
        .select('fpl_player_id, web_name, team_id, position')
        .in('fpl_player_id', playerIds)
      if (error) throw error
      const map = {}
      ;(data || []).forEach(p => { map[p.fpl_player_id] = p })
      return map
    },
    enabled: playerIds.length > 0,
    staleTime: 5 * 60 * 1000,
  })

  const teamIds = useMemo(
    () => [...new Set(Object.values(playersMap).map(p => p.team_id).filter(Boolean))],
    [playersMap]
  )
  const fixtureTeamIds = useMemo(
    () => [...new Set((fixtures || []).flatMap(f => [f.home_team_id, f.away_team_id].filter(Boolean)))],
    [fixtures]
  )
  const allTeamIds = useMemo(
    () => [...new Set([...teamIds, ...fixtureTeamIds])],
    [teamIds, fixtureTeamIds]
  )

  const { data: teamsMap = {} } = useQuery({
    queryKey: ['teams-feed', allTeamIds],
    queryFn: async () => {
      if (allTeamIds.length === 0) return {}
      const { data, error } = await supabase
        .from('teams')
        .select('team_id, short_name')
        .in('team_id', allTeamIds)
      if (error) throw error
      const map = {}
      ;(data || []).forEach(t => { map[t.team_id] = t.short_name })
      return map
    },
    enabled: allTeamIds.length > 0,
    staleTime: 5 * 60 * 1000,
  })

  const { data: managerPicksRaw = [] } = useQuery({
    queryKey: ['manager-gameweek-picks', managerId, gameweek],
    queryFn: async () => {
      if (managerId == null || managerId === '' || !gameweek) return []
      const mid = Number(managerId)
      if (Number.isNaN(mid)) return []
      const { data, error } = await supabase
        .from('manager_picks')
        .select('player_id, position, multiplier, is_captain')
        .eq('manager_id', mid)
        .eq('gameweek', gameweek)
      if (error) throw error
      return data || []
    },
    enabled: managerId != null && managerId !== '' && !!gameweek,
    staleTime: 60 * 1000,
  })
  const ownedPlayerIdSet = useMemo(() => {
    const fromDirect = (managerPicksRaw || []).map((r) => Number(r.player_id)).filter((n) => !Number.isNaN(n))
    if (fromDirect.length > 0) return new Set(fromDirect)
    const mid = managerId != null ? Number(managerId) : null
    if (mid == null || Number.isNaN(mid) || !leaguePicks?.length) return new Set()
    const fromLeague = leaguePicks
      .filter((p) => Number(p.manager_id) === mid || p.manager_id === managerId)
      .map((p) => Number(p.player_id))
      .filter((n) => !Number.isNaN(n))
    return new Set(fromLeague)
  }, [managerPicksRaw, leaguePicks, managerId])
  const viewerMultiplierByPlayerId = useMemo(() => {
    const map = {}
    managerPicksRaw.forEach((p) => {
      const pid = p.player_id
      const mult = p.position > 11 ? 0 : (p.multiplier ?? 1) === 1 && p.is_captain ? 2 : (p.multiplier ?? 1)
      map[pid] = mult
      if (pid != null) {
        map[Number(pid)] = mult
        map[String(pid)] = mult
      }
    })
    return map
  }, [managerPicksRaw])

  const impactByEventId = useMemo(() => {
    const out = {}
    if (!leagueId || !gameweek || managerId == null || !managerCount || !sortedEvents?.length) {
      return out
    }
    const mid = Number(managerId)
    for (const event of sortedEvents) {
      const { id, player_id, points_delta } = event
      let ourMult = viewerMultiplierByPlayerId[player_id] ?? viewerMultiplierByPlayerId[Number(player_id)] ?? viewerMultiplierByPlayerId[String(player_id)] ?? 0
      if (ourMult === 0 && leaguePicks.length > 0) {
        const viewerPick = leaguePicks.find(
          (p) => (Number(p.manager_id) === mid || p.manager_id === managerId) && (p.player_id === player_id || Number(p.player_id) === Number(player_id))
        )
        if (viewerPick) ourMult = viewerPick.multiplier ?? 1
      }
      const ourPoints = points_delta * ourMult
      const leaguePicksForPlayer = leaguePicks.filter(
        (p) => p.player_id === player_id || Number(p.player_id) === Number(player_id)
      )
      const leagueSum = leaguePicksForPlayer.reduce((s, p) => s + points_delta * (p.multiplier ?? 1), 0)
      const leagueAvg = leagueSum / managerCount
      const impact = ourPoints - leagueAvg
      out[id] = Math.round(impact * 10) / 10
    }
    return out
  }, [
    leagueId,
    gameweek,
    managerId,
    leaguePicks,
    managerCount,
    sortedEvents,
    viewerMultiplierByPlayerId
  ])

  const matchups = useMemo(() => {
    return (fixtures || []).map(f => ({
      fixtureId: f.fpl_fixture_id ?? f.id,
      homeTeamId: f.home_team_id,
      awayTeamId: f.away_team_id,
      homeShort: teamsMap[f.home_team_id] ?? null,
      awayShort: teamsMap[f.away_team_id] ?? null,
    }))
  }, [fixtures, teamsMap])

  const filterSummaryText = useMemo(() => {
    const scopeLabel = scopeFilter === 'all' ? 'All' : scopeFilter === 'owned' ? 'Owned' : 'Not owned'
    const positionLabel = positionFilter === 'all' ? 'All positions' : (positionFilter === 2 ? 'DEF' : positionFilter === 3 ? 'MID' : 'FWD')
    let matchupLabel = 'All matchups'
    if (matchupFilter !== 'all') {
      const fid = Number(matchupFilter)
      const m = matchups.find(mu => Number(mu.fixtureId) === fid)
      if (m) matchupLabel = `${m.homeShort ?? '?'} v ${m.awayShort ?? '?'}`
    }
    const sortLabel = sortBy === 'time' ? 'Time (newest)' : sortBy === 'impact_positive' ? 'Impact (+)' : 'Impact (−)'
    return `${scopeLabel} · ${positionLabel} · ${matchupLabel} · ${sortLabel}`
  }, [scopeFilter, positionFilter, matchupFilter, matchups, sortBy])

  const suggestions = useMemo(() => {
    const events = sortedEvents || []
    if (!events.length) return []
    const q = searchQuery.trim().toLowerCase()
    if (!q) return []
    const teams = new Set()
    const names = new Set()
    events.forEach((e) => {
      const p = playersMap[e.player_id]
      if (p?.web_name) names.add(p.web_name)
      if (p?.team_id != null && teamsMap[p.team_id]) teams.add(teamsMap[p.team_id])
    })
    const all = [...teams, ...names]
    return all.filter(s => s && s.toLowerCase().includes(q)).slice(0, 20)
  }, [sortedEvents, playersMap, teamsMap, searchQuery])

  const filteredEvents = useMemo(() => {
    let list = sortedEvents || []
    const q = searchQuery.trim().toLowerCase()
    if (q) {
      list = list.filter(e => {
        const p = playersMap[e.player_id]
        const teamShort = p?.team_id != null ? teamsMap[p.team_id] : null
        const matchTeam = teamShort && teamShort.toLowerCase().includes(q)
        const matchName = p?.web_name && p.web_name.toLowerCase().includes(q)
        return matchTeam || matchName
      })
    }
    if (scopeFilter === 'owned') {
      list = list.filter(e => ownedPlayerIdSet.has(Number(e.player_id)))
    } else if (scopeFilter === 'not-owned') {
      list = list.filter(e => !ownedPlayerIdSet.has(Number(e.player_id)))
    }
    if (positionFilter !== 'all') {
      const posNum = Number(positionFilter)
      list = list.filter(e => {
        const p = playersMap[e.player_id]
        return p && Number(p.position) === posNum
      })
    }
    if (matchupFilter !== 'all') {
      const fixtureNum = Number(matchupFilter)
      list = list.filter(e => Number(e.fixture_id) === fixtureNum)
    }
    return list
  }, [sortedEvents, searchQuery, scopeFilter, positionFilter, matchupFilter, managerId, ownedPlayerIdSet, playersMap, teamsMap])

  const sortedFilteredEvents = useMemo(() => {
    const list = filteredEvents || []
    if (sortBy === 'impact_positive') {
      return [...list].sort((a, b) => {
        const impactA = impactByEventId[a.id] ?? -Infinity
        const impactB = impactByEventId[b.id] ?? -Infinity
        return impactB - impactA
      })
    }
    if (sortBy === 'impact_negative') {
      return [...list].sort((a, b) => {
        const impactA = impactByEventId[a.id] ?? Infinity
        const impactB = impactByEventId[b.id] ?? Infinity
        return impactA - impactB
      })
    }
    return list
  }, [filteredEvents, sortBy, impactByEventId])

  useEffect(() => {
    if (isActive && !prevActiveRef.current) {
      setSearchQuery('')
      setShowSuggestions(false)
      setShowFilterPopup(false)
      setScopeFilter('all')
      setPositionFilter('all')
      setMatchupFilter('all')
      setSortBy('time')
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
      if (filterPopupRef.current && !filterPopupRef.current.contains(e.target) && !e.target.closest('.feed-filter-btn')) {
        setShowFilterPopup(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const updateImpactPopupPlacement = () => {
    if (!impactIconRef.current) return
    const rect = impactIconRef.current.getBoundingClientRect()
    const viewportW = window.innerWidth
    const viewportH = window.innerHeight
    const width = Math.min(POPUP_MAX_WIDTH, Math.max(POPUP_MIN_WIDTH, viewportW - POPUP_PADDING * 2))
    const gap = 6
    const estimatedPopupH = 120
    const spaceBelow = viewportH - rect.bottom - gap
    const spaceAbove = rect.top - gap
    const preferBelow = spaceBelow >= estimatedPopupH || spaceBelow >= spaceAbove
    const top = preferBelow ? rect.bottom + gap : rect.top - gap - estimatedPopupH
    let left = rect.left + rect.width / 2 - width / 2
    if (left < POPUP_PADDING) left = POPUP_PADDING
    if (left + width > viewportW - POPUP_PADDING) left = viewportW - width - POPUP_PADDING
    setPopupPlacement({ top, left, width })
  }

  useEffect(() => {
    if (!showImpactPopup) return
    const handleClickOutside = (e) => {
      if (
        impactPopupRef.current && !impactPopupRef.current.contains(e.target) &&
        impactIconRef.current && !impactIconRef.current.contains(e.target)
      ) {
        setShowImpactPopup(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showImpactPopup])

  useLayoutEffect(() => {
    if (!showImpactPopup || !impactIconRef.current) return
    updateImpactPopupPlacement()
    const onScrollOrResize = () => updateImpactPopupPlacement()
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [showImpactPopup])

  const loading = gwLoading || eventsLoading || (playerIds.length > 0 && playersLoading)
  if (loading) {
    return <div className="feed-subpage" />
  }

  if (eventsError) {
    return (
      <div className="feed-subpage">
        <div className="feed-subpage-empty">Unable to load feed.</div>
      </div>
    )
  }

  if (!gameweek) {
    return (
      <div className="feed-subpage">
        <div className="feed-subpage-empty">No gameweek selected.</div>
      </div>
    )
  }

  if (!isCurrent) {
    return (
      <div className="feed-subpage">
        <div className="feed-subpage-empty">Feed shows events for the current gameweek only.</div>
      </div>
    )
  }

  const hasActiveFilters = scopeFilter !== 'all' || positionFilter !== 'all' || matchupFilter !== 'all' || sortBy !== 'time'

  return (
    <div className="feed-subpage">
      {sortedEvents.length > 0 && (
        <>
          <div className="feed-subpage-sticky-header">
            <div className="feed-search-row">
              <div className={`feed-search-wrap${searchQuery.length > 0 ? ' feed-search-wrap--has-value' : ''}`} ref={dropdownRef}>
                <input
                ref={inputRef}
                type="text"
                className="feed-search-input"
                placeholder="Player name or team (e.g. NEW, LIV)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                aria-autocomplete="list"
                aria-expanded={showSuggestions && suggestions.length > 0}
                aria-controls="feed-search-suggestions"
                id="feed-search"
                />
                {searchQuery.length > 0 && (
                  <button
                    type="button"
                    className="feed-search-clear"
                    onClick={() => setSearchQuery('')}
                    onMouseDown={(e) => e.preventDefault()}
                    aria-label="Clear search"
                  >
                    <X size={14} strokeWidth={2} aria-hidden />
                  </button>
                )}
                {showSuggestions && suggestions.length > 0 && (
                  <ul
                    id="feed-search-suggestions"
                    className="feed-search-suggestions"
                    role="listbox"
                  >
                    {suggestions.map((s, i) => (
                      <li
                        key={`${s}-${i}`}
                        role="option"
                        className="feed-search-suggestion"
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
              <div className="feed-search-row-actions">
                <button
                  type="button"
                  className={`feed-filter-btn ${hasActiveFilters ? 'feed-filter-btn--active' : ''}`}
                  onClick={() => setShowFilterPopup(open => !open)}
                  aria-label="Filter feed events"
                  aria-expanded={showFilterPopup}
                  aria-haspopup="dialog"
                >
                  <Filter size={14} strokeWidth={2} />
                </button>
              </div>
            </div>
            <p className="feed-filter-summary" aria-live="polite">
              <span className="feed-filter-summary-viewing">Viewing:</span> {filterSummaryText}
            </p>
            {sortedFilteredEvents.length > 0 && (
              <div className="gameweek-list-header" aria-hidden="true">
                <div className="gameweek-list-header__player">Player</div>
                <div className="gameweek-list-header__center">Event</div>
                <div className="gameweek-list-header__end gameweek-list-header__end--with-popup">
                  <span className="gameweek-list-header__end-label">Impact</span>
                  <button
                    type="button"
                    ref={impactIconRef}
                    className="feed-impact-icon-wrap"
                    onClick={(e) => {
                      e.preventDefault()
                      const next = !showImpactPopup
                      if (next) updateImpactPopupPlacement()
                      setShowImpactPopup(next)
                    }}
                    title="What is Impact?"
                    aria-expanded={showImpactPopup}
                    aria-haspopup="dialog"
                  >
                    <HelpCircle size={12} className="feed-impact-icon" aria-hidden />
                  </button>
                  {showImpactPopup &&
                    createPortal(
                      <div
                        ref={impactPopupRef}
                        className="feed-impact-popup feed-impact-popup--portal"
                        role="dialog"
                        aria-label="Impact explained"
                        style={{
                          position: 'fixed',
                          top: popupPlacement.top,
                          left: popupPlacement.left,
                          width: popupPlacement.width
                        }}
                      >
                        <div className="feed-impact-popup__title">Impact</div>
                        <p className="feed-impact-popup__text">{IMPACT_TOOLTIP}</p>
                      </div>,
                      document.body
                    )}
                </div>
              </div>
            )}
          </div>
          {showFilterPopup && typeof document !== 'undefined' && createPortal(
            <div className="stats-filter-overlay" role="dialog" aria-modal="true" aria-label="Feed filters">
              <div className="stats-filter-overlay-backdrop" onClick={() => setShowFilterPopup(false)} aria-hidden />
              <div className="stats-filter-overlay-panel" ref={filterPopupRef}>
                <div className="stats-filter-overlay-header">
                  <span className="stats-filter-overlay-title">Filters</span>
                  <div className="stats-filter-overlay-header-actions">
                    <button type="button" className="stats-filter-overlay-close" onClick={() => setShowFilterPopup(false)} aria-label="Close filters">
                      <X size={20} strokeWidth={2} />
                    </button>
                  </div>
                </div>
                <div className="stats-filter-overlay-body">
                  <div className="feed-filter-sections">
                    <div className="feed-filter-section">
                      <div className="feed-filter-section-title">Ownership</div>
                      <div className="feed-filter-buttons">
                        <button
                          type="button"
                          className={`feed-matchup-btn ${scopeFilter === 'all' ? 'feed-matchup-btn--active' : ''}`}
                          onClick={() => setScopeFilter('all')}
                          aria-pressed={scopeFilter === 'all'}
                        >
                          All
                        </button>
                        <button
                          type="button"
                          className={`feed-matchup-btn ${scopeFilter === 'owned' ? 'feed-matchup-btn--active' : ''}`}
                          onClick={() => setScopeFilter('owned')}
                          aria-pressed={scopeFilter === 'owned'}
                        >
                          Owned
                        </button>
                        <button
                          type="button"
                          className={`feed-matchup-btn ${scopeFilter === 'not-owned' ? 'feed-matchup-btn--active' : ''}`}
                          onClick={() => setScopeFilter('not-owned')}
                          aria-pressed={scopeFilter === 'not-owned'}
                        >
                          Not owned
                        </button>
                      </div>
                    </div>
                    <div className="feed-filter-section">
                      <div className="feed-filter-section-title">Sort</div>
                      <div className="feed-filter-buttons">
                        <button
                          type="button"
                          className={`feed-matchup-btn ${sortBy === 'time' ? 'feed-matchup-btn--active' : ''}`}
                          onClick={() => setSortBy('time')}
                          aria-pressed={sortBy === 'time'}
                        >
                          Time (newest)
                        </button>
                        <button
                          type="button"
                          className={`feed-matchup-btn ${sortBy === 'impact_positive' ? 'feed-matchup-btn--active' : ''}`}
                          onClick={() => setSortBy('impact_positive')}
                          aria-pressed={sortBy === 'impact_positive'}
                        >
                          Impact (+)
                        </button>
                        <button
                          type="button"
                          className={`feed-matchup-btn ${sortBy === 'impact_negative' ? 'feed-matchup-btn--active' : ''}`}
                          onClick={() => setSortBy('impact_negative')}
                          aria-pressed={sortBy === 'impact_negative'}
                        >
                          Impact (−)
                        </button>
                      </div>
                    </div>
                    <div className="feed-filter-section">
                      <div className="feed-filter-section-title">Position</div>
                      <div className="feed-filter-buttons">
                        <button
                          type="button"
                          className={`feed-matchup-btn ${positionFilter === 'all' ? 'feed-matchup-btn--active' : ''}`}
                          onClick={() => setPositionFilter('all')}
                          aria-pressed={positionFilter === 'all'}
                        >
                          All
                        </button>
                        <button
                          type="button"
                          className={`feed-matchup-btn ${positionFilter === 2 ? 'feed-matchup-btn--active' : ''}`}
                          onClick={() => setPositionFilter(positionFilter === 2 ? 'all' : 2)}
                          aria-pressed={positionFilter === 2}
                        >
                          DEF
                        </button>
                        <button
                          type="button"
                          className={`feed-matchup-btn ${positionFilter === 3 ? 'feed-matchup-btn--active' : ''}`}
                          onClick={() => setPositionFilter(positionFilter === 3 ? 'all' : 3)}
                          aria-pressed={positionFilter === 3}
                        >
                          MID
                        </button>
                        <button
                          type="button"
                          className={`feed-matchup-btn ${positionFilter === 4 ? 'feed-matchup-btn--active' : ''}`}
                          onClick={() => setPositionFilter(positionFilter === 4 ? 'all' : 4)}
                          aria-pressed={positionFilter === 4}
                        >
                          FWD
                        </button>
                      </div>
                    </div>
                    <div className="feed-filter-section">
                      <div className="feed-filter-section-title">Matchups</div>
                      <div className="feed-filter-matchups">
                        <button
                          type="button"
                          className={`feed-matchup-btn ${matchupFilter === 'all' ? 'feed-matchup-btn--active' : ''}`}
                          onClick={() => setMatchupFilter('all')}
                          aria-pressed={matchupFilter === 'all'}
                        >
                          All
                        </button>
                        {matchups.map((m) => (
                          <button
                            key={m.fixtureId}
                            type="button"
                            className={`feed-matchup-btn ${Number(matchupFilter) === Number(m.fixtureId) ? 'feed-matchup-btn--active' : ''}`}
                            onClick={() => setMatchupFilter(Number(matchupFilter) === Number(m.fixtureId) ? 'all' : m.fixtureId)}
                            title={`${m.homeShort ?? ''} vs ${m.awayShort ?? ''}`}
                            aria-pressed={Number(matchupFilter) === Number(m.fixtureId)}
                          >
                            {m.homeShort && <img src={`/badges/${m.homeShort}.svg`} alt="" className="feed-matchup-badge" />}
                            <span>{m.homeShort ?? '?'}</span>
                            <span className="feed-matchup-vs">v</span>
                            {m.awayShort && <img src={`/badges/${m.awayShort}.svg`} alt="" className="feed-matchup-badge" />}
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
        </>
      )}
      {sortedEvents.length === 0 ? (
        <div className="feed-subpage-empty">No events yet. Events appear during live gameweeks.</div>
      ) : sortedFilteredEvents.length === 0 ? (
        <div className="feed-subpage-empty">
          {scopeFilter === 'owned' && ownedPlayerIdSet.size === 0 && (managerId != null && managerId !== '')
            ? 'No owned events. Configure your league and make sure your squad is saved for this gameweek to see owned players.'
            : 'No events match the current filters.'}
        </div>
      ) : (
        <>
          <div className="feed-event-list" role="list" key={isActive ? 'active' : 'inactive'}>
          {sortedFilteredEvents.map((event, index) => {
            const player = playersMap[event.player_id]
            const teamShortName = player?.team_id != null ? teamsMap[player.team_id] : null
            const playerName = player?.web_name ?? null
            const position = player?.position ?? null
            const playerNameLoading = playersLoading && playerName == null
            return (
              <div
                key={event.id}
                className="feed-event-card-animate"
                style={{ animationDelay: `${index * 28}ms` }}
                role="listitem"
              >
                <FeedEventCard
                  event={event}
                  playerName={playerName}
                  playerNameLoading={playerNameLoading}
                  teamShortName={teamShortName}
                  position={position}
                  impact={impactByEventId[event.id]}
                  isOwned={ownedPlayerIdSet.has(Number(event.player_id))}
                />
              </div>
            )
          })}
          </div>
        </>
      )}
    </div>
  )
}
