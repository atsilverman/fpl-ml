import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import './GameweekPointsView.css'
import { formatNumber } from '../utils/formatNumbers'
import { ArrowDownRight, ArrowUpRight, HelpCircle } from 'lucide-react'

const IMPACT_TOOLTIP = 'Importance: your share of this player\'s points vs the rest of your mini-league (100% = in XI, 200% = captain, 300% = triple captain). Positive = you gain more than league average; negative = others gain more.'

const POPUP_PADDING = 12
const POPUP_MAX_WIDTH = 320
const POPUP_MIN_WIDTH = 260

export default function GameweekPointsView({ data = [], loading = false, topScorerPlayerIds = null, top10ByStat = null, isLiveUpdating = false, impactByPlayerId = {} }) {
  const [showImpactPopup, setShowImpactPopup] = useState(false)
  const [popupPlacement, setPopupPlacement] = useState({ top: 0, left: 0, width: POPUP_MAX_WIDTH })
  const impactPopupRef = useRef(null)
  const impactIconRef = useRef(null)

  const updatePopupPlacement = () => {
    if (!impactIconRef.current) return
    const rect = impactIconRef.current.getBoundingClientRect()
    const viewportW = window.innerWidth
    const viewportH = window.innerHeight
    const width = Math.min(POPUP_MAX_WIDTH, Math.max(POPUP_MIN_WIDTH, viewportW - POPUP_PADDING * 2))
    const gap = 6
    const estimatedPopupH = 120
    const spaceBelow = viewportH - rect.bottom - gap
    const spaceAbove = rect.top - gap
    const preferBelow = spaceBelow >= estimatedPopupH || spaceBelow >= spaceAbove
    const top = preferBelow ? rect.bottom + gap : rect.top - gap - estimatedPopupH
    let left = rect.left + rect.width / 2 - width / 2
    if (left < POPUP_PADDING) left = POPUP_PADDING
    if (left + width > viewportW - POPUP_PADDING) left = viewportW - width - POPUP_PADDING
    setPopupPlacement({ top, left, width })
  }

  useEffect(() => {
    if (!showImpactPopup) return
    const handleClickOutside = (e) => {
      if (
        impactPopupRef.current && !impactPopupRef.current.contains(e.target) &&
        impactIconRef.current && !impactIconRef.current.contains(e.target)
      ) {
        setShowImpactPopup(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showImpactPopup])

  useLayoutEffect(() => {
    if (!showImpactPopup || !impactIconRef.current) return
    updatePopupPlacement()
    const onScrollOrResize = () => updatePopupPlacement()
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [showImpactPopup])
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
          <div style={{ color: 'var(--text-secondary)', fontSize: '10px' }}>
            No player data available
          </div>
        </div>
      </div>
    )
  }

  const formatMinutes = (minutes) => (minutes != null && minutes > 0 ? `${minutes}'` : 'DNP')

  const IMPACT_BAR_MAX = 100

  const PlayerTableRow = ({ player }) => {
    const captainLabel = player.is_captain
      ? (player.multiplier === 3 ? 'TC' : 'C')
      : null
    const assistantLabel = player.is_vice_captain ? 'A' : null
    const isFirstBenchRow = player.position === 12
    const isBench = player.position >= 12
    const playerId = player.effective_player_id ?? player.player_id
    const impact = impactByPlayerId[playerId]
    const hasImpact = typeof impact === 'number'
    const impactWidth = hasImpact ? Math.min(IMPACT_BAR_MAX, Math.abs(impact)) / IMPACT_BAR_MAX : 0
    const isTop10Pts = playerId != null && top10Pts.has(Number(playerId))
    const isDefconAchieved = Boolean(player.defcon_points_achieved)
    const isAutosubOut = Boolean(player.was_auto_subbed_out)
    const isAutosubIn = Boolean(player.was_auto_subbed_in)

    const isGk = player.position === 1
    const renderStatCell = (value, statKey) => {
      const isZero = value === 0
      const isTop10ForColumn = playerId != null && top10ByStat?.[statKey]?.has(Number(playerId))
      const isDefColumn = statKey === 'defensive_contribution'
      const isSavesColumn = statKey === 'saves'
      const showDefconBadge = isDefColumn && !isZero && isDefconAchieved
      const showSavesBadge = isSavesColumn && isGk && !isZero && value >= 3
      const showTop10Badge = !isZero && (isTop10ForColumn || (isDefColumn && showDefconBadge))
      const showBadge = showDefconBadge || showSavesBadge || showTop10Badge
      if (isZero) {
        return <td key={statKey} className="gameweek-points-td gameweek-points-td-stat gameweek-points-cell-muted">{value}</td>
      }
      const badgeClass = [
        'gameweek-points-player-points-badge',
        showTop10Badge && 'rank-highlight',
        showDefconBadge && 'defcon-achieved',
        showSavesBadge && 'saves-achieved'
      ].filter(Boolean).join(' ')
      let title
      if (showDefconBadge) {
        title = isTop10ForColumn ? 'Top 10 in GW & Defcon achieved (DEF ≥ position threshold)' : 'Defcon achieved (DEF ≥ position threshold)'
      } else if (showSavesBadge) {
        title = isTop10ForColumn ? 'Top 10 in GW & Saves achieved (3+ saves = 1 pt per 3)' : 'Saves achieved (3+ saves = 1 pt per 3)'
      } else {
        title = `Top 10 in GW for ${statKey}`
      }
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
          <span className="gameweek-points-col-sep" aria-hidden />
        </td>
        <td className={`gameweek-points-td gameweek-points-td-mins ${(player.minutes == null || player.minutes === 0) ? 'gameweek-points-cell-muted' : ''}`}>
          <span className="gameweek-points-mins-value-wrap">
            {(player.minutes != null && player.minutes > 0) ? (
              <>
                {formatMinutes(player.minutes)}
                {isLiveUpdating && (
                  <span className="live-updating-indicator gameweek-points-mins-live" title="Minutes can change during live games" aria-hidden />
                )}
              </>
            ) : (
              <span className="gameweek-points-mins-dnp-badge" title="Did not play">!</span>
            )}
          </span>
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
        <td className="gameweek-points-td gameweek-points-td-impact">
          {hasImpact ? (
            <div className="gameweek-points-impact-cell" title={IMPACT_TOOLTIP}>
              <div className="gameweek-points-impact-bar-wrap">
                <div
                  className={`gameweek-points-impact-bar ${impact > 0 ? 'gameweek-points-impact-bar--positive' : impact < 0 ? 'gameweek-points-impact-bar--negative' : ''}`}
                  style={{ width: `${impactWidth * 100}%` }}
                />
              </div>
              <span className={`gameweek-points-impact-value ${impact < 0 ? 'gameweek-points-impact-value--negative' : ''}`}>
                {impact < 0 ? `−${Math.abs(impact)}` : impact}%
              </span>
            </div>
          ) : (
            <span className="gameweek-points-cell-muted">–</span>
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
                <th className="gameweek-points-th gameweek-points-th-player">
                  PLAYER
                  <span className="gameweek-points-col-sep" aria-hidden />
                </th>
                <th className="gameweek-points-th gameweek-points-th-mins">MP</th>
                <th className="gameweek-points-th gameweek-points-th-opp">OPP</th>
                <th className="gameweek-points-th gameweek-points-th-pts">PTS</th>
                <th className="gameweek-points-th gameweek-points-th-impact gameweek-points-th-impact--has-popup">
                  <span className="gameweek-points-th-impact-label">Imp</span>
                  <button
                    type="button"
                    ref={impactIconRef}
                    className="gameweek-points-th-impact-icon-wrap"
                    onClick={(e) => {
                      e.stopPropagation()
                      const next = !showImpactPopup
                      if (next) updatePopupPlacement()
                      setShowImpactPopup(next)
                    }}
                    title="What is Importance?"
                    aria-expanded={showImpactPopup}
                    aria-haspopup="dialog"
                >
                    <HelpCircle size={12} className="gameweek-points-th-impact-icon" aria-hidden />
                  </button>
                  {showImpactPopup &&
                    createPortal(
                      <div
                        ref={impactPopupRef}
                        className="gameweek-points-impact-popup gameweek-points-impact-popup--portal"
                        role="dialog"
                        aria-label="Importance (Impact) explained"
                        style={{
                          position: 'fixed',
                          top: popupPlacement.top,
                          left: popupPlacement.left,
                          width: popupPlacement.width
                        }}
                      >
                        <div className="gameweek-points-impact-popup-title">Importance (Imp)</div>
                        <p className="gameweek-points-impact-popup-text">{IMPACT_TOOLTIP}</p>
                      </div>,
                      document.body
                    )}
                </th>
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
