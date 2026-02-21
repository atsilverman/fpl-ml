import { useState, useRef, useEffect } from 'react'
import { Info } from 'lucide-react'
import { useGameweekDebugDataFromFPL } from '../hooks/useGameweekDebugDataFromFPL'
import { useGameweekDebugData } from '../hooks/useGameweekDebugData'
import { useUpdateTimestamps } from '../hooks/useUpdateTimestamps'
import { useRefreshState } from '../hooks/useRefreshState'
import { useRefreshSnapshotLogger } from '../hooks/useRefreshSnapshotLogger'
import { useVerifyManagerAttributes } from '../hooks/useVerifyManagerAttributes'
import { useDeadlineBatchRuns, formatDurationSeconds } from '../hooks/useDeadlineBatchRuns'
import './ConfigurationModal.css'
import './BentoCard.css'
import './DebugModal.css'

const VERIFY_MANAGER_ID = 344182

const STATE_DEBUG_DEFINITIONS = [
  { term: 'Live', colorKey: 'live_matches', description: 'At least one fixture: started and not finished_provisional.' },
  { term: 'Bonus Pending', colorKey: 'bonus_pending', description: 'All fixtures: finished_provisional and not finished.' },
  { term: 'Price Window', colorKey: 'price_window', description: 'Time is in 17:30–17:36 PST (configurable).' },
  { term: 'Deadline', colorKey: 'transfer_deadline', description: 'Current GW exists, ≥30 min after GW deadline (post-deadline refresh window).' },
  { term: 'Idle', colorKey: 'idle', description: 'Current GW with no live/bonus/price/deadline conditions, or no current gameweek in DB (outside GW).' }
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
  const { gameweekRow: gameweekDebugRow, fixtures: gameweekDebugFixtures, loading: gameweekDebugLoading, error: fplDebugError } = useGameweekDebugDataFromFPL(isOpen)
  const { gameweekRow: gameweekFromDb, fixtures: fixturesFromDb, loading: dbLoading } = useGameweekDebugData()
  const updateTimestampsData = useUpdateTimestamps()
  const useFplFallback = Boolean(fplDebugError && !gameweekDebugRow)
  const gwRow = gameweekDebugRow ?? gameweekFromDb ?? null
  const gwFixtures = (gameweekDebugFixtures?.length ? gameweekDebugFixtures : fixturesFromDb) ?? []
  const gwLoading = gameweekDebugLoading || (useFplFallback && dbLoading)
  const { state, stateLabel } = useRefreshState()
  useRefreshSnapshotLogger(isOpen)
  const { data: verifyData, loading: verifyLoading, error: verifyError, verify } = useVerifyManagerAttributes(VERIFY_MANAGER_ID)
  const { latest: deadlineBatchLatest, phaseRows: deadlinePhaseRows, failureReason: deadlineFailureReason, successRate: deadlineSuccessRate, isLoading: deadlineBatchLoading } = useDeadlineBatchRuns()
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
            <p className="debug-modal-section-source">Source: derived from backend (Supabase <code>fixtures</code> table: started / finished_provisional).</p>
            <div className="debug-modal-state-row">
              <button
                type="button"
                className={`debug-modal-state-button debug-modal-state-button--${state ?? 'idle'}`}
                aria-label={`Refresh state: ${stateLabel ?? '—'}`}
              >
                {stateLabel ?? '—'}
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
                {STATE_DEBUG_DEFINITIONS.map(({ term, colorKey, description }) => (
                  <div key={term} className="state-debug-dl-row">
                    <dt>
                      <span className={`state-debug-dl-dot state-debug-dl-dot--${colorKey}`} aria-hidden />
                      {term}
                    </dt>
                    <dd>{description}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>

          <section className="debug-modal-section">
            <h3 className="debug-modal-section-title">GW Debug</h3>
            <p className="debug-modal-section-source">
              {useFplFallback
                ? 'Source: Supabase (FPL API unavailable — run dev server for proxy or add serverless proxy in prod).'
                : 'Source: FPL API directly (bootstrap-static → events). fpl_ranks_updated from Supabase.'}
            </p>
            <div className="gw-debug-bento-content">
              {fplDebugError && useFplFallback && (
                <div className="debug-modal-verify-error" role="alert">FPL fetch failed: {fplDebugError}. Showing Supabase data.</div>
              )}
              {gwLoading ? (
                <div className="bento-card-value loading">
                  <div className="skeleton-text" />
                </div>
              ) : !gwRow ? (
                <div className="gw-debug-empty">No current gameweek</div>
              ) : (
                <table className="gw-debug-table">
                  <tbody>
                    <tr><td className="gw-debug-table-label">id</td><td>{gwRow.id}</td></tr>
                    <tr><td className="gw-debug-table-label">name</td><td>{gwRow.name ?? '—'}</td></tr>
                    <tr><td className="gw-debug-table-label">deadline</td><td className="gw-debug-table-mono">{formatDeadlineGw(gwRow.deadline_time)}</td></tr>
                    <tr><td className="gw-debug-table-label">is_current</td><td><GwDebugBadge value={gwRow.is_current} /></td></tr>
                    <tr><td className="gw-debug-table-label">is_previous</td><td><GwDebugBadge value={gwRow.is_previous} /></td></tr>
                    <tr><td className="gw-debug-table-label">is_next</td><td><GwDebugBadge value={gwRow.is_next} /></td></tr>
                    <tr><td className="gw-debug-table-label">finished</td><td><GwDebugBadge value={gwRow.finished} /></td></tr>
                    <tr><td className="gw-debug-table-label">data_checked</td><td><GwDebugBadge value={gwRow.data_checked} /></td></tr>
                    <tr><td className="gw-debug-table-label">fpl_ranks_updated</td><td>{(gameweekFromDb?.fpl_ranks_updated ?? gwRow?.fpl_ranks_updated) != null ? <GwDebugBadge value={gameweekFromDb?.fpl_ranks_updated ?? gwRow?.fpl_ranks_updated} /> : '—'}</td></tr>
                  </tbody>
                </table>
              )}
            </div>
          </section>

          <section className="debug-modal-section">
            <h3 className="debug-modal-section-title">Fixtures</h3>
            <p className="debug-modal-section-source">
              {useFplFallback
                ? 'Source: Supabase (FPL API unavailable — run dev server for proxy or add serverless proxy in prod).'
                : 'Source: FPL API directly (fixtures endpoint; started / finished / finished_provisional).'}
            </p>
            <div className="gw-debug-fixtures-wrap">
              {gwLoading ? (
                <div className="bento-card-value loading">
                  <div className="skeleton-text" />
                </div>
              ) : !gwFixtures?.length ? (
                <div className="gw-debug-empty">No fixtures</div>
              ) : (
                <table className="gw-debug-table gw-debug-fixtures-table">
                  <thead>
                    <tr>
                      <th>Match</th>
                      <th>started</th>
                      <th>finished</th>
                      <th>prov</th>
                      <th title="Match clock (max MP from player stats; aligned with GW points / matchup)">clock</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gwFixtures.map((f) => (
                      <tr key={f.fpl_fixture_id}>
                        <td className="gw-debug-match-cell">{f.home_short} – {f.away_short}</td>
                        <td><GwDebugBadge value={f.started} /></td>
                        <td><GwDebugBadge value={f.finished} /></td>
                        <td><GwDebugBadge value={f.finished_provisional} /></td>
                        <td>{f.clock_minutes != null ? `${f.clock_minutes}'` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          <section className="debug-modal-section">
            <h3 className="debug-modal-section-title">Attribute verification (vs FPL API)</h3>
            <p className="debug-modal-section-source">Source: DB (Supabase) vs FPL API; comparison via Edge Function <code>debug-verify-manager</code>.</p>
            <p className="debug-modal-verify-intro">Manager {VERIFY_MANAGER_ID} (check). Requires Edge Function <code>debug-verify-manager</code> to be deployed.</p>
            <button
              type="button"
              className="debug-modal-verify-button"
              onClick={verify}
              disabled={verifyLoading}
              aria-busy={verifyLoading}
            >
              {verifyLoading ? 'Verifying…' : 'Verify'}
            </button>
            {verifyError && (
              <div className="debug-modal-verify-error" role="alert">
                {verifyError}
              </div>
            )}
            {verifyData?.attributes?.length > 0 && (
              <div className="gw-debug-fixtures-wrap">
                <table className="gw-debug-table gw-debug-fixtures-table">
                  <thead>
                    <tr>
                      <th>Attribute</th>
                      <th>DB</th>
                      <th>API</th>
                      <th>Match</th>
                    </tr>
                  </thead>
                  <tbody>
                    {verifyData.attributes.map((row) => (
                      <tr key={row.name}>
                        <td className="gw-debug-table-label">{row.name}</td>
                        <td className="gw-debug-table-mono">{row.db ?? '—'}</td>
                        <td className="gw-debug-table-mono">{row.api ?? '—'}</td>
                        <td><GwDebugBadge value={row.match} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {verifyData.gameweek != null && (
                  <div className="debug-modal-verify-meta">GW {verifyData.gameweek}</div>
                )}
              </div>
            )}
            {verifyData && (!verifyData.attributes || verifyData.attributes.length === 0) && !verifyLoading && (
              <div className="gw-debug-empty">No attributes to compare (no current GW or API/DB missing)</div>
            )}
          </section>

          <section className="debug-modal-section">
            <h3 className="debug-modal-section-title">Deadline batch</h3>
            <p className="debug-modal-section-source">Source: backend (Supabase <code>refresh_duration_log</code> / deadline batch metadata).</p>
            {deadlineBatchLoading ? (
              <div className="bento-card-value loading">
                <div className="skeleton-text" />
              </div>
            ) : !deadlineBatchLatest ? (
              <div className="gw-debug-empty">No deadline batch run yet</div>
            ) : (
              <div className="deadline-batch-debug">
                <div className="deadline-batch-meta">
                  {deadlineBatchLatest.gameweek != null && (
                    <div className="deadline-batch-meta-row">
                      <span className="deadline-batch-label">Gameweek</span>
                      <span>GW {deadlineBatchLatest.gameweek}</span>
                    </div>
                  )}
                  <div className="deadline-batch-meta-row">
                    <span className="deadline-batch-label">Started (GW became current)</span>
                    <span className="gw-debug-table-mono">{formatDeadlineGw(deadlineBatchLatest.started_at)}</span>
                  </div>
                  <div className="deadline-batch-meta-row">
                    <span className="deadline-batch-label">Finished</span>
                    <span className="gw-debug-table-mono">
                      {deadlineBatchLatest.finished_at ? formatDeadlineGw(deadlineBatchLatest.finished_at) : 'In progress'}
                    </span>
                  </div>
                  <div className="deadline-batch-meta-row">
                    <span className="deadline-batch-label">Duration</span>
                    <span>{deadlineBatchLatest.duration_seconds != null ? formatDurationSeconds(deadlineBatchLatest.duration_seconds) : '—'}</span>
                  </div>
                  {deadlineBatchLatest.manager_count != null && (
                    <div className="deadline-batch-meta-row">
                      <span className="deadline-batch-label">Managers</span>
                      <span>{deadlineBatchLatest.manager_count}</span>
                    </div>
                  )}
                  {deadlineBatchLatest.league_count != null && (
                    <div className="deadline-batch-meta-row">
                      <span className="deadline-batch-label">Leagues</span>
                      <span>{deadlineBatchLatest.league_count}</span>
                    </div>
                  )}
                  {deadlineBatchLatest.success != null && (
                    <div className="deadline-batch-meta-row">
                      <span className="deadline-batch-label">Success</span>
                      <span><GwDebugBadge value={deadlineBatchLatest.success} /></span>
                    </div>
                  )}
                  {deadlineBatchLatest.success === false && deadlineFailureReason && (
                    <div className="deadline-batch-meta-row">
                      <span className="deadline-batch-label">Failure reason</span>
                      <span className="gw-debug-table-mono">
                        {deadlineFailureReason === 'bootstrap_failed' && 'Bootstrap (FPL API) failed'}
                        {deadlineFailureReason === 'success_rate_below_80' && `Picks/transfers &lt; 80% (${deadlineSuccessRate ?? '?'}%)`}
                        {deadlineFailureReason === 'no_managers' && 'No tracked managers'}
                        {!['bootstrap_failed', 'success_rate_below_80', 'no_managers'].includes(deadlineFailureReason) && deadlineFailureReason}
                      </span>
                    </div>
                  )}
                </div>
                {deadlinePhaseRows.length > 0 && (
                  <table className="gw-debug-table deadline-batch-phases-table">
                    <thead>
                      <tr>
                        <th className="gw-debug-table-label">Phase</th>
                        <th>Duration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {deadlinePhaseRows.map((row) => (
                        <tr key={row.label}>
                          <td className="gw-debug-table-label">{row.label}</td>
                          <td>{formatDurationSeconds(row.durationSec)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </section>

          <section className="debug-modal-section">
            <h3 className="debug-modal-section-title">Updates (debug)</h3>
            <p className="debug-modal-section-source">Source: backend update timestamps + frontend cache (derived from refresh/query state).</p>
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
