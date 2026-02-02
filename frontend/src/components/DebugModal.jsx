import { useState, useRef, useEffect } from 'react'
import { Info } from 'lucide-react'
import { useGameweekDebugData } from '../hooks/useGameweekDebugData'
import { useUpdateTimestamps } from '../hooks/useUpdateTimestamps'
import { useRefreshState } from '../hooks/useRefreshState'
import './ConfigurationModal.css'
import './BentoCard.css'
import './DebugModal.css'

const STATE_DEBUG_DEFINITIONS = [
  { term: 'Live', description: 'At least one fixture: started and not finished_provisional.' },
  { term: 'Bonus Pending', description: 'All fixtures: finished_provisional and not finished.' },
  { term: 'Price Window', description: 'Time is in 17:30–17:36 PST (configurable).' },
  { term: 'Deadline', description: 'Current GW exists, ≥30 min after GW deadline (post-deadline refresh window).' },
  { term: 'Idle', description: 'Current GW with no live/bonus/price/deadline conditions, or no current gameweek in DB (outside GW).' }
]

function formatDeadlineGw(iso) {
  if (!iso) return '—'
  try {
    const d = new Date(iso.replace('Z', '+00:00'))
    return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return '—'
  }
}

function GwDebugBadge({ value }) {
  const isTrue = value === true
  return (
    <span className={`gw-debug-badge gw-debug-badge--${isTrue ? 'true' : 'false'}`}>
      {isTrue ? 'true' : 'false'}
    </span>
  )
}

export default function DebugModal({ isOpen, onClose }) {
  const { gameweekRow: gameweekDebugRow, fixtures: gameweekDebugFixtures, loading: gameweekDebugLoading } = useGameweekDebugData()
  const updateTimestampsData = useUpdateTimestamps()
  const { stateLabel } = useRefreshState()
  const [showStateCriteria, setShowStateCriteria] = useState(false)
  const stateCriteriaRef = useRef(null)

  useEffect(() => {
    if (!showStateCriteria) return
    const handleClickOutside = (e) => {
      if (stateCriteriaRef.current && !stateCriteriaRef.current.contains(e.target)) {
        setShowStateCriteria(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showStateCriteria])

  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content debug-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Debug</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="modal-body debug-modal-body">
          <section className="debug-modal-section debug-modal-section-state" ref={stateCriteriaRef}>
            <h3 className="debug-modal-section-title">State</h3>
            <div className="debug-modal-state-row">
              <button
                type="button"
                className="debug-modal-state-button"
                aria-label="Refresh state"
              >
                STATE {stateLabel ?? '—'}
              </button>
              <button
                type="button"
                className="debug-modal-state-info"
                title="State criteria"
                onClick={() => setShowStateCriteria((v) => !v)}
                aria-expanded={showStateCriteria}
                aria-haspopup="dialog"
              >
                <Info size={14} strokeWidth={1.5} aria-hidden />
              </button>
            </div>
            {showStateCriteria && (
              <dl className="state-debug-dl debug-modal-state-dl">
                {STATE_DEBUG_DEFINITIONS.map(({ term, description }) => (
                  <div key={term} className="state-debug-dl-row">
                    <dt>{term}</dt>
                    <dd>{description}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>

          <section className="debug-modal-section">
            <h3 className="debug-modal-section-title">GW Debug</h3>
            <div className="gw-debug-bento-content">
              {gameweekDebugLoading ? (
                <div className="bento-card-value loading">
                  <div className="skeleton-text" />
                </div>
              ) : !gameweekDebugRow ? (
                <div className="gw-debug-empty">No current gameweek</div>
              ) : (
                <table className="gw-debug-table">
                  <tbody>
                    <tr><td className="gw-debug-table-label">id</td><td>{gameweekDebugRow.id}</td></tr>
                    <tr><td className="gw-debug-table-label">name</td><td>{gameweekDebugRow.name ?? '—'}</td></tr>
                    <tr><td className="gw-debug-table-label">deadline</td><td className="gw-debug-table-mono">{formatDeadlineGw(gameweekDebugRow.deadline_time)}</td></tr>
                    <tr><td className="gw-debug-table-label">is_current</td><td><GwDebugBadge value={gameweekDebugRow.is_current} /></td></tr>
                    <tr><td className="gw-debug-table-label">is_previous</td><td><GwDebugBadge value={gameweekDebugRow.is_previous} /></td></tr>
                    <tr><td className="gw-debug-table-label">is_next</td><td><GwDebugBadge value={gameweekDebugRow.is_next} /></td></tr>
                    <tr><td className="gw-debug-table-label">finished</td><td><GwDebugBadge value={gameweekDebugRow.finished} /></td></tr>
                    <tr><td className="gw-debug-table-label">data_checked</td><td><GwDebugBadge value={gameweekDebugRow.data_checked} /></td></tr>
                    <tr><td className="gw-debug-table-label">fpl_ranks_updated</td><td><GwDebugBadge value={gameweekDebugRow.fpl_ranks_updated} /></td></tr>
                  </tbody>
                </table>
              )}
            </div>
          </section>

          <section className="debug-modal-section">
            <h3 className="debug-modal-section-title">Fixtures</h3>
            <div className="gw-debug-fixtures-wrap">
              {gameweekDebugLoading ? (
                <div className="bento-card-value loading">
                  <div className="skeleton-text" />
                </div>
              ) : !gameweekDebugFixtures?.length ? (
                <div className="gw-debug-empty">No fixtures</div>
              ) : (
                <table className="gw-debug-table gw-debug-fixtures-table">
                  <thead>
                    <tr>
                      <th>Match</th>
                      <th>started</th>
                      <th>finished</th>
                      <th>prov</th>
                      <th>min</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gameweekDebugFixtures.map((f) => (
                      <tr key={f.fpl_fixture_id}>
                        <td className="gw-debug-match-cell">{f.home_short} – {f.away_short}</td>
                        <td><GwDebugBadge value={f.started} /></td>
                        <td><GwDebugBadge value={f.finished} /></td>
                        <td><GwDebugBadge value={f.finished_provisional} /></td>
                        <td>{f.minutes != null ? `${f.minutes}'` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          <section className="debug-modal-section">
            <h3 className="debug-modal-section-title">Updates (debug)</h3>
            {updateTimestampsData ? (
              <div className="updates-debug-bento-content">
                <div className="updates-debug-now">Local time: {updateTimestampsData.localTimeNow}</div>
                <div className="updates-debug-table-wrapper">
                  <table className="updates-debug-table league-standings-bento-table">
                    <thead>
                      <tr>
                        <th className="updates-debug-th-rank">#</th>
                        <th>Path</th>
                        <th>Source</th>
                        <th className="updates-debug-th-since">Since backend</th>
                        <th className="updates-debug-th-since">Since frontend</th>
                      </tr>
                    </thead>
                    <tbody>
                      {updateTimestampsData.rows.map((row, i) => (
                        <tr key={`${row.path}-${row.source}`}>
                          <td className="updates-debug-rank">{i + 1}</td>
                          <td className="updates-debug-path">{row.path}</td>
                          <td className="updates-debug-source">{row.source}</td>
                          <td className="updates-debug-since">{row.timeSinceBackend ?? '—'}</td>
                          <td className="updates-debug-since">{row.timeSince}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="gw-debug-empty">No update data</div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
