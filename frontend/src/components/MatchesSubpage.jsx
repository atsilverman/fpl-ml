import { useState, useMemo, useEffect } from 'react'
import { useGameweekData } from '../hooks/useGameweekData'
import { useFixturesWithTeams } from '../hooks/useFixturesWithTeams'
import { useFixturePlayerStats } from '../hooks/useFixturePlayerStats'
import { useGameweekTop10ByStat } from '../hooks/useGameweekTop10ByStat'
import { useCurrentGameweekPlayers } from '../hooks/useCurrentGameweekPlayers'
import { formatNumber } from '../utils/formatNumbers'
import { abbreviateTeamName } from '../utils/formatDisplay'
import { ChevronDown, ChevronUp } from 'lucide-react'
import './MatchesSubpage.css'

function formatKickoffLocal(isoString) {
  if (!isoString) return '—'
  try {
    const d = new Date(isoString)
    const datePart = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    const timePart = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true })
    return `${datePart} • ${timePart}`
  } catch {
    return '—'
  }
}

function getFixtureStatus(fixture) {
  if (!fixture) return 'scheduled'
  const started = Boolean(fixture.started)
  const finished = Boolean(fixture.finished)
  const finishedProvisional = Boolean(fixture.finished_provisional)
  if (!started) return 'scheduled'
  if (started && !finished && !finishedProvisional) return 'live'
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

const EXPECTED_STAT_KEYS = ['expected_goals', 'expected_assists', 'expected_goal_involvements', 'expected_goals_conceded']

function formatExpected(v) {
  const n = Number(v)
  if (n === 0) return '0'
  return n.toFixed(2)
}

function MatchPlayerTable({ players, teamShortName, teamName, top10ByStat, ownedPlayerIds, hideHeader = false }) {
  if (!players?.length) {
    return (
      <div className="matchup-detail-table-wrap">
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
      showSavesBadge && 'matchup-detail-saves-achieved'
    ].filter(Boolean).join(' ')
    let title = `Top 10 in GW for ${key}`
    if (showDefconBadge) title = isTop10ForColumn ? 'Top 10 in GW & Defcon achieved' : 'Defcon achieved (DEF ≥ position threshold)'
    else if (showSavesBadge) title = isTop10ForColumn ? 'Top 10 in GW & Saves achieved (3+)' : 'Saves achieved (3+ saves = 1 pt per 3)'
    return (
      <td key={key} className="matchup-detail-td matchup-detail-td-stat">
        {showBadge ? (
          <span className={badgeClass} title={title}>{displayVal}</span>
        ) : (
          displayVal
        )}
      </td>
    )
  }

  return (
    <div className="matchup-detail-table-wrap">
      {!hideHeader && (
        <div className="matchup-detail-table-header">
          {teamShortName && (
            <img src={`/badges/${teamShortName}.svg`} alt="" className="matchup-detail-table-badge" onError={e => { e.target.style.display = 'none' }} />
          )}
          <span className="matchup-detail-table-title">{teamName || 'Team'}</span>
        </div>
      )}
      <div className="matchup-detail-table-scroll">
        <table className="matchup-detail-table">
          <thead>
            <tr>
              <th className="matchup-detail-th matchup-detail-th-player">Player</th>
              <th className="matchup-detail-th matchup-detail-th-mins">MP</th>
              <th className="matchup-detail-th matchup-detail-th-pts">PTS</th>
              <th className="matchup-detail-th matchup-detail-th-stat">G</th>
              <th className="matchup-detail-th matchup-detail-th-stat">A</th>
              <th className="matchup-detail-th matchup-detail-th-stat">CS</th>
              <th className="matchup-detail-th matchup-detail-th-stat">S</th>
              <th className="matchup-detail-th matchup-detail-th-stat">BPS</th>
              <th className="matchup-detail-th matchup-detail-th-stat">B</th>
              <th className="matchup-detail-th matchup-detail-th-stat">DEF</th>
              <th className="matchup-detail-th matchup-detail-th-stat">YC</th>
              <th className="matchup-detail-th matchup-detail-th-stat">RC</th>
              <th className="matchup-detail-th matchup-detail-th-stat" title="Expected goals">xG</th>
              <th className="matchup-detail-th matchup-detail-th-stat" title="Expected assists">xA</th>
              <th className="matchup-detail-th matchup-detail-th-stat" title="Expected goal involvements">xGI</th>
              <th className="matchup-detail-th matchup-detail-th-stat" title="Expected goals conceded">xGC</th>
            </tr>
          </thead>
          <tbody>
            {players.map(p => {
              const playerId = p.player_id != null ? Number(p.player_id) : null
              const isTop10Pts = playerId != null && top10ByStat?.pts?.has(playerId)
              const isDnp = p.minutes == null || p.minutes === 0
              const isOwnedByYou = ownedPlayerIds != null && playerId != null && ownedPlayerIds.has(playerId)
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
                      <span className="matchup-detail-dnp-badge" title="Did not play">!</span>
                    ) : (
                      `${p.minutes}'`
                    )}
                  </td>
                  <td className={`matchup-detail-td matchup-detail-td-pts ${!isTop10Pts && p.points === 0 ? 'matchup-detail-cell-muted' : ''}`}>
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

function MatchBento({ fixture, expanded, onToggle, top10ByStat, ownedPlayerIds }) {
  const { homeTeam, awayTeam, home_score, away_score, kickoff_time, fpl_fixture_id, home_team_id, away_team_id } = fixture
  const gameweek = fixture.gameweek
  const { homePlayers, awayPlayers, loading: statsLoading } = useFixturePlayerStats(
    fpl_fixture_id,
    gameweek,
    home_team_id,
    away_team_id,
    expanded
  )
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth <= MOBILE_BREAKPOINT)
  const mergedPlayersByPoints = useMemo(() => {
    if (!isMobile || !homePlayers?.length && !awayPlayers?.length) return []
    const merged = [...(homePlayers ?? []), ...(awayPlayers ?? [])]
    return merged.sort((a, b) => (b.points ?? 0) - (a.points ?? 0))
  }, [isMobile, homePlayers, awayPlayers])

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`)
    const handle = () => setIsMobile(mql.matches)
    mql.addEventListener('change', handle)
    handle()
    return () => mql.removeEventListener('change', handle)
  }, [])

  const status = getFixtureStatus(fixture)
  const hasStarted = fixture.started
  const scoreHome = hasStarted ? (home_score ?? 0) : '—'
  const scoreAway = hasStarted ? (away_score ?? 0) : '—'
  const stadiumName = fixture.stadium_name ?? null
  const statusLabel = status === 'live' ? 'Live' : status === 'final' ? 'Final' : status === 'provisional' ? 'Finished' : 'Scheduled'

  return (
    <div
      className={`matchup-card live-matches-view ${status} ${expanded ? 'matchup-card--expanded' : ''}`}
      style={{ cursor: expanded ? 'default' : 'pointer' }}
      onClick={() => !expanded && onToggle()}
    >
      <div className="matchup-card-main">
        <div className="matchup-card-headline">
          <span className="matchup-card-home">
            {homeTeam?.short_name && (
              <img src={`/badges/${homeTeam.short_name}.svg`} alt="" className="matchup-card-badge" onError={e => { e.target.style.display = 'none' }} />
            )}
            <span className="matchup-card-team-name" title={homeTeam?.team_name ?? ''}>{abbreviateTeamName(homeTeam?.team_name) ?? 'Home'}</span>
            <span className="matchup-card-home-icon" aria-label="Home">
              <svg className="matchup-card-home-icon-svg" viewBox="0 0 48 48" width={14} height={14} fill="currentColor" aria-hidden>
                <path d="M39.5,43h-9c-1.381,0-2.5-1.119-2.5-2.5v-9c0-1.105-0.895-2-2-2h-4c-1.105,0-2,0.895-2,2v9c0,1.381-1.119,2.5-2.5,2.5h-9C7.119,43,6,41.881,6,40.5V21.413c0-2.299,1.054-4.471,2.859-5.893L23.071,4.321c0.545-0.428,1.313-0.428,1.857,0L39.142,15.52C40.947,16.942,42,19.113,42,21.411V40.5C42,41.881,40.881,43,39.5,43z" />
              </svg>
            </span>
          </span>
          <span className="matchup-card-score">
            {scoreHome} <span className="matchup-card-score-sep">-</span> {scoreAway}
          </span>
          <span className="matchup-card-away">
            {awayTeam?.short_name && (
              <img src={`/badges/${awayTeam.short_name}.svg`} alt="" className="matchup-card-badge" onError={e => { e.target.style.display = 'none' }} />
            )}
            <span className="matchup-card-team-name" title={awayTeam?.team_name ?? ''}>{abbreviateTeamName(awayTeam?.team_name) ?? 'Away'}</span>
          </span>
        </div>
        <div className={`matchup-card-status matchup-card-status--${status}`}>
          {status === 'live' && <span className="matchup-card-status-dot" aria-hidden />}
          {statusLabel}
        </div>
        <div className="matchup-card-meta">
          {status === 'scheduled' && (
            <span className="matchup-card-kickoff">{formatKickoffLocal(kickoff_time)}</span>
          )}
          {stadiumName && <span className="matchup-card-stadium">{stadiumName}</span>}
        </div>
      </div>
      <button
        type="button"
        className="expand-button"
        onClick={e => { e.stopPropagation(); onToggle() }}
        aria-expanded={expanded}
        aria-label={expanded ? 'Show less' : 'Show more'}
      >
        {expanded ? (
          <>
            <ChevronUp size={14} strokeWidth={2} /> Hide details
          </>
        ) : (
          <>
            <ChevronDown size={14} strokeWidth={2} /> Show Details
          </>
        )}
      </button>
      {expanded && (
        <div
          className="matchup-card-details"
          onClick={() => onToggle()}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } }}
          role="button"
          tabIndex={0}
          aria-label="Tap to close details"
        >
          {statsLoading ? (
            <div className="matchup-detail-loading">
              <div className="skeleton-text" />
            </div>
          ) : isMobile ? (
            <div className="matchup-detail-tables matchup-detail-tables--merged">
              <MatchPlayerTable
                players={mergedPlayersByPoints}
                teamShortName={null}
                teamName="By points"
                top10ByStat={top10ByStat}
                hideHeader
              />
            </div>
          ) : (
            <div className="matchup-detail-tables">
              <MatchPlayerTable
                players={homePlayers}
                teamShortName={homeTeam?.short_name}
                teamName={homeTeam?.team_name}
                top10ByStat={top10ByStat}
                ownedPlayerIds={ownedPlayerIds}
              />
              <MatchPlayerTable
                players={awayPlayers}
                teamShortName={awayTeam?.short_name}
                teamName={awayTeam?.team_name}
                top10ByStat={top10ByStat}
                ownedPlayerIds={ownedPlayerIds}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function MatchesSubpage({ simulateStatuses = false } = {}) {
  const { gameweek, loading: gwLoading } = useGameweekData()
  const { fixtures, loading: fixturesLoading } = useFixturesWithTeams(gameweek, { simulateStatuses })
  const { top10ByStat } = useGameweekTop10ByStat()
  const { data: currentGameweekPlayers } = useCurrentGameweekPlayers()
  const ownedPlayerIds = useMemo(() => {
    if (!currentGameweekPlayers?.length) return null
    return new Set(currentGameweekPlayers.map(p => Number(p.player_id)).filter(Boolean))
  }, [currentGameweekPlayers])
  const [expandedId, setExpandedId] = useState(null)

  const sortedFixtures = useMemo(() => {
    if (!fixtures?.length) return []
    return [...fixtures].sort((a, b) => {
      const liveA = getFixtureStatus(a) === 'live' ? 0 : 1
      const liveB = getFixtureStatus(b) === 'live' ? 0 : 1
      if (liveA !== liveB) return liveA - liveB
      return new Date(a.kickoff_time).getTime() - new Date(b.kickoff_time).getTime()
    })
  }, [fixtures])

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
      {fixturesLoading ? (
        <div className="matches-subpage-loading">
          <div className="skeleton-text" />
        </div>
      ) : !fixtures?.length ? (
        <div className="matches-subpage-empty">No fixtures for this gameweek</div>
      ) : (
        <div className="matchup-grid">
          {sortedFixtures.map(f => (
            <MatchBento
              key={f.fpl_fixture_id}
              fixture={f}
              expanded={expandedId === f.fpl_fixture_id}
              onToggle={() => setExpandedId(prev => (prev === f.fpl_fixture_id ? null : f.fpl_fixture_id))}
              top10ByStat={top10ByStat}
              ownedPlayerIds={ownedPlayerIds}
            />
          ))}
        </div>
      )}
    </div>
  )
}
