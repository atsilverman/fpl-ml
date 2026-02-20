import { useRef } from 'react'
import { useScheduleData } from '../hooks/useScheduleData'
import { useAxisLockedScroll } from '../hooks/useAxisLockedScroll'
import './ScheduleSubpage.css'
import './ScheduleBento.css'

function ordinal(n) {
  if (n == null || n < 1) return '—'
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

function getEffectiveStrength(apiStrength, overrides, teamId) {
  const override = overrides && teamId != null ? overrides[String(teamId)] ?? overrides[teamId] : undefined
  const raw = override != null ? Number(override) : apiStrength
  if (raw == null || Number.isNaN(raw)) return null
  return Math.min(5, Math.max(1, raw))
}

function OpponentPill({ opponent, difficultyStrength }) {
  if (!opponent) return null
  const short = opponent.short_name ?? '?'
  const display = opponent.isHome ? (short || '?').toUpperCase() : (short || '?').toLowerCase()
  const strengthClass =
    difficultyStrength != null && difficultyStrength >= 1 && difficultyStrength <= 5
      ? ` schedule-bento-opponent-pill--${difficultyStrength}`
      : ''

  return (
    <div
      className={`schedule-bento-fixture schedule-bento-opponent-pill${strengthClass}`}
      title={opponent.team_name ?? short}
    >
      <span className={`schedule-bento-side ${opponent.isHome ? 'schedule-bento-side-home' : 'schedule-bento-side-away'}`}>
        <span className="schedule-cell-badge-slot schedule-bento-pill-badge-slot">
          {short && short !== '?' ? (
            <img
              src={`/badges/${short}.svg`}
              alt=""
              className="schedule-cell-badge schedule-bento-pill-badge"
              onError={(e) => { e.target.style.display = 'none' }}
            />
          ) : (
            <span className="schedule-cell-badge-placeholder schedule-bento-pill-badge-placeholder" aria-hidden />
          )}
        </span>
        <span className="schedule-bento-abbr-row">
          <span className={`schedule-cell-abbr-display ${opponent.isHome ? 'schedule-cell-home' : 'schedule-cell-away'}`}>{display}</span>
          {opponent.isHome && (
            <svg className="schedule-cell-home-indicator schedule-bento-home-icon" width="10" height="10" viewBox="0 0 48 48" fill="currentColor" aria-label="Home" title="Home">
              <path d="M39.5,43h-9c-1.381,0-2.5-1.119-2.5-2.5v-9c0-1.105-0.895-2-2-2h-4c-1.105,0-2,0.895-2,2v9c0,1.381-1.119,2.5-2.5,2.5h-9C7.119,43,6,41.881,6,40.5V21.413c0-2.299,1.054-4.471,2.859-5.893L23.071,4.321c0.545-0.428,1.313-0.428,1.857,0L39.142,15.52C40.947,16.942,42,19.113,42,21.411V40.5C42,41.881,40.881,43,39.5,43z" />
            </svg>
          )}
        </span>
      </span>
    </div>
  )
}

function OpponentStatsLast6({ stats, loading }) {
  if (loading || !stats) return null
  return (
    <div className="schedule-bento-opponent-stats" aria-label="Opponent form last 6 gameweeks">
      <div className="schedule-bento-opponent-stat-row">
        <span className="schedule-bento-opponent-stat-label">GC</span>
        <span className="schedule-bento-opponent-stat-value">
          {stats.goalsConceded != null ? stats.goalsConceded : '—'}
          {stats.rankGoalsConceded != null && <span className="schedule-bento-opponent-stat-rank"> ({ordinal(stats.rankGoalsConceded)})</span>}
        </span>
      </div>
      <div className="schedule-bento-opponent-stat-row">
        <span className="schedule-bento-opponent-stat-label">xGC</span>
        <span className="schedule-bento-opponent-stat-value">
          {stats.xgc != null ? stats.xgc.toFixed(1) : '—'}
          {stats.rankXgc != null && <span className="schedule-bento-opponent-stat-rank"> ({ordinal(stats.rankXgc)})</span>}
        </span>
      </div>
      <div className="schedule-bento-opponent-stat-row">
        <span className="schedule-bento-opponent-stat-label">G</span>
        <span className="schedule-bento-opponent-stat-value">
          {stats.goals != null ? stats.goals : '—'}
          {stats.rankGoals != null && <span className="schedule-bento-opponent-stat-rank"> ({ordinal(stats.rankGoals)})</span>}
        </span>
      </div>
      <div className="schedule-bento-opponent-stat-row">
        <span className="schedule-bento-opponent-stat-label">xG</span>
        <span className="schedule-bento-opponent-stat-value">
          {stats.xg != null ? stats.xg.toFixed(1) : '—'}
          {stats.rankXg != null && <span className="schedule-bento-opponent-stat-rank"> ({ordinal(stats.rankXg)})</span>}
        </span>
      </div>
      <div className="schedule-bento-opponent-stat-row">
        <span className="schedule-bento-opponent-stat-label">CS</span>
        <span className="schedule-bento-opponent-stat-value">
          {stats.cleanSheets != null ? stats.cleanSheets : '—'}
          {stats.rankCleanSheets != null && <span className="schedule-bento-opponent-stat-rank"> ({ordinal(stats.rankCleanSheets)})</span>}
        </span>
      </div>
    </div>
  )
}

export default function ScheduleBento({
  teamId,
  opponentStatsByTeamId = null,
  opponentStatsLoading = false,
  difficultyOverridesByDimension = null,
  useCustomDifficulty = false,
}) {
  const { scheduleMatrix, gameweeks, loading } = useScheduleData()
  const scrollRef = useRef(null)
  useAxisLockedScroll(scrollRef)
  const showOpponentStats = opponentStatsByTeamId != null
  const overallOverrides = difficultyOverridesByDimension?.overall ?? null

  if (loading) {
    return (
      <div className="schedule-bento bento-card bento-card-animate">
        <span className="bento-card-label schedule-bento-label">Schedule</span>
        <div className="schedule-bento-loading">Loading schedule…</div>
      </div>
    )
  }

  if (teamId == null) {
    return (
      <div className="schedule-bento bento-card bento-card-animate">
        <span className="bento-card-label schedule-bento-label">Schedule</span>
        <div className="schedule-bento-empty">No team selected.</div>
      </div>
    )
  }

  const { getOpponents } = scheduleMatrix
  const hasAny = gameweeks.some((gw) => (getOpponents(teamId, gw.id) ?? []).length > 0)
  if (!hasAny) {
    return (
      <div className="schedule-bento bento-card bento-card-animate">
        <span className="bento-card-label schedule-bento-label">Schedule</span>
        <div className="schedule-bento-empty">No upcoming gameweeks.</div>
      </div>
    )
  }

  return (
    <div className={`schedule-bento bento-card bento-card-animate${showOpponentStats ? ' schedule-bento--with-opponent-stats' : ''}`}>
      <span className="bento-card-label schedule-bento-label">Schedule</span>
      <div ref={scrollRef} className="schedule-bento-scroll">
        <div className="schedule-bento-timeline">
          {gameweeks.map((gw) => {
            const opponents = getOpponents(teamId, gw.id) ?? []
            const isBlank = opponents.length === 0
            return (
              <div key={gw.id} className="schedule-bento-gw-column">
                <div className="schedule-bento-gw-heading">GW{gw.id}</div>
                <div className="schedule-bento-gw-fixtures">
                  {isBlank ? (
                    <span className="schedule-bento-blank" aria-label="Blank gameweek">—</span>
                  ) : (
                    opponents.map((opp, idx) => {
                      const baseDifficulty = opp.difficulty ?? opp.strength
                      const difficultyStrength =
                        useCustomDifficulty
                          ? getEffectiveStrength(baseDifficulty, overallOverrides, opp.team_id)
                          : baseDifficulty != null
                            ? Math.min(5, Math.max(1, baseDifficulty))
                            : null
                      const fixtureDifficultyClass = difficultyStrength != null && difficultyStrength >= 1 && difficultyStrength <= 5 ? ` schedule-bento-fixture--difficulty-${difficultyStrength}` : ''
                      return (
                      <div key={`${opp.team_id}-${idx}`} className={`schedule-bento-gw-fixture${fixtureDifficultyClass}`}>
                        <OpponentPill opponent={opp} difficultyStrength={difficultyStrength} />
                      </div>
                    )})
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
