import { CircleArrowUp, CircleArrowDown } from 'lucide-react'
import { usePlayerPriceChangesLatest } from '../hooks/usePlayerPriceChangesLatest'
import { usePriceChangePredictions } from '../hooks/usePriceChangePredictions'
import { usePlayerTeamMap } from '../hooks/usePlayerTeamMap'
import './PriceChangesSubpage.css'

function formatSnapshotDate(isoDate) {
  if (!isoDate) return null
  const d = new Date(isoDate + 'Z')
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return 'Today'
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

function formatCapturedAt(isoString) {
  if (!isoString) return null
  const d = new Date(isoString)
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) + ' · ' + formatSnapshotDate(isoString.slice(0, 10))
}

function PriceChangeColumns({ rises, falls, loading, getTeamForPlayer }) {
  const renderList = (list) => (
    <>
      {loading ? (
        <div className="price-changes-loading">Loading...</div>
      ) : list.length === 0 ? (
        <div className="price-changes-empty">No data</div>
      ) : (
        <div className="price-changes-column-list">
          {list.map((row, i) => {
            const badgeTeam = row.teamShortName || getTeamForPlayer(row.playerName)
            return (
              <div key={i} className="price-changes-column-item">
                <span className="price-changes-badge-slot">
                  {badgeTeam ? (
                    <img
                      src={`/badges/${badgeTeam}.svg`}
                      alt=""
                      className="price-changes-badge"
                      onError={(e) => { e.target.style.display = 'none' }}
                    />
                  ) : (
                    <span className="price-changes-badge-placeholder" aria-hidden />
                  )}
                </span>
                <span className="price-changes-column-name">{row.playerName}</span>
                {row.price ? (
                  <span className="price-changes-column-price" title={row.price}>{row.price}</span>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </>
  )

  return (
    <div className="price-changes-columns-wrapper">
      <div className="price-changes-column price-changes-column-rise">
        <div className="price-changes-column-header">
          <span className="price-changes-column-title price-changes-column-title-rise">
            <CircleArrowUp size={12} strokeWidth={2} aria-hidden /> Rise
          </span>
        </div>
        {renderList(rises, true)}
      </div>
      <div className="price-changes-column price-changes-column-fall">
        <div className="price-changes-column-header">
          <span className="price-changes-column-title price-changes-column-title-fall">
            <CircleArrowDown size={12} strokeWidth={2} aria-hidden /> Fall
          </span>
        </div>
        {renderList(falls, false)}
      </div>
    </div>
  )
}

export default function PriceChangesSubpage({ showCard = true }) {
  const { rises: actualRises, falls: actualFalls, snapshotDate, loading: actualLoading, error: actualError } = usePlayerPriceChangesLatest()
  const { rises: predRises, falls: predFalls, capturedAt, loading: predLoading, error: predError } = usePriceChangePredictions()
  const { getTeamForPlayer } = usePlayerTeamMap()

  const hasPredictions = (predRises?.length ?? 0) > 0 || (predFalls?.length ?? 0) > 0
  const error = actualError ?? predError

  const content = (
    <div className="price-changes-content">
      {error ? (
        <div className="price-changes-error">Failed to load price changes.</div>
      ) : (
        <>
          {hasPredictions && (
            <section className="price-changes-section" aria-labelledby="price-changes-predictions-heading">
              <h3 id="price-changes-predictions-heading" className="price-changes-section-label">Predictions (from screenshot)</h3>
              {capturedAt && (
                <p className="price-changes-snapshot-date" aria-live="polite">
                  {formatCapturedAt(capturedAt)}
                </p>
              )}
              <PriceChangeColumns
                rises={predRises}
                falls={predFalls}
                loading={predLoading}
                getTeamForPlayer={getTeamForPlayer}
              />
            </section>
          )}
          <section className="price-changes-section" aria-labelledby="price-changes-actual-heading">
            <h3 id="price-changes-actual-heading" className="price-changes-section-label">Actual</h3>
            {snapshotDate && (
              <p className="price-changes-snapshot-date" aria-live="polite">
                {formatSnapshotDate(snapshotDate)}
              </p>
            )}
            <PriceChangeColumns
              rises={actualRises}
              falls={actualFalls}
              loading={actualLoading}
              getTeamForPlayer={getTeamForPlayer}
            />
          </section>
        </>
      )}
    </div>
  )

  if (!showCard) {
    return <div className="price-changes-subpage">{content}</div>
  }

  return (
    <div className="price-changes-subpage">
      <div className="price-changes-card">
        {content}
      </div>
    </div>
  )
}
