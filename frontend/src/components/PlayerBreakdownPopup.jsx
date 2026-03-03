import { useMemo } from 'react'
import { X, RectangleVertical, Clock } from 'lucide-react'
import { usePlayerGameweekStats } from '../hooks/usePlayerGameweekStats'
import { usePlayerFixtureForGameweek } from '../hooks/usePlayerFixtureForGameweek'
import { getPointsImpactEvents } from './PlayerDetailModal'
import './MiniLeaguePage.css'

const POSITION_LABELS = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' }

/**
 * Popup: Gameweek points breakdown + "Show Player Details" button.
 * Use before opening full PlayerDetailModal (e.g. from home GW points table, manager detail table, Stats subpage).
 */
export default function PlayerBreakdownPopup({ playerId, playerName, position, gameweek, teamShortName, onShowFullDetail, onClose }) {
  const { stats: gwStats, loading } = usePlayerGameweekStats(playerId, gameweek)
  const { fixture: playerFixture, loading: fixtureLoading } = usePlayerFixtureForGameweek(null, gameweek, playerId)
  const events = useMemo(() => getPointsImpactEvents(gwStats, position), [gwStats, position])
  const total = gwStats != null ? (gwStats.effective_points ?? gwStats.points ?? 0) : events.reduce((s, e) => s + e.pts, 0)
  const positionLabel = position != null ? (POSITION_LABELS[position] ?? '—') : null

  const formatKickoff = (iso) => {
    if (!iso) return null
    try {
      const d = new Date(iso)
      if (Number.isNaN(d.getTime())) return null
      const day = d.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase().slice(0, 3)
      const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: false })
      return `${day} ${time}`
    } catch { return null }
  }

  return (
    <div className="stats-filter-overlay player-breakdown-popup-overlay" role="dialog" aria-modal="true" aria-label={playerName ? `${playerName} – Gameweek Points` : 'Gameweek Points'}>
      <div className="stats-filter-overlay-backdrop" onClick={onClose} aria-hidden />
      <div className="stats-filter-overlay-panel stats-player-breakdown-panel">
        <div className="stats-filter-overlay-header player-breakdown-popup-header">
          <div className="player-breakdown-popup-header-top">
            <div className="player-breakdown-popup-player-row">
              {teamShortName && (
                <img
                  src={`/badges/${teamShortName}.svg`}
                  alt=""
                  className="player-breakdown-popup-badge"
                  onError={(e) => { e.target.style.display = 'none' }}
                />
              )}
              <span className="player-breakdown-popup-name">{playerName || 'Player'}</span>
              {positionLabel && (
                <span className="player-breakdown-popup-position-pill">{positionLabel}</span>
              )}
            </div>
            <button type="button" className="stats-filter-overlay-close" onClick={onClose} aria-label="Close">
              <X size={20} strokeWidth={2} />
            </button>
          </div>
        </div>
        <div className="stats-filter-overlay-body">
          {loading ? (
            <div className="player-breakdown-popup-empty-wrap">
              <div className="player-detail-points-impact-empty">Loading…</div>
            </div>
          ) : events.length === 0 ? (
            <div className="player-breakdown-popup-empty-wrap">
            {(() => {
              const matchStarted = playerFixture?.started === true || playerFixture?.started === 'true'
              const matchFinished = playerFixture?.finished === true || playerFixture?.finished === 'true' || playerFixture?.finished_provisional === true || playerFixture?.finished_provisional === 'true'
              const mins = gwStats?.minutes != null ? Number(gwStats.minutes) : null
              const isDnp = matchFinished && mins === 0
              const kickoffStr = !fixtureLoading && playerFixture && !matchStarted ? formatKickoff(playerFixture.kickoff_time) : null
              if (kickoffStr) {
                return (
                  <div className="player-detail-points-impact-empty player-detail-points-impact-empty--kickoff" title={`Kickoff ${kickoffStr} (local)`}>
                    <Clock className="player-detail-points-impact-kickoff-icon" size={14} strokeWidth={2} aria-hidden />
                    <span className="player-detail-points-impact-kickoff-label">Kickoff</span>
                    <span className="player-detail-points-impact-kickoff-time">{kickoffStr}</span>
                  </div>
                )
              }
              if (isDnp) {
                return (
                  <div className="player-detail-points-impact-empty player-detail-points-impact-empty--dnp" title="Did not play">
                    <span className="player-detail-points-impact-dnp-badge" aria-hidden>!</span>
                    <span className="player-detail-points-impact-dnp-text">Did not play</span>
                  </div>
                )
              }
              return <div className="player-detail-points-impact-empty">No points this gameweek</div>
            })()}
            </div>
          ) : (
            <>
              <div className="player-detail-points-impact-list">
                {events.map((ev, i) => (
                  <div
                    key={i}
                    className={`player-detail-points-impact-row${ev.provisional ? ' player-detail-points-impact-row--provisional' : ''}${ev.feint ? ' player-detail-points-impact-row--feint' : ''}`}
                  >
                    <span className="player-detail-points-impact-label">
                      {ev.icon === 'yc' && (
                        <RectangleVertical className="player-detail-points-impact-icon player-detail-points-impact-icon--yc" width={11} height={16} strokeWidth={0} fill="currentColor" aria-hidden />
                      )}
                      {ev.icon === 'rc' && (
                        <RectangleVertical className="player-detail-points-impact-icon player-detail-points-impact-icon--rc" width={11} height={16} strokeWidth={0} fill="currentColor" aria-hidden />
                      )}
                      {ev.label}
                    </span>
                    <span className={`player-detail-points-impact-pts ${ev.pts >= 0 ? 'positive' : 'negative'}${ev.feint ? ' player-detail-points-impact-pts--feint' : ''}`}>
                      {ev.pts >= 0 ? '+' : ''}{ev.pts}
                    </span>
                  </div>
                ))}
              </div>
              <div className="player-detail-points-impact-total">
                <span className="player-detail-points-impact-total-label">Total points</span>
                <span className="player-detail-points-impact-total-value">{total}</span>
              </div>
            </>
          )}
        </div>
        <div className="stats-filter-overlay-footer">
          <button type="button" className="stats-filter-overlay-done" onClick={onShowFullDetail} aria-label="Show player details">
            Show Player Details
          </button>
        </div>
      </div>
    </div>
  )
}
