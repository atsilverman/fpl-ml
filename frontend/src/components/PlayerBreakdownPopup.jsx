import { useMemo } from 'react'
import { X, RectangleVertical } from 'lucide-react'
import { usePlayerGameweekStats } from '../hooks/usePlayerGameweekStats'
import { getPointsImpactEvents } from './PlayerDetailModal'
import './MiniLeaguePage.css'

/**
 * Popup: Gameweek points breakdown + "Show Player Details" button.
 * Use before opening full PlayerDetailModal (e.g. from home GW points table, manager detail table, Stats subpage).
 */
export default function PlayerBreakdownPopup({ playerId, playerName, position, gameweek, onShowFullDetail, onClose }) {
  const { stats: gwStats, loading } = usePlayerGameweekStats(playerId, gameweek)
  const events = useMemo(() => getPointsImpactEvents(gwStats, position), [gwStats, position])
  const total = gwStats != null ? (gwStats.effective_points ?? gwStats.points ?? 0) : events.reduce((s, e) => s + e.pts, 0)

  return (
    <div className="stats-filter-overlay player-breakdown-popup-overlay" role="dialog" aria-modal="true" aria-label="Gameweek Points">
      <div className="stats-filter-overlay-backdrop" onClick={onClose} aria-hidden />
      <div className="stats-filter-overlay-panel stats-player-breakdown-panel">
        <div className="stats-filter-overlay-header">
          <span className="stats-filter-overlay-title">Gameweek Points</span>
          <button type="button" className="stats-filter-overlay-close" onClick={onClose} aria-label="Close">
            <X size={20} strokeWidth={2} />
          </button>
        </div>
        <div className="stats-filter-overlay-body">
          {loading ? (
            <div className="player-detail-points-impact-empty">Loading…</div>
          ) : events.length === 0 ? (
            <div className="player-detail-points-impact-empty">No points this gameweek</div>
          ) : (
            <>
              <div className="player-detail-points-impact-list">
                {events.map((ev, i) => (
                  <div
                    key={i}
                    className={`player-detail-points-impact-row${ev.provisional ? ' player-detail-points-impact-row--provisional' : ''}`}
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
                    <span className={`player-detail-points-impact-pts ${ev.pts >= 0 ? 'positive' : 'negative'}`}>
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
