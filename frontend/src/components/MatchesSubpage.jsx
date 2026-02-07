import { useState, useMemo, useEffect, useRef } from 'react'
import { useGameweekData } from '../hooks/useGameweekData'
import { useFixturesWithTeams } from '../hooks/useFixturesWithTeams'
import { useFixturePlayerStats } from '../hooks/useFixturePlayerStats'
import { useGameweekTop10ByStat } from '../hooks/useGameweekTop10ByStat'
import { useGameweekTopPerformersByStat, TOP_PERFORMERS_STAT_KEYS } from '../hooks/useGameweekTopPerformersByStat'
import { useGameweekMaxBps } from '../hooks/useGameweekMaxBps'
import { useCurrentGameweekPlayers } from '../hooks/useCurrentGameweekPlayers'
import { formatNumber } from '../utils/formatNumbers'
import { abbreviateTeamName } from '../utils/formatDisplay'
import BpsLeadersChart from './BpsLeadersChart'
import { ChevronDown, ChevronUp, MoveDiagonal, Minimize2 } from 'lucide-react'
import { useLastH2H, pairKey } from '../hooks/useLastH2H'
import { useLastH2HPlayerStats } from '../hooks/useLastH2HPlayerStats'
import { useAxisLockedScroll } from '../hooks/useAxisLockedScroll'
import './MatchesSubpage.css'

/**
 * Fixture status: Final = match-level finished === true (FPL confirmed; reddish/orange).
 * Provisional = finished_provisional === true but finished === false (yellowish; label "Finished").
 */
function getFixtureStatus(fixture, _dataChecked = false) {
  if (!fixture) return 'scheduled'
  const started = Boolean(fixture.started)
  const finished = Boolean(fixture.finished)
  const finishedProvisional = Boolean(fixture.finished_provisional)
  if (!started) return 'scheduled'
  if (started && !finishedProvisional) return 'live'
  if (started && finished) return 'final'
  if (started && finishedProvisional && !finished) return 'provisional'
  return 'scheduled'
}

const STAT_KEYS = [
  { key: 'goals', col: 'goals_scored' },
  { key: 'assists', col: 'assists' },
  { key: 'clean_sheets', col: 'clean_sheets' },
  { key: 'saves', col: 'saves' },
  { key: 'bps', col: 'bps' },
  { key: 'bonus', col: 'bonus' },
  { key: 'defensive_contribution', col: 'defensive_contribution' },
  { key: 'yellow_cards', col: 'yellow_cards' },
  { key: 'red_cards', col: 'red_cards' },
  { key: 'expected_goals', col: 'expected_goals' },
  { key: 'expected_assists', col: 'expected_assists' },
  { key: 'expected_goal_involvements', col: 'expected_goal_involvements' },
  { key: 'expected_goals_conceded', col: 'expected_goals_conceded' }
]

/** Column config for sortable matchup detail table headers (order matches table) */
const SORT_COLUMNS = [
  { key: 'player_name', col: 'player_name', label: 'Player', type: 'string' },
  { key: 'minutes', col: 'minutes', label: 'MP', type: 'number' },
  { key: 'points', col: 'points', label: 'PTS', type: 'number' },
  ...STAT_KEYS.map(({ key, col }) => ({
    key,
    col,
    label: key === 'goals' ? 'G' : key === 'assists' ? 'A' : key === 'clean_sheets' ? 'CS' : key === 'saves' ? 'S' : key === 'bps' ? 'BPS' : key === 'bonus' ? 'B' : key === 'defensive_contribution' ? 'DEF' : key === 'yellow_cards' ? 'YC' : key === 'red_cards' ? 'RC' : key === 'expected_goals' ? 'xG' : key === 'expected_assists' ? 'xA' : key === 'expected_goal_involvements' ? 'xGI' : key === 'expected_goals_conceded' ? 'xGC' : key,
    type: 'number'
  }))
]

const EXPECTED_STAT_KEYS = ['expected_goals', 'expected_assists', 'expected_goal_involvements', 'expected_goals_conceded']

function formatExpected(v) {
  const n = Number(v)
  if (n === 0) return '0'
  return n.toFixed(2)
}

export function MatchPlayerTable({ players, teamShortName, teamName, top10ByStat, ownedPlayerIds, hideHeader = false, useDashForDnp = false, onTableAreaClick }) {
  const [sortKey, setSortKey] = useState('points')
  const [sortDir, setSortDir] = useState('asc')
  const tableScrollRef = useRef(null)
  useAxisLockedScroll(tableScrollRef)
  /* Always hide 0 minutes / DNP players in matchup card (any state or H2H view) */
  const filteredPlayers = players?.length
    ? players.filter(p => p.minutes != null && Number(p.minutes) > 0)
    : (players ?? [])
  const displayedPlayers = useMemo(() => {
    if (!filteredPlayers.length) return []
    const col = SORT_COLUMNS.find(c => c.key === sortKey)?.col ?? 'points'
    const type = SORT_COLUMNS.find(c => c.key === sortKey)?.type ?? 'number'
    const mult = sortDir === 'asc' ? 1 : -1
    return [...filteredPlayers].sort((a, b) => {
      const aVal = a[col] ?? (type === 'string' ? '' : 0)
      const bVal = b[col] ?? (type === 'string' ? '' : 0)
      if (type === 'string') {
        return mult * (String(aVal).localeCompare(String(bVal), undefined, { numeric: true }) || 0)
      }
      const an = Number(aVal) || 0
      const bn = Number(bVal) || 0
      if (bn !== an) return mult * (bn - an)
      return mult * ((a.player_name || '').localeCompare(b.player_name || ''))
    })
  }, [filteredPlayers, sortKey, sortDir])
  const handleSort = (key) => {
    if (key === sortKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else {
      setSortKey(key)
      const colConfig = SORT_COLUMNS.find(c => c.key === key)
      setSortDir(colConfig?.type === 'string' ? 'asc' : 'desc')
    }
  }
  if (!displayedPlayers.length) {
    return (
      <div
        className={`matchup-detail-table-wrap${onTableAreaClick ? ' matchup-detail-table-wrap--tap-to-close' : ''}`}
        onClick={onTableAreaClick ? (e) => { e.stopPropagation(); onTableAreaClick() } : undefined}
        role={onTableAreaClick ? 'button' : undefined}
        tabIndex={onTableAreaClick ? 0 : undefined}
        onKeyDown={onTableAreaClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTableAreaClick() } } : undefined}
        aria-label={onTableAreaClick ? 'Tap to close details' : undefined}
      >
        {!hideHeader && (
          <div className="matchup-detail-table-header">
            {teamShortName && (
              <img src={`/badges/${teamShortName}.svg`} alt="" className="matchup-detail-table-badge" onError={e => { e.target.style.display = 'none' }} />
            )}
            <span className="matchup-detail-table-title">{teamName || 'Team'}</span>
          </div>
        )}
        <div className="matchup-detail-table-empty">No player data</div>
      </div>
    )
  }

  const renderStatCell = (player, { key, col }) => {
    const value = player[col] ?? 0
    const numVal = Number(value) || 0
    const isZero = numVal === 0
    const playerId = player.player_id != null ? Number(player.player_id) : null
    const isTop10ForColumn = playerId != null && top10ByStat?.[key]?.has(playerId)
    const isDefColumn = key === 'defensive_contribution'
    const isSavesColumn = key === 'saves'
    const isBonusColumn = key === 'bonus'
    const isProvisionalBonus = isBonusColumn && player.bonus_status === 'provisional' && !isZero
    const isDefconAchieved = Boolean(player.defcon_points_achieved)
    const isGk = player.position === 1
    const showDefconBadge = isDefColumn && !isZero && isDefconAchieved
    const showSavesBadge = isSavesColumn && isGk && !isZero && value >= 3
    const statShowsTop10 = key === 'bps' || key === 'defensive_contribution' || EXPECTED_STAT_KEYS.includes(key)
    const showTop10Badge = statShowsTop10 && !isZero && (isTop10ForColumn || (isDefColumn && showDefconBadge))
    const showBadge = showDefconBadge || showSavesBadge || showTop10Badge
    const displayVal = EXPECTED_STAT_KEYS.includes(key) ? formatExpected(value) : value
    if (isZero) {
      return (
        <td key={key} className="matchup-detail-td matchup-detail-td-stat matchup-detail-cell-muted">
          {displayVal}
        </td>
      )
    }
    const badgeClass = [
      'matchup-detail-stat-badge',
      showTop10Badge && 'matchup-detail-rank-highlight',
      showDefconBadge && 'matchup-detail-defcon-achieved',
      showSavesBadge && 'matchup-detail-saves-achieved',
      isProvisionalBonus && 'matchup-detail-stat-provisional'
    ].filter(Boolean).join(' ')
    let title = `Top 10 in GW for ${key}`
    if (isProvisionalBonus) title = 'Provisional bonus (from BPS rank; confirmed ~1h after full-time)'
    else if (showDefconBadge) title = isTop10ForColumn ? 'Top 10 in GW & Defcon achieved' : 'Defcon achieved (DEF ≥ position threshold)'
    else if (showSavesBadge) title = isTop10ForColumn ? 'Top 10 in GW & Saves achieved (3+)' : 'Saves achieved (3+ saves = 1 pt per 3)'
    return (
      <td key={key} className={`matchup-detail-td matchup-detail-td-stat${isProvisionalBonus ? ' matchup-detail-cell-provisional' : ''}`}>
        {showBadge || isProvisionalBonus ? (
          <span className={badgeClass} title={title}>{displayVal}</span>
        ) : (
          displayVal
        )}
      </td>
    )
  }

  return (
    <div
      className={`matchup-detail-table-wrap${onTableAreaClick ? ' matchup-detail-table-wrap--tap-to-close' : ''}`}
      onClick={onTableAreaClick ? (e) => { e.stopPropagation(); onTableAreaClick() } : undefined}
      role={onTableAreaClick ? 'button' : undefined}
      tabIndex={onTableAreaClick ? 0 : undefined}
      onKeyDown={onTableAreaClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTableAreaClick() } } : undefined}
      aria-label={onTableAreaClick ? 'Tap to close details' : undefined}
    >
      {!hideHeader && (
        <div className="matchup-detail-table-header">
          {teamShortName && (
            <img src={`/badges/${teamShortName}.svg`} alt="" className="matchup-detail-table-badge" onError={e => { e.target.style.display = 'none' }} />
          )}
          <span className="matchup-detail-table-title">{teamName || 'Team'}</span>
        </div>
      )}
      <div ref={tableScrollRef} className="matchup-detail-table-scroll">
        <table className="matchup-detail-table">
          <thead>
            <tr>
              {SORT_COLUMNS.map(({ key, label, type }) => {
                const isPlayer = key === 'player_name'
                const isMins = key === 'minutes'
                const isPts = key === 'points'
                const isStat = !isPlayer && !isMins && !isPts
                const isActive = sortKey === key
                const thClass = [
                  'matchup-detail-th',
                  'matchup-detail-th-sortable',
                  isPlayer && 'matchup-detail-th-player',
                  isMins && 'matchup-detail-th-mins',
                  isPts && 'matchup-detail-th-pts',
                  isStat && 'matchup-detail-th-stat',
                  isActive && 'matchup-detail-th-sorted'
                ].filter(Boolean).join(' ')
                const title = key === 'expected_goals' ? 'Expected goals' : key === 'expected_assists' ? 'Expected assists' : key === 'expected_goal_involvements' ? 'Expected goal involvements' : key === 'expected_goals_conceded' ? 'Expected goals conceded' : `Sort by ${label}`
                return (
                  <th key={key} className={thClass}>
                    <button
                      type="button"
                      className="matchup-detail-th-sort-btn"
                      onClick={(e) => { e.stopPropagation(); handleSort(key) }}
                      title={title}
                      aria-label={`Sort by ${label}${isActive ? `, ${sortDir === 'desc' ? 'descending' : 'ascending'}` : ''}`}
                    >
                      <span className="matchup-detail-th-label">{label}</span>
                      {isActive && (
                        <span className="matchup-detail-th-sort-icon" aria-hidden>
                          {sortDir === 'desc' ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
                        </span>
                      )}
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {displayedPlayers.map(p => {
              const playerId = p.player_id != null ? Number(p.player_id) : null
              const isTop10Pts = playerId != null && top10ByStat?.pts?.has(playerId)
              const isDnp = false
              const isOwnedByYou = ownedPlayerIds != null && playerId != null && ownedPlayerIds.has(playerId)
              const ptsIncludesProvisional = p.bonus_status === 'provisional' && (p.bonus ?? 0) > 0
              return (
                <tr key={p.player_id} className={`matchup-detail-tr ${isDnp ? 'matchup-detail-tr-dnp' : ''}`}>
                  <td className="matchup-detail-td matchup-detail-td-player">
                    {p.player_team_short_name && (
                      <img src={`/badges/${p.player_team_short_name}.svg`} alt="" className="matchup-detail-player-badge" onError={e => { e.target.style.display = 'none' }} />
                    )}
                    <span className={`matchup-detail-player-name${isOwnedByYou ? ' matchup-detail-player-name--owned-by-you' : ''}`} title={p.player_name}>{p.player_name}</span>
                  </td>
                  <td className={`matchup-detail-td matchup-detail-td-mins ${isDnp ? 'matchup-detail-cell-muted' : ''}`}>
                    {isDnp ? (
                      useDashForDnp ? (
                        '–'
                      ) : (
                        <span className="matchup-detail-dnp-badge" title="Did not play">!</span>
                      )
                    ) : (
                      `${p.minutes}'`
                    )}
                  </td>
                  <td
                    className={`matchup-detail-td matchup-detail-td-pts ${!isTop10Pts && p.points === 0 ? 'matchup-detail-cell-muted' : ''}${ptsIncludesProvisional ? ' matchup-detail-cell-provisional' : ''}`}
                    title={ptsIncludesProvisional ? 'Includes provisional bonus (from BPS rank)' : undefined}
                  >
                    {isTop10Pts ? (
                      <span className="matchup-detail-stat-badge matchup-detail-rank-highlight" title="Top 10 in GW for points">
                        {formatNumber(p.points)}
                      </span>
                    ) : (
                      formatNumber(p.points)
                    )}
                  </td>
                  {STAT_KEYS.map(({ key, col }) => renderStatCell(p, { key, col }))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const MOBILE_BREAKPOINT = 768

/** FPL bonus tiebreaker: BPS desc, then goals, assists, clean_sheets. Used to get top 3 / bonus-only list. */
function sortByBpsAndTiebreakers(players) {
  return [...players].sort((a, b) => {
    const bpsA = a.bps ?? 0
    const bpsB = b.bps ?? 0
    if (bpsB !== bpsA) return bpsB - bpsA
    const gA = a.goals_scored ?? 0
    const gB = b.goals_scored ?? 0
    if (gB !== gA) return gB - gA
    const aA = a.assists ?? 0
    const aB = b.assists ?? 0
    if (aB !== aA) return aB - aA
    const csA = a.clean_sheets ?? 0
    const csB = b.clean_sheets ?? 0
    if (csB !== csA) return csB - csA
    return (a.player_name || '').localeCompare(b.player_name || '')
  })
}

/** When bonus view is on: only players in the bonus (1–3 pts from official or BPS top 3). */
function bonusPlayersOnly(merged, isProvisional) {
  if (!merged?.length) return []
  const withBps = merged.filter((p) => (p.bps ?? 0) > 0)
  if (!withBps.length) return []
  const sorted = sortByBpsAndTiebreakers(withBps)
  const hasOfficialBonus = sorted.some((p) => (p.bonus ?? 0) >= 1 && (p.bonus ?? 0) <= 3)
  if (hasOfficialBonus) {
    return sorted.filter((p) => (p.bonus ?? 0) >= 1 && (p.bonus ?? 0) <= 3)
  }
  return sorted.slice(0, 3)
}

function MatchBento({ fixture, expanded, onToggle, top10ByStat, ownedPlayerIds, showBonusChart = false, gameweekMaxBps = null, lastH2HMap = {}, isSecondHalf = false, showH2H = false, lastH2HPlayerStatsByFixture = {}, lastH2HPlayerStatsLoading = false, dataChecked = false }) {
  const { homeTeam, awayTeam, home_score, away_score, kickoff_time, fpl_fixture_id, home_team_id, away_team_id } = fixture
  const gameweek = fixture.gameweek
  const lastH2H = lastH2HMap[pairKey(home_team_id, away_team_id)] ?? null
  const { homePlayers, awayPlayers, loading: statsLoading } = useFixturePlayerStats(
    fpl_fixture_id,
    gameweek,
    home_team_id,
    away_team_id,
    expanded || showBonusChart
  )
  const fixtureStatus = getFixtureStatus(fixture, dataChecked)
  const useH2HStats = isSecondHalf && fixtureStatus === 'scheduled' && expanded
  const fetchReverseStats = useH2HStats && !!lastH2H?.fpl_fixture_id && !!lastH2H?.gameweek
  const { homePlayers: reverseHomePlayers, awayPlayers: reverseAwayPlayers, loading: reverseStatsLoading } = useFixturePlayerStats(
    lastH2H?.fpl_fixture_id ?? null,
    lastH2H?.gameweek ?? null,
    lastH2H?.home_team_id ?? null,
    lastH2H?.away_team_id ?? null,
    !!fetchReverseStats
  )
  const h2hStats = lastH2HPlayerStatsByFixture[fpl_fixture_id]
  const reverseStats = (reverseHomePlayers?.length || reverseAwayPlayers?.length) ? { homePlayers: reverseHomePlayers ?? [], awayPlayers: reverseAwayPlayers ?? [] } : null
  const h2hPlayerSource = useH2HStats ? (h2hStats || reverseStats) : null
  const lastHadSameHome = lastH2H != null && lastH2H.home_team_id === home_team_id
  const displayHomePlayers = h2hPlayerSource
    ? (lastHadSameHome ? (h2hPlayerSource.homePlayers ?? []) : (h2hPlayerSource.awayPlayers ?? []))
    : homePlayers
  const displayAwayPlayers = h2hPlayerSource
    ? (lastHadSameHome ? (h2hPlayerSource.awayPlayers ?? []) : (h2hPlayerSource.homePlayers ?? []))
    : awayPlayers
  const displayStatsLoading = useH2HStats ? (h2hStats ? lastH2HPlayerStatsLoading : reverseStatsLoading) : statsLoading
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth <= MOBILE_BREAKPOINT)
  const mergedPlayersByPoints = useMemo(() => {
    if (!isMobile || !displayHomePlayers?.length && !displayAwayPlayers?.length) return []
    const merged = [...(displayHomePlayers ?? []), ...(displayAwayPlayers ?? [])]
    const seen = new Set()
    const deduped = merged.filter((p) => {
      const id = p.player_id != null ? Number(p.player_id) : null
      if (id == null || seen.has(id)) return false
      seen.add(id)
      return true
    })
    return deduped.sort((a, b) => (b.points ?? 0) - (a.points ?? 0))
  }, [isMobile, displayHomePlayers, displayAwayPlayers])
  const mergedPlayersForBps = useMemo(() => {
    if (!homePlayers?.length && !awayPlayers?.length) return []
    const merged = [...(homePlayers ?? []), ...(awayPlayers ?? [])]
    const seen = new Set()
    return merged.filter((p) => {
      const id = p.player_id != null ? Number(p.player_id) : null
      if (id == null || seen.has(id)) return false
      seen.add(id)
      return true
    })
  }, [homePlayers, awayPlayers])
  const bonusOnlyPlayers = useMemo(() => {
    if (!showBonusChart || !mergedPlayersForBps.length) return []
    return bonusPlayersOnly(mergedPlayersForBps, fixtureStatus === 'live' || fixtureStatus === 'provisional')
  }, [showBonusChart, mergedPlayersForBps, fixtureStatus])

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`)
    const handle = () => setIsMobile(mql.matches)
    mql.addEventListener('change', handle)
    handle()
    return () => mql.removeEventListener('change', handle)
  }, [])

  const status = fixtureStatus
  const hasStarted = fixture.started
  const showH2HScore = isSecondHalf && status === 'scheduled' && expanded && lastH2H
  const h2hHome = showH2HScore && (lastH2H.home_team_id === home_team_id ? lastH2H.home_score : lastH2H.away_score)
  const h2hAway = showH2HScore && (lastH2H.home_team_id === home_team_id ? lastH2H.away_score : lastH2H.home_score)
  const scoreHome = hasStarted ? (home_score ?? 0) : (showH2HScore ? (h2hHome ?? 0) : '—')
  const scoreAway = hasStarted ? (away_score ?? 0) : (showH2HScore ? (h2hAway ?? 0) : '—')
  const scoreIsH2H = showH2HScore && !hasStarted
  const stadiumName = fixture.stadium_name ?? null
  // When showing last H2H, order headline by last meeting: left = home in that fixture (with home icon), right = away
  const headlineLeftTeam = showH2HScore ? (lastH2H.home_team_id === home_team_id ? homeTeam : awayTeam) : homeTeam
  const headlineRightTeam = showH2HScore ? (lastH2H.home_team_id === home_team_id ? awayTeam : homeTeam) : awayTeam
  const headlineLeftScore = showH2HScore ? (lastH2H.home_score ?? '—') : scoreHome
  const headlineRightScore = showH2HScore ? (lastH2H.away_score ?? '—') : scoreAway
  const statusLabel = status === 'live' ? 'Live' : status === 'final' ? 'Final' : status === 'provisional' ? 'Finished' : 'Scheduled'
  const isScheduledWithH2H = status === 'scheduled' && isSecondHalf && lastH2H
  const expandLabelCollapsed = showBonusChart ? 'Show more' : (isScheduledWithH2H ? 'View Last H2H' : 'Show Details')
  const expandLabelExpanded = showBonusChart ? 'Show less' : (isScheduledWithH2H ? 'Hide Last H2H' : 'Hide details')
  const isProvisionalBps = status === 'live' || status === 'provisional'
  const cardClickExpands = !showBonusChart && (status !== 'scheduled' || isScheduledWithH2H)
  const showBpsByDefault = showBonusChart

  return (
    <div
      className={`matchup-card live-matches-view ${status} ${expanded ? 'matchup-card--expanded' : ''} ${showBpsByDefault ? 'matchup-card--bonus-default' : ''}`}
      style={{ cursor: cardClickExpands && !expanded ? 'pointer' : 'default' }}
      onClick={() => cardClickExpands && !expanded && onToggle()}
    >
      <div
        className={`matchup-card-main${expanded ? ' matchup-card-main--tap-to-close' : ''}`}
        onClick={expanded ? (e) => { e.stopPropagation(); onToggle() } : undefined}
        role={expanded ? 'button' : undefined}
        tabIndex={expanded ? 0 : undefined}
        onKeyDown={expanded ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } } : undefined}
        aria-label={expanded ? 'Tap to close details' : undefined}
      >
        <div className="matchup-card-headline">
          <span className="matchup-card-home">
            {headlineLeftTeam?.short_name && (
              <img src={`/badges/${headlineLeftTeam.short_name}.svg`} alt="" className="matchup-card-badge" onError={e => { e.target.style.display = 'none' }} />
            )}
            <span className="matchup-card-team-name" title={headlineLeftTeam?.team_name ?? ''}>{abbreviateTeamName(headlineLeftTeam?.team_name) ?? 'Home'}</span>
            <span className="matchup-card-home-icon" aria-label={showH2HScore ? 'Home in last meeting' : 'Home'}>
              <svg className="matchup-card-home-icon-svg" viewBox="0 0 48 48" width={14} height={14} fill="currentColor" aria-hidden>
                <path d="M39.5,43h-9c-1.381,0-2.5-1.119-2.5-2.5v-9c0-1.105-0.895-2-2-2h-4c-1.105,0-2,0.895-2,2v9c0,1.381-1.119,2.5-2.5,2.5h-9C7.119,43,6,41.881,6,40.5V21.413c0-2.299,1.054-4.471,2.859-5.893L23.071,4.321c0.545-0.428,1.313-0.428,1.857,0L39.142,15.52C40.947,16.942,42,19.113,42,21.411V40.5C42,41.881,40.881,43,39.5,43z" />
              </svg>
            </span>
          </span>
          <span className={`matchup-card-score ${status === 'scheduled' && !showH2HScore ? 'matchup-card-score--tbd' : ''}`}>
            {status === 'scheduled' && !showH2HScore ? (
              <span className="matchup-card-score-tbd">TBD</span>
            ) : (
              <>
                <span className={scoreIsH2H ? 'matchup-card-score-num matchup-card-score-num--h2h' : 'matchup-card-score-num'}>{headlineLeftScore}</span>
                <span className="matchup-card-score-sep">-</span>
                <span className={scoreIsH2H ? 'matchup-card-score-num matchup-card-score-num--h2h' : 'matchup-card-score-num'}>{headlineRightScore}</span>
              </>
            )}
          </span>
          <span className="matchup-card-away">
            {headlineRightTeam?.short_name && (
              <img src={`/badges/${headlineRightTeam.short_name}.svg`} alt="" className="matchup-card-badge" onError={e => { e.target.style.display = 'none' }} />
            )}
            <span className="matchup-card-team-name" title={headlineRightTeam?.team_name ?? ''}>{abbreviateTeamName(headlineRightTeam?.team_name) ?? 'Away'}</span>
          </span>
        </div>
        <div className="matchup-card-status-row">
          <div className={`matchup-card-status matchup-card-status--${status}${status === 'scheduled' && expanded && lastH2H ? ' matchup-card-status--h2h' : ''}`}>
            {status === 'live' && <span className="matchup-card-status-dot" aria-hidden />}
            {status === 'scheduled' && expanded && lastH2H ? `GW${lastH2H.gameweek}` : statusLabel}
          </div>
        </div>
        <div className="matchup-card-meta">
          {stadiumName && <span className="matchup-card-stadium">{stadiumName}</span>}
        </div>
      </div>

      {showBpsByDefault && !expanded && status !== 'scheduled' && (
        <div className="matchup-card-details matchup-card-details--bps-chart matchup-card-details--bonus-default">
          {statsLoading ? (
            <div className="matchup-detail-loading">
              <div className="skeleton-text" />
            </div>
          ) : (
            <div className="bps-chart-wrap">
              <BpsLeadersChart
                players={bonusOnlyPlayers}
                loading={statsLoading}
                gameweekMaxBps={gameweekMaxBps}
                isProvisional={isProvisionalBps}
              />
            </div>
          )}
        </div>
      )}

      {!showBonusChart && !expanded && (status !== 'scheduled' || isScheduledWithH2H) && (
        <button
          type="button"
          className="expand-button"
          onClick={e => { e.stopPropagation(); onToggle() }}
          aria-expanded={expanded}
          aria-label={expandLabelCollapsed}
        >
          <ChevronDown size={14} strokeWidth={2} /> {expandLabelCollapsed}
        </button>
      )}

      {expanded && (
        <div
          className={`${showBonusChart ? 'matchup-card-details matchup-card-details--bps-chart' : 'matchup-card-details matchup-card-details--tables'}${useH2HStats ? ' matchup-card-details--h2h' : ''}`}
          onClick={() => onToggle()}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } }}
          role="button"
          tabIndex={0}
          aria-label="Tap to close details"
        >
          {showBonusChart ? (
            statsLoading ? (
              <div className="matchup-detail-loading">
                <div className="skeleton-text" />
              </div>
            ) : (
              <div className="bps-chart-wrap">
                <BpsLeadersChart
                  players={mergedPlayersForBps}
                  loading={statsLoading}
                  gameweekMaxBps={gameweekMaxBps}
                  isProvisional={isProvisionalBps}
                />
              </div>
            )
          ) : (
            <>
              {displayStatsLoading ? (
              <div className="matchup-detail-loading">
                <div className="skeleton-text" />
              </div>
            ) : isMobile ? (
                <div className="matchup-detail-tables matchup-detail-tables--merged">
                  <MatchPlayerTable
                    players={mergedPlayersByPoints}
                    teamShortName={null}
                    teamName={useH2HStats ? 'Last meeting – by points' : 'By points'}
                    top10ByStat={top10ByStat}
                    hideHeader
                    useDashForDnp={useH2HStats || status === 'scheduled'}
                    onTableAreaClick={onToggle}
                  />
                </div>
              ) : (
                <div className="matchup-detail-tables">
                  <MatchPlayerTable
                    players={displayHomePlayers}
                    teamShortName={homeTeam?.short_name}
                    teamName={homeTeam?.team_name}
                    top10ByStat={top10ByStat}
                    ownedPlayerIds={ownedPlayerIds}
                    useDashForDnp={useH2HStats || status === 'scheduled'}
                    onTableAreaClick={onToggle}
                  />
                  <MatchPlayerTable
                    players={displayAwayPlayers}
                    teamShortName={awayTeam?.short_name}
                    teamName={awayTeam?.team_name}
                    top10ByStat={top10ByStat}
                    ownedPlayerIds={ownedPlayerIds}
                    useDashForDnp={useH2HStats || status === 'scheduled'}
                    onTableAreaClick={onToggle}
                  />
                </div>
              )}
            </>
          )}
        </div>
      )}

      {!showBonusChart && expanded && (
        <button
          type="button"
          className="expand-button"
          onClick={e => { e.stopPropagation(); onToggle() }}
          aria-expanded={expanded}
          aria-label={expandLabelExpanded}
        >
          <ChevronUp size={14} strokeWidth={2} /> {expandLabelExpanded}
        </button>
      )}

      {showBonusChart && status !== 'scheduled' && (
        <button
          type="button"
          className="expand-button"
          onClick={e => { e.stopPropagation(); onToggle() }}
          aria-expanded={expanded}
          aria-label={expanded ? expandLabelExpanded : expandLabelCollapsed}
        >
          {expanded ? (
            <>
              <ChevronUp size={14} strokeWidth={2} /> {expandLabelExpanded}
            </>
          ) : (
            <>
              <ChevronDown size={14} strokeWidth={2} /> {expandLabelCollapsed}
            </>
          )}
        </button>
      )}
    </div>
  )
}

export default function MatchesSubpage({ simulateStatuses = false, toggleBonus = false, showH2H = false } = {}) {
  const [matchupsAnchor, setMatchupsAnchor] = useState('current')
  const { gameweek, loading: gwLoading, dataChecked } = useGameweekData(matchupsAnchor)
  const { fixtures, loading: fixturesLoading } = useFixturesWithTeams(gameweek, { simulateStatuses })
  const { lastH2HMap, isSecondHalf } = useLastH2H(gameweek)
  const { lastH2HPlayerStatsByFixture, loading: lastH2HPlayerStatsLoading } = useLastH2HPlayerStats(gameweek, showH2H && isSecondHalf)
  const { top10ByStat } = useGameweekTop10ByStat()
  const { byStat: topPerformersByStat, isLoading: topPerformersLoading } = useGameweekTopPerformersByStat()
  const { maxBps: gameweekMaxBps } = useGameweekMaxBps(gameweek)
  const { data: currentGameweekPlayers } = useCurrentGameweekPlayers()
  const ownedPlayerIds = useMemo(() => {
    if (!currentGameweekPlayers?.length) return null
    return new Set(currentGameweekPlayers.map(p => Number(p.player_id)).filter(Boolean))
  }, [currentGameweekPlayers])
  const [expandedId, setExpandedId] = useState(null)
  const [isTopPerformersExpanded, setIsTopPerformersExpanded] = useState(false)
  const [performerPageIndex, setPerformerPageIndex] = useState(0)
  const performerSwipeStart = useRef(null)
  const firstScheduledRef = useRef(null)
  const prevShowH2HRef = useRef(false)

  const currentStatKey = TOP_PERFORMERS_STAT_KEYS[performerPageIndex]?.key ?? 'points'
  const currentStatLabel = TOP_PERFORMERS_STAT_KEYS[performerPageIndex]?.label ?? 'Points'
  const currentPerformersList = topPerformersByStat[currentStatKey] ?? []

  const handlePerformerSwipeStart = (e) => {
    performerSwipeStart.current = e.touches?.[0]?.clientX ?? e.clientX
  }
  const handlePerformerSwipeMove = (e) => {}
  const handlePerformerSwipeEnd = (e) => {
    const endX = e.changedTouches?.[0]?.clientX ?? e.clientX
    const startX = performerSwipeStart.current
    if (startX == null) return
    const delta = endX - startX
    const threshold = 50
    if (delta < -threshold) {
      setPerformerPageIndex((i) => Math.min(i + 1, TOP_PERFORMERS_STAT_KEYS.length - 1))
    } else if (delta > threshold) {
      setPerformerPageIndex((i) => Math.max(i - 1, 0))
    }
    performerSwipeStart.current = null
  }

  const sortedFixtures = useMemo(() => {
    if (!fixtures?.length) return []
    return [...fixtures].sort((a, b) => {
      const liveA = getFixtureStatus(a, dataChecked) === 'live' ? 0 : 1
      const liveB = getFixtureStatus(b, dataChecked) === 'live' ? 0 : 1
      if (liveA !== liveB) return liveA - liveB
      return new Date(a.kickoff_time).getTime() - new Date(b.kickoff_time).getTime()
    })
  }, [fixtures, dataChecked])

  const displayedFixtures = useMemo(() => {
    if (showH2H) return sortedFixtures.filter(f => getFixtureStatus(f, dataChecked) === 'scheduled')
    return sortedFixtures
  }, [sortedFixtures, showH2H, dataChecked])

  const firstScheduledIndex = useMemo(() => {
    return sortedFixtures.findIndex(f => getFixtureStatus(f, dataChecked) === 'scheduled')
  }, [sortedFixtures, dataChecked])

  useEffect(() => {
    setExpandedId(null)
  }, [showH2H])

  useEffect(() => {
    setExpandedId(null)
  }, [matchupsAnchor])

  useEffect(() => {
    if (showH2H && !prevShowH2HRef.current && firstScheduledRef.current) {
      firstScheduledRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    prevShowH2HRef.current = showH2H
  }, [showH2H])

  if (gwLoading || !gameweek) {
    return (
      <div className="matches-subpage">
        <div className="matches-subpage-loading">
          <div className="skeleton-text" />
        </div>
      </div>
    )
  }

  return (
    <div className="matches-subpage">
      <div className="matches-subpage-header" role="group" aria-label="Matchups view">
        <div className="matches-anchor-toggle" role="group" aria-label="Gameweek">
          <div
            className="matches-anchor-slider"
            style={{ transform: matchupsAnchor === 'next' ? 'translateX(100%)' : 'translateX(0)' }}
            aria-hidden
          />
          <button
            type="button"
            className={`matches-anchor-btn ${matchupsAnchor === 'current' ? 'matches-anchor-btn--active' : ''}`}
            onClick={() => setMatchupsAnchor('current')}
            aria-pressed={matchupsAnchor === 'current'}
            aria-label="Current gameweek"
          >
            Current
          </button>
          <button
            type="button"
            className={`matches-anchor-btn ${matchupsAnchor === 'next' ? 'matches-anchor-btn--active' : ''}`}
            onClick={() => setMatchupsAnchor('next')}
            aria-pressed={matchupsAnchor === 'next'}
            aria-label="Next gameweek"
          >
            Next
          </button>
        </div>
      </div>
      {fixturesLoading ? (
        <div className="matches-subpage-loading">
          <div className="skeleton-text" />
        </div>
      ) : !fixtures?.length ? (
        <div className="matches-subpage-empty">
          {matchupsAnchor === 'current' ? 'No fixtures for current gameweek' : 'No fixtures for next gameweek'}
        </div>
      ) : (
        <>
          {!toggleBonus && matchupsAnchor === 'current' && (
          <div className={`gw-top-points-card ${isTopPerformersExpanded ? 'gw-top-points-card--expanded' : 'gw-top-points-card--collapsed'}`}>
            <div className="gw-top-points-content">
              <div
                className="gw-top-points-header"
                role="button"
                tabIndex={0}
                onClick={() => setIsTopPerformersExpanded((v) => !v)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setIsTopPerformersExpanded((v) => !v); } }}
                aria-expanded={isTopPerformersExpanded}
                aria-label={isTopPerformersExpanded ? 'Collapse Top Performers' : 'Expand Top Performers'}
              >
                <span className="gw-top-points-title">
                  Top Performers
                  {isTopPerformersExpanded && currentStatLabel ? (
                    <span className="gw-top-points-title-stat"> | {currentStatLabel}</span>
                  ) : null}
                </span>
                <span className="gw-top-points-expand-icon" title={isTopPerformersExpanded ? 'Collapse' : 'Expand'} aria-hidden>
                  {isTopPerformersExpanded ? (
                    <Minimize2 className="gw-top-points-expand-icon-svg" size={11} strokeWidth={1.5} />
                  ) : (
                    <MoveDiagonal className="gw-top-points-expand-icon-svg" size={11} strokeWidth={1.5} />
                  )}
                </span>
              </div>
              {isTopPerformersExpanded && (
                <>
                  {topPerformersLoading ? (
                    <div className="gw-top-points-loading">Loading...</div>
                  ) : !currentPerformersList.length ? (
                    <div className="gw-top-points-empty">No data</div>
                  ) : (
                    <div
                      className="gw-top-performers-swipe-wrap"
                      onTouchStart={handlePerformerSwipeStart}
                      onTouchMove={handlePerformerSwipeMove}
                      onTouchEnd={handlePerformerSwipeEnd}
                    >
                      <div className="gw-top-points-list">
                        {currentPerformersList.map((row) => (
                          <div key={row.player_id} className="gw-top-points-item">
                            <span className="gw-top-points-badge-slot">
                              {row.team_short_name ? (
                                <img
                                  src={`/badges/${row.team_short_name}.svg`}
                                  alt=""
                                  className="gw-top-points-badge"
                                  onError={(e) => { e.target.style.display = 'none' }}
                                />
                              ) : (
                                <span className="gw-top-points-badge-placeholder" aria-hidden />
                              )}
                            </span>
                            <div className="gw-top-points-name-wrap">
                              <span className="gw-top-points-name">{row.player_name}</span>
                              <span
                                className={`gw-top-points-position ${row.position != null ? `gw-top-points-position--${row.position}` : ''}`}
                                title={row.position_label ? `Position: ${row.position_label}` : 'Position'}
                                aria-label={row.position_label || 'Position'}
                              >
                                {row.position_label ?? '—'}
                              </span>
                            </div>
                            <span className="gw-top-points-pill">{typeof row.value === 'string' ? row.value : formatNumber(row.value)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="gw-top-performers-dots" role="tablist" aria-label="Stat pages">
                        {TOP_PERFORMERS_STAT_KEYS.map(({ key, label }, i) => (
                          <button
                            key={key}
                            type="button"
                            role="tab"
                            aria-selected={i === performerPageIndex}
                            aria-label={`${label} (page ${i + 1} of ${TOP_PERFORMERS_STAT_KEYS.length})`}
                            className={`gw-top-performers-dot ${i === performerPageIndex ? 'gw-top-performers-dot--active' : ''}`}
                            onClick={() => setPerformerPageIndex(i)}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
          )}
          <div className="matchup-grid">
          {displayedFixtures.map((f, index) => (
            <div
              key={f.fpl_fixture_id}
              className={expandedId === f.fpl_fixture_id ? 'matchup-grid-item matchup-grid-item--expanded' : 'matchup-grid-item'}
              ref={(showH2H ? index === 0 : index === firstScheduledIndex) ? firstScheduledRef : null}
            >
              <MatchBento
                fixture={f}
                expanded={expandedId === f.fpl_fixture_id}
                onToggle={() => setExpandedId(prev => (prev === f.fpl_fixture_id ? null : f.fpl_fixture_id))}
                top10ByStat={top10ByStat}
                ownedPlayerIds={ownedPlayerIds}
                showBonusChart={toggleBonus}
                gameweekMaxBps={gameweekMaxBps}
                lastH2HMap={lastH2HMap}
                isSecondHalf={isSecondHalf}
                showH2H={showH2H}
                lastH2HPlayerStatsByFixture={lastH2HPlayerStatsByFixture}
                lastH2HPlayerStatsLoading={lastH2HPlayerStatsLoading}
                dataChecked={dataChecked ?? false}
              />
            </div>
          ))}
          </div>
        </>
      )}
    </div>
  )
}
