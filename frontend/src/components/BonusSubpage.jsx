import { useState, useMemo } from 'react'
import { useGameweekData } from '../hooks/useGameweekData'
import { useFixturesWithTeams } from '../hooks/useFixturesWithTeams'
import { useFixturePlayerStats } from '../hooks/useFixturePlayerStats'
import { useGameweekMaxBps } from '../hooks/useGameweekMaxBps'
import BpsLeadersChart from './BpsLeadersChart'
import { abbreviateTeamName } from '../utils/formatDisplay'
import { ChevronDown, ChevronUp } from 'lucide-react'
import './BonusSubpage.css'

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

/* Same as MatchesSubpage: scheduled | live | final | provisional */
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

function BonusBento({ fixture, expanded, onToggle, gameweekMaxBps }) {
  const { homeTeam, awayTeam, home_score, away_score, kickoff_time, fpl_fixture_id, home_team_id, away_team_id } = fixture
  const gameweek = fixture.gameweek
  const { homePlayers, awayPlayers, loading: statsLoading } = useFixturePlayerStats(
    fpl_fixture_id,
    gameweek,
    home_team_id,
    away_team_id,
    expanded
  )

  const mergedPlayers = useMemo(() => {
    if (!homePlayers?.length && !awayPlayers?.length) return []
    return [...(homePlayers ?? []), ...(awayPlayers ?? [])]
  }, [homePlayers, awayPlayers])

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
          className="matchup-card-details matchup-card-details--bps-chart"
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
          ) : (
            <div className="bps-chart-wrap">
              <BpsLeadersChart players={mergedPlayers} loading={statsLoading} gameweekMaxBps={gameweekMaxBps} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function BonusSubpage({ simulateStatuses = false } = {}) {
  const { gameweek, loading: gwLoading } = useGameweekData()
  const { fixtures, loading: fixturesLoading } = useFixturesWithTeams(gameweek, { simulateStatuses })
  const { maxBps: gameweekMaxBps } = useGameweekMaxBps(gameweek)
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
      <div className="bonus-subpage">
        <div className="bonus-subpage-loading">
          <div className="skeleton-text" />
        </div>
      </div>
    )
  }

  return (
    <div className="bonus-subpage">
      {fixturesLoading ? (
        <div className="bonus-subpage-loading">
          <div className="skeleton-text" />
        </div>
      ) : !fixtures?.length ? (
        <div className="bonus-subpage-empty">No fixtures for this gameweek</div>
      ) : (
        <div className="matchup-grid">
          {sortedFixtures.map(f => (
            <BonusBento
              key={f.fpl_fixture_id}
              fixture={f}
              expanded={expandedId === f.fpl_fixture_id}
              onToggle={() => setExpandedId(prev => (prev === f.fpl_fixture_id ? null : f.fpl_fixture_id))}
              gameweekMaxBps={gameweekMaxBps}
            />
          ))}
        </div>
      )}
    </div>
  )
}
