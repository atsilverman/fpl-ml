import { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import './GameweekPointsView.css'
import { formatNumber } from '../utils/formatNumbers'
import { ArrowDownRight, ArrowUpRight, HelpCircle, ArrowDown, ArrowUp } from 'lucide-react'
import { useGameweekDebugData } from '../hooks/useGameweekDebugData'
import { useAxisLockedScroll } from '../hooks/useAxisLockedScroll'

const IMPACT_TOOLTIP = 'Your share of this player\'s points vs the top third of your configured league (100% = in XI, 200% = captain, 300% = triple captain). Positive = you gain more than the top third; negative = the top third gains more.'

const PLAYER_NAME_MAX_LENGTH = 15

const POPUP_PADDING = 12
const POPUP_MAX_WIDTH = 320
const POPUP_MIN_WIDTH = 260

export default function GameweekPointsView({ data = [], loading = false, topScorerPlayerIds = null, top10ByStat = null, isLiveUpdating = false, impactByPlayerId = {}, ownedByYouPlayerIds = null, fixtures: fixturesProp = [], onPlayerRowClick = null }) {
  const { fixtures: debugFixtures = [] } = useGameweekDebugData()
  const fixtures = (fixturesProp != null && fixturesProp.length > 0) ? fixturesProp : debugFixtures
  // Support lookup by number or string (Supabase/API can return either) so we always resolve fixture and use fixture table state
  const fixturesById = useMemo(() => {
    const map = {}
    for (const f of fixtures || []) {
      const id = f.fpl_fixture_id
      if (id == null) continue
      map[id] = f
      map[Number(id)] = f
      map[String(id)] = f
    }
    return map
  }, [fixtures])
  const [showImpactPopup, setShowImpactPopup] = useState(false)
  const [popupPlacement, setPopupPlacement] = useState({ top: 0, left: 0, width: POPUP_MAX_WIDTH })
  const impactPopupRef = useRef(null)
  const impactIconRef = useRef(null)
  const [sortColumn, setSortColumn] = useState(null)
  const [sortDirection, setSortDirection] = useState('desc')
  const scrollableRef = useRef(null)
  useAxisLockedScroll(scrollableRef, { mobileOnly: true })

  const updatePopupPlacement = () => {
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
    updatePopupPlacement()
    const onScrollOrResize = () => updatePopupPlacement()
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [showImpactPopup])

  const getSortValue = (player, key) => {
    const pid = player.effective_player_id ?? player.player_id
    switch (key) {
      case 'player': return (player.player_name || '').toLowerCase()
      case 'minutes': return player.minutes ?? -1
      case 'opp': return (player.opponent_team_short_name || '').toLowerCase()
      case 'points': return player.contributedPoints ?? player.points ?? 0
      case 'impact': return (typeof impactByPlayerId[pid] === 'number' ? impactByPlayerId[pid] : -Infinity)
      case 'goals_scored': return player.goals_scored ?? 0
      case 'assists': return player.assists ?? 0
      case 'clean_sheets': return player.clean_sheets ?? 0
      case 'saves': return player.saves ?? 0
      case 'bps': return player.bps ?? 0
      case 'bonus': return player.bonus ?? 0
      case 'defensive_contribution': return player.defensive_contribution ?? 0
      case 'yellow_cards': return player.yellow_cards ?? 0
      case 'red_cards': return player.red_cards ?? 0
      case 'expected_goals': return Number(player.expected_goals) || 0
      case 'expected_assists': return Number(player.expected_assists) || 0
      case 'expected_goal_involvements': return Number(player.expected_goal_involvements) || 0
      case 'expected_goals_conceded': return Number(player.expected_goals_conceded) || 0
      default: return 0
    }
  }

  const sortedData = useMemo(() => {
    if (!data || data.length === 0 || !sortColumn) return data ?? []
    const starters = data.filter((p) => p.position <= 11)
    const bench = data.filter((p) => p.position >= 12)
    const cmp = (a, b) => {
      const va = getSortValue(a, sortColumn)
      const vb = getSortValue(b, sortColumn)
      const isNum = typeof va === 'number' && typeof vb === 'number'
      let c = 0
      if (isNum) c = va - vb
      else c = String(va).localeCompare(String(vb))
      return sortDirection === 'desc' ? -c : c
    }
    starters.sort(cmp)
    bench.sort(cmp)
    return [...starters, ...bench]
  }, [data, sortColumn, sortDirection, impactByPlayerId])

  const handleSort = (key) => {
    if (sortColumn === key) {
      setSortDirection((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortColumn(key)
      setSortDirection('desc')
    }
  }

  // Per-column top 10: use top10ByStat when provided, else fall back to topScorerPlayerIds for PTS only
  const top10Pts = top10ByStat?.pts ?? (topScorerPlayerIds != null ? topScorerPlayerIds : new Set())

  if (loading) {
    return (
      <div className="gameweek-points-view">
        <div className="gameweek-points-loading">
          <div className="skeleton-text"></div>
        </div>
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <div className="gameweek-points-view">
        <div className="gameweek-points-empty">
          <div style={{ color: 'var(--text-secondary)', fontSize: '10px' }}>
            No player data available
          </div>
        </div>
      </div>
    )
  }

  const formatMinutes = (minutes) => (minutes != null && minutes > 0 ? `${minutes}'` : 'DNP')

  /** Format kickoff for MP/OPP placeholder: { day: 'SAT', time: '15:00' } in device local TZ; null if invalid */
  const formatKickoffShort = (isoString) => {
    if (!isoString) return null
    try {
      const d = new Date(isoString)
      if (Number.isNaN(d.getTime())) return null
      // Use undefined = device locale/timezone for user's local time
      const day = d.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase().slice(0, 3)
      const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: false })
      return { day, time }
    } catch {
      return null
    }
  }

  const IMPACT_BAR_MAX = 100

  const PlayerTableRow = ({ player, isFirstBenchRow: isFirstBenchRowProp, onRowClick }) => {
    const isDgwSecondRow = Boolean(player.isDgwRow && player.dgwRowIndex === 1)
    const captainLabel = !isDgwSecondRow && player.is_captain
      ? (player.multiplier === 3 ? 'TC' : 'C')
      : null
    const assistantLabel = !isDgwSecondRow && player.is_vice_captain ? 'A' : null
    /* Divider line: first bench row in display order (parent passes this so it stays correct when sorted) */
    const isFirstBenchRow = isFirstBenchRowProp === true
    const isBench = player.position >= 12
    const playerId = player.effective_player_id ?? player.player_id
    const isOwnedByYou = ownedByYouPlayerIds != null && playerId != null && ownedByYouPlayerIds.has(Number(playerId))
    const impact = impactByPlayerId[playerId]
    const hasImpact = typeof impact === 'number'
    const impactWidth = hasImpact ? Math.min(IMPACT_BAR_MAX, Math.abs(impact)) / IMPACT_BAR_MAX : 0
    const isTop10Pts = playerId != null && top10Pts.has(Number(playerId))
    const isDefconAchieved = Boolean(player.defcon_points_achieved)
    const isAutosubOut = Boolean(player.was_auto_subbed_out)
    const isAutosubIn = Boolean(player.was_auto_subbed_in)
    const fid = player.fixture_id != null && player.fixture_id !== 0 ? player.fixture_id : null
    const fixtureForPlayer = fixturesById && fid != null
      ? (fixturesById[fid] ?? fixturesById[Number(fid)] ?? fixturesById[String(fid)])
      : null
    const scheduleFixtureByTeam = !fixtureForPlayer && player.player_team_id && fixtures?.length
      ? fixtures.find(f => f.home_team_id === player.player_team_id || f.away_team_id === player.player_team_id)
      : null
    const effectiveKickoffTime = player.kickoff_time || fixtureForPlayer?.kickoff_time || scheduleFixtureByTeam?.kickoff_time || null
    const fixtureForMatchState = fixtureForPlayer ?? scheduleFixtureByTeam
    // Prefer fixture table state (same source as debug panel) so provisional/live/finished matches backend
    const matchStarted = fixtureForMatchState ? Boolean(fixtureForMatchState.started) : Boolean(player.match_started)
    const matchFinished = fixtureForMatchState ? Boolean(fixtureForMatchState.finished) : Boolean(player.match_finished)
    const matchFinishedProvisional = fixtureForMatchState ? Boolean(fixtureForMatchState.finished_provisional) : Boolean(player.match_finished_provisional)
    // Match "in the past" for mins column: started or finished (so DNP shows ! not kickoff for 0 mins when match is done)
    const matchStartedOrFinished = matchStarted || matchFinished || matchFinishedProvisional
    const isMatchLive = matchStarted && !matchFinished && !matchFinishedProvisional
    const isMatchProvisional = matchFinishedProvisional && !matchFinished
    const isBonusPending = isMatchProvisional && player.bonus_status === 'provisional'
    // Only show status dot when match is not finished; never show live/provisional dot for finished matches
    const showMinsLiveDot = (player.minutes != null && player.minutes > 0) && !matchFinished && (isMatchLive || isMatchProvisional)
    // Don't show provisional dot when this player's bonus is already confirmed (e.g. from catch-up refresh)
    const minsDotProvisional = isMatchProvisional && !isMatchLive && player.bonus_status !== 'confirmed'
    const ptsDisplay = player.contributedPoints ?? player.points

    const isGk = player.position === 1
    const expectedStatKeys = ['expected_goals', 'expected_assists', 'expected_goal_involvements', 'expected_goals_conceded']
    const formatExpected = (v) => {
      const n = Number(v)
      if (n === 0) return '0'
      return n.toFixed(2)
    }
    const renderStatCell = (value, statKey, opts = {}) => {
      const numVal = Number(value) || 0
      const isZero = numVal === 0
      const isTop10ForColumn = playerId != null && top10ByStat?.[statKey]?.has(Number(playerId))
      const isDefColumn = statKey === 'defensive_contribution'
      const isSavesColumn = statKey === 'saves'
      const isProvisionalBonus = opts.isProvisionalBonus ?? false
      const showDefconBadge = isDefColumn && !isZero && isDefconAchieved
      const showSavesBadge = isSavesColumn && isGk && !isZero && value >= 3
      const statShowsTop10 = statKey === 'bps' || statKey === 'defensive_contribution' || expectedStatKeys.includes(statKey)
      const showTop10Badge = statShowsTop10 && !isZero && (isTop10ForColumn || (isDefColumn && showDefconBadge))
      const showBadge = showDefconBadge || showSavesBadge || showTop10Badge || isProvisionalBonus
      const displayVal = expectedStatKeys.includes(statKey) ? formatExpected(value) : value
      if (isZero && !isProvisionalBonus) {
        return <td key={statKey} className="gameweek-points-td gameweek-points-td-stat gameweek-points-cell-muted">{displayVal}</td>
      }
      if (isZero && isProvisionalBonus) {
        const title = 'Provisional bonus (from BPS rank; confirmed ~1h after full-time)'
        return (
          <td key={statKey} className="gameweek-points-td gameweek-points-td-stat gameweek-points-cell-provisional">
            <span className="gameweek-points-player-points-badge gameweek-points-stat-provisional" title={title}>{displayVal}</span>
          </td>
        )
      }
      const badgeClass = [
        'gameweek-points-player-points-badge',
        showTop10Badge && 'rank-highlight',
        showDefconBadge && 'defcon-achieved',
        showSavesBadge && 'saves-achieved',
        isProvisionalBonus && 'gameweek-points-stat-provisional'
      ].filter(Boolean).join(' ')
      let title
      if (isProvisionalBonus) {
        title = 'Provisional bonus (from BPS rank; confirmed ~1h after full-time)'
      } else if (showDefconBadge) {
        title = isTop10ForColumn ? 'Top 10 in GW & Defcon achieved (DEF ≥ position threshold)' : 'Defcon achieved (DEF ≥ position threshold)'
      } else if (showSavesBadge) {
        title = isTop10ForColumn ? 'Top 10 in GW & Saves achieved (3+ saves = 1 pt per 3)' : 'Saves achieved (3+ saves = 1 pt per 3)'
      } else {
        title = `Top 10 in GW for ${statKey}`
      }
      return (
        <td key={statKey} className={`gameweek-points-td gameweek-points-td-stat${isProvisionalBonus ? ' gameweek-points-cell-provisional' : ''}`}>
          {showBadge ? (
            <span className={badgeClass} title={title}>{displayVal}</span>
          ) : (
            displayVal
          )}
        </td>
      )
    }

    const handleRowClick = (e) => {
      if (onRowClick && typeof onRowClick === 'function') {
        onRowClick(player)
      }
    }

    return (
      <tr
        role={onRowClick ? 'button' : undefined}
        tabIndex={onRowClick ? 0 : undefined}
        onClick={onRowClick ? handleRowClick : undefined}
        onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleRowClick(e) } } : undefined}
        title={onRowClick && player.player_name ? `View details for ${player.player_name}` : undefined}
        className={`gameweek-points-tr ${isFirstBenchRow ? 'gameweek-points-tr-bench-first' : ''} ${isBench ? 'gameweek-points-tr-bench' : ''} ${isAutosubOut ? 'gameweek-points-tr-autosub-out' : ''} ${isAutosubIn ? 'gameweek-points-tr-autosub-in' : ''} ${isDgwSecondRow ? 'gameweek-points-tr-dgw-second' : ''} ${onRowClick ? 'gameweek-points-tr-clickable' : ''}`}
      >
        <td className="gameweek-points-td gameweek-points-td-player gameweek-points-td-player-fixed">
          <div className="gameweek-points-player-info-cell">
            {player.player_team_short_name && (
              <img
                src={`/badges/${player.player_team_short_name}.svg`}
                alt=""
                className="gameweek-points-team-badge"
                onError={(e) => { e.target.style.display = 'none' }}
              />
            )}
            <div className="gameweek-points-name-and-autosub">
              <span className={`gameweek-points-player-name-text${isOwnedByYou ? ' gameweek-points-player-name-text--owned-by-you' : ''}`} title={player.player_name}>
                {(() => {
                  const name = String(player.player_name ?? '')
                  return name.length > PLAYER_NAME_MAX_LENGTH ? name.slice(0, PLAYER_NAME_MAX_LENGTH) + '..' : name
                })()}
                {captainLabel && (
                  <span className="gameweek-points-captain-badge-inline">{captainLabel}</span>
                )}
                {assistantLabel && (
                  <span className="gameweek-points-assistant-badge-inline">{assistantLabel}</span>
                )}
                {isAutosubOut && (
                  <span className="gameweek-points-autosub-icon gameweek-points-autosub-out-icon" title="Auto-subbed out">
                    <ArrowDownRight size={12} strokeWidth={2.5} aria-hidden />
                  </span>
                )}
                {isAutosubIn && (
                  <span className="gameweek-points-autosub-icon gameweek-points-autosub-in-icon" title="Auto-subbed in">
                    <ArrowUpRight size={12} strokeWidth={2.5} aria-hidden />
                  </span>
                )}
              </span>
            </div>
          </div>
          <span className="gameweek-points-col-sep" aria-hidden />
        </td>
        <td
            className={`gameweek-points-td gameweek-points-td-pts ${!isTop10Pts && ptsDisplay === 0 ? 'gameweek-points-cell-muted' : ''}${(player.bonus_status === 'provisional' && (player.bonus ?? 0) > 0) || isBonusPending ? ' gameweek-points-cell-provisional' : ''}`}
            title={(player.bonus_status === 'provisional' && (player.bonus ?? 0) > 0) || isBonusPending ? (isBonusPending ? 'Points may update when bonus is confirmed (~1h after full-time)' : 'Includes provisional bonus (from BPS rank)') : player.multiplier && player.multiplier > 1 ? 'Points counted for your team (×C/×A)' : undefined}
          >
            {isTop10Pts ? (
              <span
                className="gameweek-points-player-points-badge rank-highlight"
                title="Top 10 in GW for points"
              >
                {formatNumber(ptsDisplay)}
              </span>
            ) : (
              formatNumber(ptsDisplay)
            )}
          </td>
        <td className={`gameweek-points-td gameweek-points-td-mins ${(player.minutes == null || player.minutes === 0) && matchStartedOrFinished ? 'gameweek-points-cell-muted' : ''}`}>
          <span className="gameweek-points-mins-value-wrap">
            {(player.minutes != null && player.minutes > 0) ? (
              <>
                {formatMinutes(player.minutes)}
                {showMinsLiveDot && (
                  <span
                    className={`live-updating-indicator gameweek-points-mins-live ${minsDotProvisional ? 'gameweek-points-mins-provisional' : ''}`}
                    title={minsDotProvisional ? 'Match finished (provisional); stats may update' : 'Minutes can change during live games'}
                    aria-hidden
                  />
                )}
              </>
            ) : !matchStartedOrFinished ? (
              (() => {
                const kickoff = formatKickoffShort(effectiveKickoffTime)
                if (kickoff) {
                  return (
                    <span className="gameweek-points-mins-upcoming" title={`Kickoff: ${kickoff.day} ${kickoff.time} (local)`}>
                      <span className="gameweek-points-mins-upcoming-day">{kickoff.day}</span>
                      <span className="gameweek-points-mins-upcoming-time">{kickoff.time}</span>
                    </span>
                  )
                }
                return <span className="gameweek-points-mins-upcoming gameweek-points-mins-upcoming-tbd">–</span>
              })()
            ) : (
              <span className="gameweek-points-mins-dnp-badge" title="Did not play">!</span>
            )}
          </span>
        </td>
        <td className="gameweek-points-td gameweek-points-td-opp">
          {player.opponent_team_short_name ? (
            <div className="gameweek-points-opponent-cell">
              <img
                src={`/badges/${player.opponent_team_short_name}.svg`}
                alt=""
                className="gameweek-points-opponent-badge"
                onError={(e) => { e.target.style.display = 'none' }}
              />
              {player.was_home ? (
                <svg className="gameweek-points-home-indicator" width="10" height="10" viewBox="0 0 48 48" fill="currentColor" aria-label="Home" title="Home">
                  <path d="M39.5,43h-9c-1.381,0-2.5-1.119-2.5-2.5v-9c0-1.105-0.895-2-2-2h-4c-1.105,0-2,0.895-2,2v9c0,1.381-1.119,2.5-2.5,2.5h-9C7.119,43,6,41.881,6,40.5V21.413c0-2.299,1.054-4.471,2.859-5.893L23.071,4.321c0.545-0.428,1.313-0.428,1.857,0L39.142,15.52C40.947,16.942,42,19.113,42,21.411V40.5C42,41.881,40.881,43,39.5,43z" />
                </svg>
              ) : (
                <span className="gameweek-points-home-indicator-filler" aria-hidden />
              )}
            </div>
          ) : (
            '–'
          )}
        </td>
        <td className="gameweek-points-td gameweek-points-td-impact">
          {hasImpact ? (
            <div className="gameweek-points-impact-cell" title={IMPACT_TOOLTIP}>
              <div className="gameweek-points-impact-bar-wrap">
                <div
                  className={`gameweek-points-impact-bar ${impact > 0 ? 'gameweek-points-impact-bar--positive' : impact < 0 ? 'gameweek-points-impact-bar--negative' : ''}`}
                  style={{ width: `${impactWidth * 100}%` }}
                />
              </div>
              <span className={`gameweek-points-impact-value ${impact < 0 ? 'gameweek-points-impact-value--negative' : ''}`}>
                {impact < 0 ? `−${Math.abs(impact)}` : impact}%
              </span>
            </div>
          ) : (
            <span className="gameweek-points-cell-muted">–</span>
          )}
        </td>
        {renderStatCell(player.goals_scored ?? 0, 'goals')}
        {renderStatCell(player.assists ?? 0, 'assists')}
        {renderStatCell(player.clean_sheets ?? 0, 'clean_sheets')}
        {renderStatCell(player.saves ?? 0, 'saves')}
        {renderStatCell(player.bps ?? 0, 'bps')}
        {renderStatCell(player.bonus ?? 0, 'bonus', { isProvisionalBonus: (player.bonus_status === 'provisional' && (player.bonus ?? 0) > 0) || isBonusPending })}
        {renderStatCell(player.defensive_contribution ?? 0, 'defensive_contribution')}
        {renderStatCell(player.yellow_cards ?? 0, 'yellow_cards')}
        {renderStatCell(player.red_cards ?? 0, 'red_cards')}
        {renderStatCell(player.expected_goals ?? 0, 'expected_goals')}
        {renderStatCell(player.expected_assists ?? 0, 'expected_assists')}
        {renderStatCell(player.expected_goal_involvements ?? 0, 'expected_goal_involvements')}
        {renderStatCell(player.expected_goals_conceded ?? 0, 'expected_goals_conceded')}
      </tr>
    )
  }

  return (
    <div className="gameweek-points-view">
      <div ref={scrollableRef} className="gameweek-points-scrollable">
        <div className="gameweek-points-box-content">
          <table className="gameweek-points-table">
            <thead>
              <tr>
                <th
                  className={`gameweek-points-th gameweek-points-th-player gameweek-points-th-sortable${sortColumn === 'player' ? ` gameweek-points-th-sorted-${sortDirection}` : ''}`}
                  onClick={() => handleSort('player')}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSort('player') } }}
                  role="button"
                  tabIndex={0}
                  aria-sort={sortColumn === 'player' ? (sortDirection === 'desc' ? 'descending' : 'ascending') : undefined}
                  title="Sort by player name"
                >
                  PLAYER
                  {sortColumn === 'player' && (sortDirection === 'desc' ? <ArrowDown size={10} className="gameweek-points-th-sort-icon" aria-hidden /> : <ArrowUp size={10} className="gameweek-points-th-sort-icon" aria-hidden />)}
                  <span className="gameweek-points-col-sep" aria-hidden />
                </th>
                <th
                  className={`gameweek-points-th gameweek-points-th-pts gameweek-points-th-sortable${sortColumn === 'points' ? ` gameweek-points-th-sorted-${sortDirection}` : ''}`}
                  onClick={() => handleSort('points')}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSort('points') } }}
                  role="button"
                  tabIndex={0}
                  aria-sort={sortColumn === 'points' ? (sortDirection === 'desc' ? 'descending' : 'ascending') : undefined}
                  title="Sort by points"
                >PTS{sortColumn === 'points' && (sortDirection === 'desc' ? <ArrowDown size={10} className="gameweek-points-th-sort-icon" aria-hidden /> : <ArrowUp size={10} className="gameweek-points-th-sort-icon" aria-hidden />)}</th>
                <th
                  className={`gameweek-points-th gameweek-points-th-mins gameweek-points-th-sortable${sortColumn === 'minutes' ? ` gameweek-points-th-sorted-${sortDirection}` : ''}`}
                  onClick={() => handleSort('minutes')}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSort('minutes') } }}
                  role="button"
                  tabIndex={0}
                  aria-sort={sortColumn === 'minutes' ? (sortDirection === 'desc' ? 'descending' : 'ascending') : undefined}
                  title="Sort by minutes played"
                >MP{sortColumn === 'minutes' && (sortDirection === 'desc' ? <ArrowDown size={10} className="gameweek-points-th-sort-icon" aria-hidden /> : <ArrowUp size={10} className="gameweek-points-th-sort-icon" aria-hidden />)}</th>
                <th
                  className={`gameweek-points-th gameweek-points-th-opp gameweek-points-th-sortable${sortColumn === 'opp' ? ` gameweek-points-th-sorted-${sortDirection}` : ''}`}
                  onClick={() => handleSort('opp')}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSort('opp') } }}
                  role="button"
                  tabIndex={0}
                  aria-sort={sortColumn === 'opp' ? (sortDirection === 'desc' ? 'descending' : 'ascending') : undefined}
                  title="Sort by opponent"
                >OPP{sortColumn === 'opp' && (sortDirection === 'desc' ? <ArrowDown size={10} className="gameweek-points-th-sort-icon" aria-hidden /> : <ArrowUp size={10} className="gameweek-points-th-sort-icon" aria-hidden />)}</th>
                <th
                  className={`gameweek-points-th gameweek-points-th-impact gameweek-points-th-impact--has-popup gameweek-points-th-sortable${sortColumn === 'impact' ? ` gameweek-points-th-sorted-${sortDirection}` : ''}`}
                  onClick={() => handleSort('impact')}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSort('impact') } }}
                  role="button"
                  tabIndex={0}
                  aria-sort={sortColumn === 'impact' ? (sortDirection === 'desc' ? 'descending' : 'ascending') : undefined}
                  title="Sort by importance"
                >
                  <span className="gameweek-points-th-impact-label">Imp</span>
                  {sortColumn === 'impact' && (sortDirection === 'desc' ? <ArrowDown size={10} className="gameweek-points-th-sort-icon" aria-hidden /> : <ArrowUp size={10} className="gameweek-points-th-sort-icon" aria-hidden />)}
                  <button
                    type="button"
                    ref={impactIconRef}
                    className="gameweek-points-th-impact-icon-wrap"
                    onClick={(e) => {
                      e.stopPropagation()
                      const next = !showImpactPopup
                      if (next) updatePopupPlacement()
                      setShowImpactPopup(next)
                    }}
                    title="What is Importance?"
                    aria-expanded={showImpactPopup}
                    aria-haspopup="dialog"
                  >
                    <HelpCircle size={12} className="gameweek-points-th-impact-icon" aria-hidden />
                  </button>
                  {showImpactPopup &&
                    createPortal(
                      <div
                        ref={impactPopupRef}
                        className="gameweek-points-impact-popup gameweek-points-impact-popup--portal"
                        role="dialog"
                        aria-label="Importance (Impact) explained"
                        style={{
                          position: 'fixed',
                          top: popupPlacement.top,
                          left: popupPlacement.left,
                          width: popupPlacement.width
                        }}
                      >
                        <div className="gameweek-points-impact-popup-title">Importance (Imp)</div>
                        <p className="gameweek-points-impact-popup-text">{IMPACT_TOOLTIP}</p>
                      </div>,
                      document.body
                    )}
                </th>
                {[
                  { key: 'goals_scored', label: 'G', title: 'Goals' },
                  { key: 'assists', label: 'A', title: 'Assists' },
                  { key: 'clean_sheets', label: 'CS', title: 'Clean sheets' },
                  { key: 'saves', label: 'S', title: 'Saves' },
                  { key: 'bps', label: 'BPS', title: 'BPS' },
                  { key: 'bonus', label: 'B', title: 'Bonus' },
                  { key: 'defensive_contribution', label: 'DEF', title: 'Defensive contribution' },
                  { key: 'yellow_cards', label: 'YC', title: 'Yellow cards' },
                  { key: 'red_cards', label: 'RC', title: 'Red cards' },
                  { key: 'expected_goals', label: 'xG', title: 'Expected goals' },
                  { key: 'expected_assists', label: 'xA', title: 'Expected assists' },
                  { key: 'expected_goal_involvements', label: 'xGI', title: 'Expected goal involvements' },
                  { key: 'expected_goals_conceded', label: 'xGC', title: 'Expected goals conceded' }
                ].map(({ key, label, title }) => (
                  <th
                    key={key}
                    className={`gameweek-points-th gameweek-points-th-stat gameweek-points-th-sortable${sortColumn === key ? ` gameweek-points-th-sorted-${sortDirection}` : ''}`}
                    onClick={() => handleSort(key)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSort(key) } }}
                    role="button"
                    tabIndex={0}
                    aria-sort={sortColumn === key ? (sortDirection === 'desc' ? 'descending' : 'ascending') : undefined}
                    title={`Sort by ${title}`}
                  >
                    {label}
                    {sortColumn === key && (sortDirection === 'desc' ? <ArrowDown size={10} className="gameweek-points-th-sort-icon" aria-hidden /> : <ArrowUp size={10} className="gameweek-points-th-sort-icon" aria-hidden />)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(() => {
                const firstBenchRowIndex = sortedData.findIndex((p) => p.position >= 12)
                return sortedData.map((player, index) => (
                  <PlayerTableRow
                    key={player.isDgwRow ? `${player.position}-${player.player_id}-${player.fixture_id ?? player.dgwRowIndex}` : player.position}
                    player={player}
                    isFirstBenchRow={index === firstBenchRowIndex}
                    onRowClick={onPlayerRowClick}
                  />
                ))
              })()}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
