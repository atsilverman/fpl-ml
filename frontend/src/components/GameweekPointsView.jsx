import { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import './GameweekPointsView.css'
import { formatNumber } from '../utils/formatNumbers'
import { ArrowDownRight, ArrowUpRight, HelpCircle, ArrowDown, ArrowUp } from 'lucide-react'
import { CardStatLabel } from './CardStatLabel'
import { useGameweekDebugData } from '../hooks/useGameweekDebugData'
import { useAxisLockedScroll } from '../hooks/useAxisLockedScroll'
import AnimatedValue from './AnimatedValue'

const IMPACT_TOOLTIP = 'Your share of this player\'s points vs the top third of your configured league (100% = in XI, 200% = captain, 300% = triple captain). Positive = you gain more than the top third; negative = the top third gains more.'

/** Stat columns that get a subtle green fill when player is top 10 for that stat in the gameweek. Excludes: pts impact, G, A, CS, S, opp, MP, YC, RC. */
const STAT_KEYS_TOP10_FILL = ['bps', 'defensive_contribution', 'expected_goals', 'expected_assists', 'expected_goal_involvements']

const PLAYER_NAME_MAX_LENGTH = 15

const POPUP_PADDING = 12
const POPUP_MAX_WIDTH = 320
const POPUP_MIN_WIDTH = 260

/** Normalize API/DB boolean (Supabase can return "true"/"false" strings; Boolean("false") is true in JS). */
function fixtureBool(v) {
  if (v === true || v === 'true') return true
  if (v === false || v === 'false') return false
  return false
}

export default function GameweekPointsView({ data = [], loading = false, topScorerPlayerIds = null, top10ByStat = null, showTop10Fill = true, isLiveUpdating = false, impactByPlayerId = {}, ownedByYouPlayerIds = null, fixtures: fixturesProp = [], onPlayerRowClick = null, sortable = true }) {
  const { fixtures: debugFixtures = [] } = useGameweekDebugData()
  const fixtures = (fixturesProp != null && Array.isArray(fixturesProp)) ? fixturesProp : debugFixtures
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
  const [hoverColIndex, setHoverColIndex] = useState(null)
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
      case 'points': return player.totalContributedPointsForSlot ?? player.contributedPoints ?? player.points ?? 0
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

  /** Max |impact| among currently listed players; scale bar so this = 100% width. At least 1 to avoid div-by-zero. */
  const maxImpactInView = useMemo(() => {
    if (!sortedData?.length || !impactByPlayerId) return 1
    let max = 0
    for (const p of sortedData) {
      const pid = p.effective_player_id ?? p.player_id
      const impact = impactByPlayerId[pid]
      if (typeof impact === 'number' && !Number.isNaN(impact)) {
        const abs = Math.abs(impact)
        if (abs > max) max = abs
      }
    }
    return max >= 1 ? max : 1
  }, [sortedData, impactByPlayerId])

  const handleSort = (key) => {
    if (!sortable) return
    if (sortColumn === key) {
      setSortDirection((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortColumn(key)
      setSortDirection('desc')
    }
  }


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
          <div style={{ color: 'var(--text-secondary)', fontSize: '9px', marginTop: '4px' }}>
            Picks load after the deadline batch runs. If your manager isn’t in a tracked league, set <code style={{ fontSize: '9px' }}>REQUIRED_MANAGER_ID</code> in the backend.
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

  const PlayerTableRow = ({ player, isFirstBenchRow: isFirstBenchRowProp, onRowClick }) => {
    const isDgwFirstRow = Boolean(player.isDgwRow && player.dgwRowIndex === 0)
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
    const impactWidth = hasImpact ? Math.min(1, Math.abs(impact) / maxImpactInView) : 0
    const fid = player.fixture_id != null && player.fixture_id !== 0 ? player.fixture_id : null
    const rowKeyForTop10 = `${playerId ?? 0}-${fid ?? 0}`
    const isTop10ForStat = (statKey) => {
      if (!showTop10Fill || !top10ByStat || !top10ByStat[statKey]?.has) return false
      const set = top10ByStat[statKey]
      const pid = playerId ?? 0
      if (set.has(rowKeyForTop10)) return true
      if (fid) return set.has(`${pid}-0`)
      return Array.from(set).some(k => String(k).startsWith(`${pid}-`))
    }
    const isTop10Pts = (() => {
      if (!showTop10Fill || !top10ByStat?.pts?.has) return false
      const set = top10ByStat.pts
      const pid = String(playerId ?? 0)
      if (set.has(rowKeyForTop10)) return true
      if (fid) return set.has(`${pid}-0`)
      return Array.from(set).some(k => String(k).startsWith(`${pid}-`))
    })()
    const isTop10PtsAnyFixture = isTop10Pts || (showTop10Fill && top10ByStat?.pts && Array.from(top10ByStat.pts).some(k => String(k).startsWith(`${playerId ?? 0}-`)))
    const isDefconAchieved = Boolean(player.defcon_points_achieved)
    const isAutosubOut = Boolean(player.was_auto_subbed_out)
    const isAutosubIn = Boolean(player.was_auto_subbed_in)
    const fixtureForPlayer = fixturesById && fid != null
      ? (fixturesById[fid] ?? fixturesById[Number(fid)] ?? fixturesById[String(fid)])
      : null
    const scheduleFixtureByTeam = !fixtureForPlayer && player.player_team_id && fixtures?.length
      ? fixtures.find(f => f.home_team_id === player.player_team_id || f.away_team_id === player.player_team_id)
      : null
    const effectiveKickoffTime = player.kickoff_time || fixtureForPlayer?.kickoff_time || scheduleFixtureByTeam?.kickoff_time || null
    const fixtureForMatchState = fixtureForPlayer ?? scheduleFixtureByTeam
    // Normalize fixture booleans (API can return "true"/"false" strings)
    const matchStarted = fixtureForMatchState ? fixtureBool(fixtureForMatchState.started) : Boolean(player.match_started)
    const matchFinished = fixtureForMatchState ? fixtureBool(fixtureForMatchState.finished) : Boolean(player.match_finished)
    const matchFinishedProvisional = fixtureForMatchState ? fixtureBool(fixtureForMatchState.finished_provisional) : Boolean(player.match_finished_provisional)
    const fixtureMins = fixtureForMatchState?.minutes != null ? Number(fixtureForMatchState.minutes) : null
    const fixtureAtOrPast90 = fixtureMins != null && !Number.isNaN(fixtureMins) && fixtureMins >= 90
    const effectivelyProvisional = matchFinishedProvisional || (matchStarted && !matchFinished && fixtureAtOrPast90)
    const matchStartedOrFinished = matchStarted || matchFinished || effectivelyProvisional
    const matchFinishedOrProvisional = matchFinished || effectivelyProvisional
    // Dot state is 100% fixture-driven (source of truth). No fixture = never show green.
    const hasFixtureLiveState = Boolean(fixtureForMatchState)
    const fixtureSaysLive = hasFixtureLiveState && matchStarted && !matchFinished && !effectivelyProvisional
    const isMatchLive = hasFixtureLiveState && fixtureSaysLive
    const isMatchProvisional = effectivelyProvisional && !matchFinished
    const isBonusPending = isMatchProvisional && player.bonus_status === 'provisional'
    // Only show live-updating indicator when match is live (minutes can change). Do not show it for provisional/finished; use minutes risk dots only for those.
    const showMinsLiveDot = (player.minutes != null && player.minutes > 0) && isMatchLive
    const mins = player.minutes != null ? Number(player.minutes) : 0
    /* Risk dots when game is finished or provisionally finished (not live) */
    const showMinsRiskRed = matchFinishedOrProvisional && mins > 0 && mins < 45
    const showMinsRiskOrange = matchFinishedOrProvisional && mins >= 45 && mins < 80
    const ptsDisplay = player.contributedPoints ?? player.points

    const isGk = player.position === 1
    const expectedStatKeys = ['expected_goals', 'expected_assists', 'expected_goal_involvements', 'expected_goals_conceded']
    const formatExpected = (v) => {
      const n = Number(v)
      if (n === 0) return '0'
      return n.toFixed(2)
    }
    /** True when this stat cell represents FPL points impact (earns points); used for hollow pill border. Saves: only 3+ (not 1 or 2). */
    const isImpactPillStat = (statKey, numVal) => {
      if (statKey === 'goals' || statKey === 'assists' || statKey === 'clean_sheets') return numVal >= 1
      if (statKey === 'saves') return isGk && numVal >= 3
      if (statKey === 'defensive_contribution') return isDefconAchieved && numVal >= 1
      if (statKey === 'bonus') return numVal >= 1
      return false
    }
    const renderStatCell = (value, statKey, opts = {}) => {
      const numVal = Number(value) || 0
      const isZero = numVal === 0
      const isDefColumn = statKey === 'defensive_contribution'
      const isSavesColumn = statKey === 'saves'
      const isProvisionalBonus = opts.isProvisionalBonus ?? false
      const showDefconBadge = isDefColumn && !isZero && isDefconAchieved
      const showSavesBadge = isSavesColumn && isGk && !isZero && value >= 3
      const showBadge = showSavesBadge || isProvisionalBonus
      const isImpactPill = isImpactPillStat(statKey, numVal)
      const isTop10 = STAT_KEYS_TOP10_FILL.includes(statKey) && isTop10ForStat(statKey)
      const displayVal = expectedStatKeys.includes(statKey) ? formatExpected(value) : value
      const dataCol = opts.colIndex != null ? { 'data-col': opts.colIndex } : {}
      if (isZero && !isProvisionalBonus) {
        return <td key={statKey} className={`gameweek-points-td gameweek-points-td-stat gameweek-points-cell-muted${isTop10 ? ' gameweek-points-td-stat--top10' : ''}`} {...dataCol}>{isTop10 ? <span className="gameweek-points-stat-top10-pill">{displayVal}</span> : displayVal}</td>
      }
      if (isZero && isProvisionalBonus) {
        const title = 'Provisional bonus (from BPS rank; confirmed ~1h after full-time)'
        return (
          <td key={statKey} className={`gameweek-points-td gameweek-points-td-stat gameweek-points-cell-provisional${isTop10 ? ' gameweek-points-td-stat--top10' : ''}`} {...dataCol}>
            <AnimatedValue value={value}>
              <span className="gameweek-points-player-points-badge gameweek-points-stat-provisional" title={title}>{displayVal}</span>
            </AnimatedValue>
          </td>
        )
      }
      const badgeClass = [
        'gameweek-points-player-points-badge',
        isProvisionalBonus && 'gameweek-points-stat-provisional'
      ].filter(Boolean).join(' ')
      let title
      if (isProvisionalBonus) {
        title = 'Provisional bonus (from BPS rank; confirmed ~1h after full-time)'
      } else if (showDefconBadge) {
        title = 'Defcon achieved (DEF ≥ position threshold)'
      } else if (showSavesBadge) {
        title = 'Saves achieved (3+ saves = 1 pt per 3)'
      } else {
        title = undefined
      }
      const inner = showBadge ? (
        <span className={badgeClass} title={title}>{displayVal}</span>
      ) : showDefconBadge ? (
        <span className="gameweek-points-impact-pill-wrap" title={title}>{displayVal}</span>
      ) : isImpactPill ? (
        <span className="gameweek-points-impact-pill-wrap">{displayVal}</span>
      ) : isTop10 ? (
        <span className="gameweek-points-stat-top10-pill">{displayVal}</span>
      ) : (
        displayVal
      )
      return (
        <td key={statKey} className={`gameweek-points-td gameweek-points-td-stat${isProvisionalBonus ? ' gameweek-points-cell-provisional' : ''}${isImpactPill ? ' gameweek-points-cell--impact-pill' : ''}${isTop10 ? ' gameweek-points-td-stat--top10' : ''}`} {...dataCol}>
          <AnimatedValue value={value}>
            {inner}
          </AnimatedValue>
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
        className={`gameweek-points-tr ${isFirstBenchRow ? 'gameweek-points-tr-bench-first' : ''} ${isBench ? 'gameweek-points-tr-bench' : ''} ${isAutosubOut ? 'gameweek-points-tr-autosub-out' : ''} ${isAutosubIn ? 'gameweek-points-tr-autosub-in' : ''} ${isDgwFirstRow ? 'gameweek-points-tr-dgw-first' : ''} ${isDgwSecondRow ? 'gameweek-points-tr-dgw-second' : ''} ${onRowClick ? 'gameweek-points-tr-clickable' : ''}`}
        onMouseMove={(e) => {
          const td = e.target.closest('td')
          if (td) {
            const col = td.getAttribute('data-col')
            if (col != null) setHoverColIndex(parseInt(col, 10))
          }
        }}
        onMouseLeave={() => setHoverColIndex(null)}
      >
        {!isDgwSecondRow && (
          <td
            className={`gameweek-points-td gameweek-points-td-player gameweek-points-td-player-fixed${isDgwFirstRow ? ' gameweek-points-td-player-dgw-span' : ''}`}
            rowSpan={isDgwFirstRow ? 2 : undefined}
            data-col="0"
          >
            <div className="gameweek-points-player-info-cell">
              {player.player_team_short_name && (
                <img
                  src={`/badges/${player.player_team_short_name}.svg`}
                  alt=""
                  className="gameweek-points-team-badge"
                  onError={(e) => { e.target.style.display = 'none' }}
                />
              )}
              <div className={`gameweek-points-name-and-autosub${isOwnedByYou ? ' gameweek-points-name-and-autosub--owned-by-you' : ''}`}>
                <span className="gameweek-points-player-name-text" title={player.player_name}>
                  {(() => {
                    const name = String(player.player_name ?? '')
                    return name.length > PLAYER_NAME_MAX_LENGTH ? name.slice(0, PLAYER_NAME_MAX_LENGTH) + '..' : name
                  })()}
                  {captainLabel && (
                    <span className={`gameweek-points-captain-badge-inline${captainLabel === 'TC' ? ' gameweek-points-captain-badge-inline--tc' : ''}`}>{captainLabel}</span>
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
          </td>
        )}
        <td
          className={`gameweek-points-td gameweek-points-td-pts${!matchStarted ? ' gameweek-points-td-pts--upcoming' : ''}${matchStarted && ptsDisplay === 0 ? ' gameweek-points-cell-muted' : ''}${(player.bonus_status === 'provisional' && (player.bonus ?? 0) > 0) || isBonusPending ? ' gameweek-points-cell-provisional' : ''}${matchStarted && isTop10PtsAnyFixture ? ' gameweek-points-td-pts--top10' : ''}`}
          title={!matchStarted ? 'Fixture not started' : (player.bonus_status === 'provisional' && (player.bonus ?? 0) > 0) || isBonusPending ? (isBonusPending ? 'Points may update when bonus is confirmed (~1h after full-time)' : 'Includes provisional bonus (from BPS rank)') : player.multiplier && player.multiplier > 1 ? 'Points counted for your team (×C/×A)' : (player.isDgwRow ? 'Points for this match' : undefined)}
          data-col="1"
        >
            {!matchStarted ? (
              <span className="gameweek-points-pts-upcoming">—</span>
            ) : (
              <AnimatedValue value={ptsDisplay}>
                <span className={`gameweek-points-player-points-badge${ptsDisplay === 0 ? ' gameweek-points-player-points-badge--zero' : ''}`}>
                  {formatNumber(ptsDisplay)}
                </span>
              </AnimatedValue>
            )}
        </td>
        <td className={`gameweek-points-td gameweek-points-td-mins ${(player.minutes == null || player.minutes === 0) && matchFinishedOrProvisional ? 'gameweek-points-cell-muted' : ''}`} data-col="2">
          <span className="gameweek-points-mins-value-wrap">
            {(player.minutes != null && player.minutes > 0) ? (
              <>
                <AnimatedValue value={player.minutes ?? 0}>
                  {formatMinutes(Math.min(90, player.minutes ?? 0))}
                  {showMinsLiveDot && (
                    <span
                      className="live-updating-indicator gameweek-points-mins-live"
                      title="Minutes can change during live games"
                      aria-hidden
                    />
                  )}
                </AnimatedValue>
                {!showMinsLiveDot && showMinsRiskRed && (
                  <span className="gameweek-points-mins-risk-dot gameweek-points-mins-risk-dot--red" title="Under 45 minutes played" aria-hidden />
                )}
                {!showMinsLiveDot && showMinsRiskOrange && (
                  <span className="gameweek-points-mins-risk-dot gameweek-points-mins-risk-dot--orange" title="Under 80 minutes played" aria-hidden />
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
            ) : isMatchLive ? (
              <span className="gameweek-points-mins-live-badge" title="Match in progress – stats updating">Live</span>
            ) : (
              <span className="gameweek-points-mins-dnp-badge" title="Did not play">!</span>
            )}
          </span>
        </td>
        <td className="gameweek-points-td gameweek-points-td-opp" data-col="3">
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
        <td className="gameweek-points-td gameweek-points-td-impact" data-col="4">
          {hasImpact ? (
            <div className="gameweek-points-impact-cell" title={IMPACT_TOOLTIP}>
              <div className="gameweek-points-impact-bar-wrap">
                <div
                  className={(() => {
                    const abs = Math.abs(impact)
                    const tier = abs >= 80 ? 'high' : abs >= 40 ? 'mid' : 'low'
                    const sign = impact > 0 ? 'positive' : 'negative'
                    return `gameweek-points-impact-bar gameweek-points-impact-bar--${sign} gameweek-points-impact-bar--${sign}-${tier}`
                  })()}
                  style={{ width: `${impactWidth * 100}%` }}
                />
              </div>
              <span className={`gameweek-points-impact-value ${impact > 0 ? 'gameweek-points-impact-value--positive' : impact < 0 ? 'gameweek-points-impact-value--negative' : ''}`}>
                {impact < 0 ? `−${Math.abs(impact)}` : impact}%
              </span>
            </div>
          ) : (
            <span className="gameweek-points-cell-muted">–</span>
          )}
        </td>
        {renderStatCell(player.goals_scored ?? 0, 'goals', { colIndex: 5 })}
        {renderStatCell(player.assists ?? 0, 'assists', { colIndex: 6 })}
        {renderStatCell(player.clean_sheets ?? 0, 'clean_sheets', { colIndex: 7 })}
        {renderStatCell(player.bps ?? 0, 'bps', { colIndex: 8 })}
        {renderStatCell(player.bonus ?? 0, 'bonus', { isProvisionalBonus: (player.bonus_status === 'provisional' && (player.bonus ?? 0) > 0) || isBonusPending, colIndex: 9 })}
        {renderStatCell(player.defensive_contribution ?? 0, 'defensive_contribution', { colIndex: 10 })}
        {renderStatCell(player.saves ?? 0, 'saves', { colIndex: 11 })}
        {renderStatCell(player.yellow_cards ?? 0, 'yellow_cards', { colIndex: 12 })}
        {renderStatCell(player.red_cards ?? 0, 'red_cards', { colIndex: 13 })}
        {renderStatCell(player.expected_goals ?? 0, 'expected_goals', { colIndex: 14 })}
        {renderStatCell(player.expected_assists ?? 0, 'expected_assists', { colIndex: 15 })}
        {renderStatCell(player.expected_goal_involvements ?? 0, 'expected_goal_involvements', { colIndex: 16 })}
        {renderStatCell(player.expected_goals_conceded ?? 0, 'expected_goals_conceded', { colIndex: 17 })}
      </tr>
    )
  }

  return (
    <div className="gameweek-points-view">
      <div ref={scrollableRef} className="gameweek-points-scrollable">
        <div className="gameweek-points-box-content">
          <table className="gameweek-points-table" data-hover-col={hoverColIndex != null ? String(hoverColIndex) : undefined}>
            <thead>
              <tr>
                <th
                  data-col="0"
                  className={`gameweek-points-th gameweek-points-th-player${sortable ? ` gameweek-points-th-sortable${sortColumn === 'player' ? ` gameweek-points-th-sorted-${sortDirection}` : ''}` : ''}`}
                  {...(sortable && {
                    onClick: () => handleSort('player'),
                    onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSort('player') } },
                    role: 'button',
                    tabIndex: 0,
                    'aria-sort': sortColumn === 'player' ? (sortDirection === 'desc' ? 'descending' : 'ascending') : undefined,
                    title: 'Sort by player name'
                  })}
                  onMouseEnter={() => setHoverColIndex(0)}
                  onMouseLeave={() => setHoverColIndex(null)}
                >
                  PLAYER
                  {sortable && sortColumn === 'player' && (sortDirection === 'desc' ? <ArrowDown size={8} className="gameweek-points-th-sort-icon" aria-hidden /> : <ArrowUp size={8} className="gameweek-points-th-sort-icon" aria-hidden />)}
                </th>
                <th
                  data-col="1"
                  className={`gameweek-points-th gameweek-points-th-pts${sortable ? ` gameweek-points-th-sortable${sortColumn === 'points' ? ` gameweek-points-th-sorted-${sortDirection}` : ''}` : ''}`}
                  {...(sortable && {
                    onClick: () => handleSort('points'),
                    onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSort('points') } },
                    role: 'button',
                    tabIndex: 0,
                    'aria-sort': sortColumn === 'points' ? (sortDirection === 'desc' ? 'descending' : 'ascending') : undefined,
                    title: 'Sort by points'
                  })}
                  onMouseEnter={() => setHoverColIndex(1)}
                  onMouseLeave={() => setHoverColIndex(null)}
                >PTS{sortable && sortColumn === 'points' && (sortDirection === 'desc' ? <ArrowDown size={8} className="gameweek-points-th-sort-icon" aria-hidden /> : <ArrowUp size={8} className="gameweek-points-th-sort-icon" aria-hidden />)}</th>
                <th
                  data-col="2"
                  className={`gameweek-points-th gameweek-points-th-mins${sortable ? ` gameweek-points-th-sortable${sortColumn === 'minutes' ? ` gameweek-points-th-sorted-${sortDirection}` : ''}` : ''}`}
                  {...(sortable && {
                    onClick: () => handleSort('minutes'),
                    onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSort('minutes') } },
                    role: 'button',
                    tabIndex: 0,
                    'aria-sort': sortColumn === 'minutes' ? (sortDirection === 'desc' ? 'descending' : 'ascending') : undefined,
                    title: 'Sort by minutes played'
                  })}
                  onMouseEnter={() => setHoverColIndex(2)}
                  onMouseLeave={() => setHoverColIndex(null)}
                >MP{sortable && sortColumn === 'minutes' && (sortDirection === 'desc' ? <ArrowDown size={8} className="gameweek-points-th-sort-icon" aria-hidden /> : <ArrowUp size={8} className="gameweek-points-th-sort-icon" aria-hidden />)}</th>
                <th
                  data-col="3"
                  className={`gameweek-points-th gameweek-points-th-opp${sortable ? ` gameweek-points-th-sortable${sortColumn === 'opp' ? ` gameweek-points-th-sorted-${sortDirection}` : ''}` : ''}`}
                  {...(sortable && {
                    onClick: () => handleSort('opp'),
                    onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSort('opp') } },
                    role: 'button',
                    tabIndex: 0,
                    'aria-sort': sortColumn === 'opp' ? (sortDirection === 'desc' ? 'descending' : 'ascending') : undefined,
                    title: 'Sort by opponent'
                  })}
                  onMouseEnter={() => setHoverColIndex(3)}
                  onMouseLeave={() => setHoverColIndex(null)}
                >OPP{sortable && sortColumn === 'opp' && (sortDirection === 'desc' ? <ArrowDown size={8} className="gameweek-points-th-sort-icon" aria-hidden /> : <ArrowUp size={8} className="gameweek-points-th-sort-icon" aria-hidden />)}</th>
                <th
                  data-col="4"
                  className={`gameweek-points-th gameweek-points-th-impact gameweek-points-th-impact--has-popup${sortable ? ` gameweek-points-th-sortable${sortColumn === 'impact' ? ` gameweek-points-th-sorted-${sortDirection}` : ''}` : ''}`}
                  {...(sortable && {
                    onClick: () => handleSort('impact'),
                    onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSort('impact') } },
                    role: 'button',
                    tabIndex: 0,
                    'aria-sort': sortColumn === 'impact' ? (sortDirection === 'desc' ? 'descending' : 'ascending') : undefined,
                    title: 'Sort by importance'
                  })}
                  onMouseEnter={() => setHoverColIndex(4)}
                  onMouseLeave={() => setHoverColIndex(null)}
                >
                  <span className="gameweek-points-th-impact-label">Imp</span>
                  {sortable && sortColumn === 'impact' && (sortDirection === 'desc' ? <ArrowDown size={8} className="gameweek-points-th-sort-icon" aria-hidden /> : <ArrowUp size={8} className="gameweek-points-th-sort-icon" aria-hidden />)}
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
                  { key: 'bps', label: 'BPS', title: 'BPS' },
                  { key: 'bonus', label: 'B', title: 'Bonus' },
                  { key: 'defensive_contribution', label: 'DEFCON', title: 'DEFCON' },
                  { key: 'saves', label: 'S', title: 'Saves' },
                  { key: 'yellow_cards', label: 'YC', title: 'Yellow cards' },
                  { key: 'red_cards', label: 'RC', title: 'Red cards' },
                  { key: 'expected_goals', label: 'xG', title: 'Expected goals' },
                  { key: 'expected_assists', label: 'xA', title: 'Expected assists' },
                  { key: 'expected_goal_involvements', label: 'xGI', title: 'Expected goal involvements' },
                  { key: 'expected_goals_conceded', label: 'xGC', title: 'Expected goals conceded' }
                ].map(({ key, label, title }, idx) => (
                  <th
                    key={key}
                    data-col={String(5 + idx)}
                    className={`gameweek-points-th gameweek-points-th-stat${sortable ? ` gameweek-points-th-sortable${sortColumn === key ? ` gameweek-points-th-sorted-${sortDirection}` : ''}` : ''}`}
                    {...(sortable && {
                      onClick: () => handleSort(key),
                      onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSort(key) } },
                      role: 'button',
                      tabIndex: 0,
                      'aria-sort': sortColumn === key ? (sortDirection === 'desc' ? 'descending' : 'ascending') : undefined,
                      title: `Sort by ${title}`
                    })}
                    onMouseEnter={() => setHoverColIndex(5 + idx)}
                    onMouseLeave={() => setHoverColIndex(null)}
                  >
                    <CardStatLabel statKey={key} label={label} />
                    {sortable && sortColumn === key && (sortDirection === 'desc' ? <ArrowDown size={8} className="gameweek-points-th-sort-icon" aria-hidden /> : <ArrowUp size={8} className="gameweek-points-th-sort-icon" aria-hidden />)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="gameweek-points-tbody-starters">
              {sortedData
                .filter((p) => p.position <= 11)
                .map((player) => (
                  <PlayerTableRow
                    key={player.isDgwRow ? `${player.position}-${player.player_id}-${player.fixture_id ?? player.dgwRowIndex}` : player.position}
                    player={player}
                    isFirstBenchRow={false}
                    onRowClick={onPlayerRowClick}
                  />
                ))}
            </tbody>
            {sortedData.filter((p) => p.position >= 12).length > 0 && (
              <tbody className="gameweek-points-tbody-bench" aria-label="Bench">
                <tr className="gameweek-points-tr gameweek-points-tr-bench-divider" role="presentation">
                  <td className="gameweek-points-td gameweek-points-td-bench-divider gameweek-points-td-bench-divider-fixed">Bench</td>
                  <td className="gameweek-points-td gameweek-points-td-bench-divider-fill" colSpan={17} aria-hidden />
                </tr>
                {sortedData
                  .filter((p) => p.position >= 12)
                  .map((player) => (
                    <PlayerTableRow
                      key={player.isDgwRow ? `${player.position}-${player.player_id}-${player.fixture_id ?? player.dgwRowIndex}` : player.position}
                      player={player}
                      isFirstBenchRow={false}
                      onRowClick={onPlayerRowClick}
                    />
                  ))}
              </tbody>
            )}
          </table>
        </div>
      </div>
    </div>
  )
}
