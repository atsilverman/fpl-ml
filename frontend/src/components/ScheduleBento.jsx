import { useRef } from 'react'
import { useScheduleData } from '../hooks/useScheduleData'
import { useAxisLockedScroll } from '../hooks/useAxisLockedScroll'
import './ScheduleSubpage.css'
import './ScheduleBento.css'

function OpponentPill({ opponent }) {
  if (!opponent) return null
  const short = opponent.short_name ?? '?'
  const display = opponent.isHome ? (short || '?').toUpperCase() : (short || '?').toLowerCase()

  return (
    <div
      className="schedule-bento-fixture schedule-bento-opponent-pill"
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

export default function ScheduleBento({ teamId }) {
  const { scheduleMatrix, gameweeks, loading } = useScheduleData()
  const scrollRef = useRef(null)
  useAxisLockedScroll(scrollRef)

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
    <div className="schedule-bento bento-card bento-card-animate">
      <span className="bento-card-label schedule-bento-label">Schedule</span>
      <div ref={scrollRef} className="schedule-bento-scroll">
        <div className="schedule-bento-timeline">
          {gameweeks.map((gw) => {
            const opponents = getOpponents(teamId, gw.id) ?? []
            if (opponents.length === 0) return null
            return (
              <div key={gw.id} className="schedule-bento-gw-column">
                <div className="schedule-bento-gw-heading">GW{gw.id}</div>
                <div className="schedule-bento-gw-fixtures">
                  {opponents.map((opp, idx) => (
                    <OpponentPill key={`${opp.team_id}-${idx}`} opponent={opp} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
