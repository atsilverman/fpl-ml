import { useMemo } from 'react'
import { useScheduleData } from '../hooks/useScheduleData'
import './ScheduleSubpage.css'
import './ScheduleBento.css'
import './ScheduleOpponentStatsTable.css'

function formatStatCell(value, rank, isTied) {
  if (rank != null && rank >= 1) return (isTied ? 'T-' : '') + String(rank)
  if (value != null) return typeof value === 'number' && value % 1 !== 0 ? value.toFixed(1) : String(value)
  return '—'
}

/** Green fill for top 6 (rank 1–6), red fill for bottom 6 (rank 15–20); 7–14 no fill */
function rankToFill(rank) {
  if (rank == null || rank < 1) return null
  if (rank <= 6) return 'green'
  if (rank >= 15) return 'red'
  return null
}

function fillClass(fill) {
  return fill != null ? ` schedule-opponent-stats-td-stat--rank-${fill}` : ''
}

export default function ScheduleOpponentStatsTable({
  teamId,
  opponentStatsByTeamId = null,
  opponentStatsLoading = false,
}) {
  const { scheduleMatrix, gameweeks, loading } = useScheduleData()

  const rows = useMemo(() => {
    if (teamId == null || !scheduleMatrix?.getOpponents) return []
    const out = []
    gameweeks.forEach((gw) => {
      const opponents = scheduleMatrix.getOpponents(teamId, gw.id) ?? []
      opponents.forEach((opp, idx) => {
        out.push({ key: `${gw.id}-${opp.team_id}-${idx}`, gw, opp })
      })
    })
    return out
  }, [teamId, scheduleMatrix, gameweeks])

  if (loading) {
    return (
      <div className="schedule-opponent-stats-table bento-card bento-card-animate">
        <span className="bento-card-label schedule-bento-label">Opponent form (last 6 GW)</span>
        <div className="schedule-bento-loading">Loading…</div>
      </div>
    )
  }

  if (teamId == null) {
    return (
      <div className="schedule-opponent-stats-table bento-card bento-card-animate">
        <span className="bento-card-label schedule-bento-label">Opponent form (last 6 GW)</span>
        <div className="schedule-bento-empty">No team selected.</div>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="schedule-opponent-stats-table bento-card bento-card-animate">
        <span className="bento-card-label schedule-bento-label">Opponent form (last 6 GW)</span>
        <div className="schedule-bento-empty">No upcoming gameweeks.</div>
      </div>
    )
  }

  return (
    <div className="schedule-opponent-stats-table bento-card bento-card-animate">
      <span className="bento-card-label schedule-bento-label">Opponent form (last 6 GW)</span>
      <div className="schedule-opponent-stats-table-scroll">
        <table className="schedule-opponent-stats-table-grid">
          <thead>
            <tr>
              <th className="schedule-opponent-stats-th-gw">GW#</th>
              <th className="schedule-opponent-stats-th-opponent">Opponent</th>
              <th className="schedule-opponent-stats-th-stat">G</th>
              <th className="schedule-opponent-stats-th-stat">xG</th>
              <th className="schedule-opponent-stats-th-stat">GC</th>
              <th className="schedule-opponent-stats-th-stat">xGC</th>
              <th className="schedule-opponent-stats-th-stat">CS</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, gw, opp }) => {
              const short = opp.short_name ?? '?'
              const display = opp.isHome ? (short || '?').toUpperCase() : (short || '?').toLowerCase()
              const stats = opponentStatsByTeamId?.[opp.team_id] ?? null
              return (
                <tr key={key}>
                  <td className="schedule-opponent-stats-td-gw">{gw.id}</td>
                  <td className="schedule-opponent-stats-td-opponent">
                    <span className={`schedule-opponent-stats-opponent-cell ${opp.isHome ? 'schedule-bento-side-home' : 'schedule-bento-side-away'}`}>
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
                        <span className={`schedule-cell-abbr-display ${opp.isHome ? 'schedule-cell-home' : 'schedule-cell-away'}`}>{display}</span>
                        {opp.isHome && (
                          <svg className="schedule-cell-home-indicator schedule-bento-home-icon" width="10" height="10" viewBox="0 0 48 48" fill="currentColor" aria-label="Home" title="Home">
                            <path d="M39.5,43h-9c-1.381,0-2.5-1.119-2.5-2.5v-9c0-1.105-0.895-2-2-2h-4c-1.105,0-2,0.895-2,2v9c0,1.381-1.119,2.5-2.5,2.5h-9C7.119,43,6,41.881,6,40.5V21.413c0-2.299,1.054-4.471,2.859-5.893L23.071,4.321c0.545-0.428,1.313-0.428,1.857,0L39.142,15.52C40.947,16.942,42,19.113,42,21.411V40.5C42,41.881,40.881,43,39.5,43z" />
                          </svg>
                        )}
                      </span>
                    </span>
                  </td>
                  <td className={`schedule-opponent-stats-td-stat${fillClass(rankToFill(stats?.rankGoals))}`}>
                    {opponentStatsLoading ? '…' : (stats ? formatStatCell(stats.goals, stats.rankGoals, stats.rankGoalsTied) : '—')}
                  </td>
                  <td className={`schedule-opponent-stats-td-stat${fillClass(rankToFill(stats?.rankXg))}`}>
                    {opponentStatsLoading ? '…' : (stats ? formatStatCell(stats.xg, stats.rankXg, stats.rankXgTied) : '—')}
                  </td>
                  <td className={`schedule-opponent-stats-td-stat${fillClass(rankToFill(stats?.rankGoalsConceded))}`}>
                    {opponentStatsLoading ? '…' : (stats ? formatStatCell(stats.goalsConceded, stats.rankGoalsConceded, stats.rankGoalsConcededTied) : '—')}
                  </td>
                  <td className={`schedule-opponent-stats-td-stat${fillClass(rankToFill(stats?.rankXgc))}`}>
                    {opponentStatsLoading ? '…' : (stats ? formatStatCell(stats.xgc, stats.rankXgc, stats.rankXgcTied) : '—')}
                  </td>
                  <td className={`schedule-opponent-stats-td-stat${fillClass(rankToFill(stats?.rankCleanSheets))}`}>
                    {opponentStatsLoading ? '…' : (stats ? formatStatCell(stats.cleanSheets, stats.rankCleanSheets, stats.rankCleanSheetsTied) : '—')}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
