import './GameweekPointsView.css'
import { formatNumber } from '../utils/formatNumbers'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react' // Lucide: arrow-down-right, arrow-up-right

export default function GameweekPointsView({ data = [], loading = false, topScorerPlayerIds = null, top10ByStat = null }) {
  // Per-column top 10: use top10ByStat when provided, else fall back to topScorerPlayerIds for PTS only
  const top10Pts = top10ByStat?.pts ?? (topScorerPlayerIds != null ? topScorerPlayerIds : new Set())

  if (loading) {
    return (
      <div className="gameweek-points-view">
        <div className="gameweek-points-loading">
          <div className="skeleton-text"></div>
        </div>
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <div className="gameweek-points-view">
        <div className="gameweek-points-empty">
          <div style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
            No player data available
          </div>
        </div>
      </div>
    )
  }

  const formatMinutes = (minutes) => (minutes != null && minutes > 0 ? `${minutes}'` : 'DNP')

  const PlayerTableRow = ({ player }) => {
    const captainLabel = player.is_captain
      ? (player.multiplier === 3 ? 'TC' : 'C')
      : null
    const assistantLabel = player.is_vice_captain ? 'A' : null
    const isFirstBenchRow = player.position === 12
    const isBench = player.position >= 12
    const playerId = player.effective_player_id
    const isTop10Pts = playerId != null && top10Pts.has(Number(playerId))
    const isDefconAchieved = Boolean(player.defcon_points_achieved)
    const isAutosubOut = Boolean(player.was_auto_subbed_out)
    const isAutosubIn = Boolean(player.was_auto_subbed_in)

    const renderStatCell = (value, statKey) => {
      const isZero = value === 0
      const isTop10ForColumn = playerId != null && top10ByStat?.[statKey]?.has(Number(playerId))
      const isDefColumn = statKey === 'defensive_contribution'
      const showDefconBadge = isDefColumn && !isZero && isDefconAchieved
      const showTop10Badge = !isZero && (isTop10ForColumn || (isDefColumn && showDefconBadge))
      const showBadge = showDefconBadge || showTop10Badge
      if (isZero) {
        return <td key={statKey} className="gameweek-points-td gameweek-points-td-stat gameweek-points-cell-muted">{value}</td>
      }
      const badgeClass = [
        'gameweek-points-player-points-badge',
        showTop10Badge && 'rank-highlight',
        showDefconBadge && 'defcon-achieved'
      ].filter(Boolean).join(' ')
      const title = showDefconBadge
        ? (isTop10ForColumn ? 'Top 10 in GW & Defcon achieved (DEF ≥ position threshold)' : 'Defcon achieved (DEF ≥ position threshold)')
        : `Top 10 in GW for ${statKey}`
      return (
        <td key={statKey} className="gameweek-points-td gameweek-points-td-stat">
          {showBadge ? (
            <span className={badgeClass} title={title}>{value}</span>
          ) : (
            value
          )}
        </td>
      )
    }

    return (
      <tr
        className={`gameweek-points-tr ${isFirstBenchRow ? 'gameweek-points-tr-bench-first' : ''} ${isBench ? 'gameweek-points-tr-bench' : ''} ${isAutosubOut ? 'gameweek-points-tr-autosub-out' : ''} ${isAutosubIn ? 'gameweek-points-tr-autosub-in' : ''}`}
      >
        <td className="gameweek-points-td gameweek-points-td-player gameweek-points-td-player-fixed">
          <div className="gameweek-points-player-info-cell">
            {player.player_team_short_name && (
              <img
                src={`/badges/${player.player_team_short_name}.svg`}
                alt=""
                className="gameweek-points-team-badge"
                onError={(e) => { e.target.style.display = 'none' }}
              />
            )}
            <div className="gameweek-points-name-and-autosub">
              <span className="gameweek-points-player-name-text">
                {player.player_name}
                {captainLabel && (
                  <span className="gameweek-points-captain-badge-inline">{captainLabel}</span>
                )}
                {assistantLabel && (
                  <span className="gameweek-points-assistant-badge-inline">{assistantLabel}</span>
                )}
                {isAutosubOut && (
                  <span className="gameweek-points-autosub-icon gameweek-points-autosub-out-icon" title="Auto-subbed out">
                    <ArrowDownRight size={12} strokeWidth={2.5} aria-hidden />
                  </span>
                )}
                {isAutosubIn && (
                  <span className="gameweek-points-autosub-icon gameweek-points-autosub-in-icon" title="Auto-subbed in">
                    <ArrowUpRight size={12} strokeWidth={2.5} aria-hidden />
                  </span>
                )}
              </span>
            </div>
          </div>
        </td>
        <td className={`gameweek-points-td gameweek-points-td-mins ${(player.minutes == null || player.minutes === 0) ? 'gameweek-points-cell-muted' : ''}`}>
          {formatMinutes(player.minutes)}
        </td>
        <td className="gameweek-points-td gameweek-points-td-opp">
          {player.opponent_team_short_name ? (
            <div className="gameweek-points-opponent-cell">
              <img
                src={`/badges/${player.opponent_team_short_name}.svg`}
                alt=""
                className="gameweek-points-opponent-badge"
                onError={(e) => { e.target.style.display = 'none' }}
              />
              {player.was_home && (
                <span className="gameweek-points-home-indicator" title="Home">(h)</span>
              )}
            </div>
          ) : (
            '–'
          )}
        </td>
        <td className={`gameweek-points-td gameweek-points-td-pts ${!isTop10Pts && player.points === 0 ? 'gameweek-points-cell-muted' : ''}`}>
          {isTop10Pts ? (
            <span
              className="gameweek-points-player-points-badge rank-highlight"
              title="Top 10 in GW for points"
            >
              {formatNumber(player.points)}
            </span>
          ) : (
            formatNumber(player.points)
          )}
        </td>
        {renderStatCell(player.goals_scored ?? 0, 'goals')}
        {renderStatCell(player.assists ?? 0, 'assists')}
        {renderStatCell(player.clean_sheets ?? 0, 'clean_sheets')}
        {renderStatCell(player.saves ?? 0, 'saves')}
        {renderStatCell(player.bps ?? 0, 'bps')}
        {renderStatCell(player.bonus ?? 0, 'bonus')}
        {renderStatCell(player.defensive_contribution ?? 0, 'defensive_contribution')}
        {renderStatCell(player.yellow_cards ?? 0, 'yellow_cards')}
        {renderStatCell(player.red_cards ?? 0, 'red_cards')}
      </tr>
    )
  }

  return (
    <div className="gameweek-points-view">
      <div className="gameweek-points-scrollable">
        <div className="gameweek-points-box-content">
          <table className="gameweek-points-table">
            <thead>
              <tr>
                <th className="gameweek-points-th gameweek-points-th-player">PLAYER</th>
                <th className="gameweek-points-th gameweek-points-th-mins">MP</th>
                <th className="gameweek-points-th gameweek-points-th-opp">OPP</th>
                <th className="gameweek-points-th gameweek-points-th-pts">PTS</th>
                <th className="gameweek-points-th gameweek-points-th-stat" title="Goals">G</th>
                <th className="gameweek-points-th gameweek-points-th-stat" title="Assists">A</th>
                <th className="gameweek-points-th gameweek-points-th-stat" title="Clean sheets">CS</th>
                <th className="gameweek-points-th gameweek-points-th-stat" title="Saves">S</th>
                <th className="gameweek-points-th gameweek-points-th-stat" title="BPS">BPS</th>
                <th className="gameweek-points-th gameweek-points-th-stat" title="Bonus">B</th>
                <th className="gameweek-points-th gameweek-points-th-stat" title="Defensive contribution">DEF</th>
                <th className="gameweek-points-th gameweek-points-th-stat" title="Yellow cards">YC</th>
                <th className="gameweek-points-th gameweek-points-th-stat" title="Red cards">RC</th>
              </tr>
            </thead>
            <tbody>
              {data.map((player) => (
                <PlayerTableRow key={player.position} player={player} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
