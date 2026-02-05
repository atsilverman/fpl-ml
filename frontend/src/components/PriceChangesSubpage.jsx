import { CircleArrowUp, CircleArrowDown } from 'lucide-react'
import { usePlayerPriceChangesLatest } from '../hooks/usePlayerPriceChangesLatest'
import { usePlayerTeamMap } from '../hooks/usePlayerTeamMap'
import './PriceChangesSubpage.css'

function formatSnapshotDate(isoDate) {
  if (!isoDate) return null
  const d = new Date(isoDate + 'Z')
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return 'Today'
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

export default function PriceChangesSubpage({ showCard = true }) {
  const { rises, falls, snapshotDate, loading, error } = usePlayerPriceChangesLatest()
  const { getTeamForPlayer } = usePlayerTeamMap()

  const content = (
    <div className="price-changes-content">
      {error ? (
        <div className="price-changes-error">Failed to load price changes.</div>
      ) : (
        <>
          {snapshotDate && (
            <p className="price-changes-snapshot-date" aria-live="polite">
              {formatSnapshotDate(snapshotDate)}
            </p>
          )}
          <div className="price-changes-columns-wrapper">
        <div className="price-changes-column price-changes-column-rise">
          <div className="price-changes-column-header">
            <span className="price-changes-column-title price-changes-column-title-rise">
              <CircleArrowUp size={12} strokeWidth={2} aria-hidden /> Rise
            </span>
          </div>
          {loading ? (
            <div className="price-changes-loading">Loading...</div>
          ) : rises.length === 0 ? (
            <div className="price-changes-empty">No data</div>
          ) : (
            <div className="price-changes-column-list">
              {rises.map((row, i) => {
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
        </div>
        <div className="price-changes-column price-changes-column-fall">
          <div className="price-changes-column-header">
            <span className="price-changes-column-title price-changes-column-title-fall">
              <CircleArrowDown size={12} strokeWidth={2} aria-hidden /> Fall
            </span>
          </div>
          {loading ? (
            <div className="price-changes-loading">Loading...</div>
          ) : falls.length === 0 ? (
            <div className="price-changes-empty">No data</div>
          ) : (
            <div className="price-changes-column-list">
              {falls.map((row, i) => {
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
        </div>
      </div>
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
