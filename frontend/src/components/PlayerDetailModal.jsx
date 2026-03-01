import { useState, useMemo, useEffect, useRef } from 'react'
import { X, Filter, Minimize2, MoveDiagonal, RectangleVertical } from 'lucide-react'
import { CardStatLabel } from './CardStatLabel'
import { usePlayerDetail } from '../hooks/usePlayerDetail'
import { usePlayerGameweekStats } from '../hooks/usePlayerGameweekStats'
import { useTeamLast6Stats } from '../hooks/useTeamLast6Stats'
import { useConfiguration } from '../contexts/ConfigurationContext'
import PlayerGameweekPointsChart, { CHART_RANGE_FILTERS } from './PlayerGameweekPointsChart'
import ScheduleBento from './ScheduleBento'
import ScheduleOpponentStatsTable from './ScheduleOpponentStatsTable'
import './MiniLeaguePage.css'

const DEFCON_THRESHOLDS = { 1: 999, 2: 10, 3: 12, 4: 12 }
const GOAL_PTS = { 1: 6, 2: 6, 3: 5, 4: 4 }
const CLEAN_SHEET_PTS = { 1: 4, 2: 4, 3: 1, 4: 0 }

/**
 * Build list of points-impact events for the current gameweek from aggregated stats.
 * Returns [{ label, value, pts, icon? }] for display; only includes events with non-zero pts.
 * Exported for use in Stats subpage breakdown popup.
 */
export function getPointsImpactEvents(stats, position) {
  if (!stats || position == null) return []
  const pos = Number(position)
  const events = []
  const n = (v) => Number(v) || 0

  if (n(stats.goals_scored) > 0) {
    const pts = (GOAL_PTS[pos] ?? 4) * stats.goals_scored
    events.push({
      label: stats.goals_scored === 1 ? '1 goal' : `${stats.goals_scored} goals`,
      value: stats.goals_scored,
      pts,
    })
  }
  if (n(stats.assists) > 0) {
    const pts = 3 * stats.assists
    events.push({
      label: stats.assists === 1 ? '1 assist' : `${stats.assists} assists`,
      value: stats.assists,
      pts,
    })
  }
  const defconThreshold = DEFCON_THRESHOLDS[pos] ?? 999
  if (n(stats.defensive_contribution) >= defconThreshold) {
    events.push({
      label: `${stats.defensive_contribution} def. contributions`,
      value: stats.defensive_contribution,
      pts: 2,
    })
  }
  if (n(stats.yellow_cards) > 0) {
    const pts = -1 * stats.yellow_cards
    events.push({ label: 'Yellow card', value: 1, pts, icon: 'yc' })
  }
  if (n(stats.red_cards) > 0) {
    const pts = -3 * stats.red_cards
    events.push({ label: 'Red card', value: 1, pts, icon: 'rc' })
  }
  const mins = n(stats.minutes)
  if (mins >= 60) {
    events.push({
      label: mins >= 90 ? 'Played 90 min' : 'Played 60+ min',
      value: mins,
      pts: 2,
    })
  } else if (mins >= 1) {
    events.push({ label: 'Appearance', value: mins, pts: 1 })
  }
  const isBonusProvisional = stats.bonus_status === 'provisional'
  const effectiveBonus = isBonusProvisional ? n(stats.provisional_bonus) : n(stats.bonus)
  if (effectiveBonus > 0) {
    const bps = n(stats.bps)
    events.push({
      label: isBonusProvisional
        ? (bps ? `Bonus (provisional, ${stats.bps} bps)` : 'Bonus (provisional)')
        : (bps ? `Bonus (${stats.bps} bps)` : 'Bonus'),
      value: effectiveBonus,
      pts: effectiveBonus,
      provisional: isBonusProvisional,
    })
  }
  if (n(stats.clean_sheets) > 0 && (CLEAN_SHEET_PTS[pos] ?? 0) > 0) {
    const ptsPer = CLEAN_SHEET_PTS[pos]
    const pts = ptsPer * stats.clean_sheets
    events.push({
      label: stats.clean_sheets === 1 ? 'Clean sheet' : `${stats.clean_sheets} clean sheets`,
      value: stats.clean_sheets,
      pts,
    })
  }
  const savePts = Math.floor(n(stats.saves) / 3)
  if (savePts > 0) {
    events.push({
      label: `${stats.saves} saves`,
      value: stats.saves,
      pts: savePts,
    })
  }
  if (n(stats.own_goals) > 0) {
    const pts = -2 * stats.own_goals
    events.push({
      label: stats.own_goals === 1 ? 'Own goal' : `${stats.own_goals} own goals`,
      value: stats.own_goals,
      pts,
    })
  }
  if (n(stats.penalties_missed) > 0) {
    const pts = -2 * stats.penalties_missed
    events.push({
      label: stats.penalties_missed === 1 ? 'Penalty missed' : `${stats.penalties_missed} penalties missed`,
      value: stats.penalties_missed,
      pts,
    })
  }
  if (n(stats.penalties_saved) > 0) {
    const pts = 5 * stats.penalties_saved
    events.push({
      label: stats.penalties_saved === 1 ? 'Penalty saved' : `${stats.penalties_saved} penalties saved`,
      value: stats.penalties_saved,
      pts,
    })
  }
  if (pos === 1 && n(stats.goals_conceded) >= 2) {
    const pts = -1 * Math.floor(stats.goals_conceded / 2)
    events.push({
      label: `${stats.goals_conceded} goals conceded`,
      value: stats.goals_conceded,
      pts,
    })
  }
  return events
}

const ALL_PLAYER_STAT_OPTIONS = [
  { key: 'points', label: 'Points' },
  { key: 'goals', label: 'Goals' },
  { key: 'assists', label: 'Assists' },
  { key: 'goal_involvements', label: 'Goal involvements' },
  { key: 'clean_sheets', label: 'Clean sheets' },
  { key: 'saves', label: 'Saves' },
  { key: 'bps', label: 'BPS' },
  { key: 'bonus', label: 'Bonus' },
  { key: 'defensive_contribution', label: 'DEFCON' },
  { key: 'yellow_cards', label: 'YC' },
  { key: 'red_cards', label: 'RC' },
  { key: 'expected_goals', label: 'xG' },
  { key: 'expected_assists', label: 'xA' },
  { key: 'expected_goal_involvements', label: 'xGI' },
  { key: 'expected_goals_conceded', label: 'xGC' },
]

export default function PlayerDetailModal({
  playerId,
  playerName,
  gameweek,
  leagueManagerCount = null,
  leagueManagerIds = null,
  onClose,
}) {
  const [selectedPlayerStat, setSelectedPlayerStat] = useState('points')
  const [chartRangeFilter, setChartRangeFilter] = useState('last6')
  const [showPlayerStatPopup, setShowPlayerStatPopup] = useState(false)
  const [detailsExpanded, setDetailsExpanded] = useState(true)
  const [pointsImpactExpanded, setPointsImpactExpanded] = useState(true)
  const [chartExpanded, setChartExpanded] = useState(true)
  const [scheduleExpanded, setScheduleExpanded] = useState(true)
  const [opponentStatsExpanded, setOpponentStatsExpanded] = useState(true)
  const playerStatPopupRef = useRef(null)
  const filterPopupPanelRef = useRef(null)

  const {
    player: playerDetailPlayer,
    currentPrice,
    seasonPoints,
    overallRank,
    positionRank,
    gameweekPoints = [],
    leagueOwnershipPct,
    overallOwnershipPct,
    loading: playerDetailLoading,
  } = usePlayerDetail(playerId, gameweek, leagueManagerCount, leagueManagerIds)

  const { stats: gwStats, loading: gwStatsLoading } = usePlayerGameweekStats(playerId, gameweek)
  const pointsImpactEvents = useMemo(
    () => getPointsImpactEvents(gwStats, playerDetailPlayer?.position),
    [gwStats, playerDetailPlayer?.position]
  )
  const gwTotalPts = gwStats?.effective_points ?? gwStats?.points ?? 0

  const { byTeamId: teamLast6ByTeamId, loading: teamLast6Loading } = useTeamLast6Stats()
  const config = useConfiguration()
  const difficultyOverridesByDimension = useMemo(
    () => ({
      overall: config?.teamStrengthOverrides ?? null,
      attack: config?.teamAttackOverrides ?? null,
      defence: config?.teamDefenceOverrides ?? null,
    }),
    [config?.teamStrengthOverrides, config?.teamAttackOverrides, config?.teamDefenceOverrides]
  )
  const useCustomDifficulty = useMemo(
    () =>
      (config?.teamStrengthOverrides && Object.keys(config.teamStrengthOverrides).length > 0) ||
      (config?.teamAttackOverrides && Object.keys(config.teamAttackOverrides).length > 0) ||
      (config?.teamDefenceOverrides && Object.keys(config.teamDefenceOverrides).length > 0),
    [config?.teamStrengthOverrides, config?.teamAttackOverrides, config?.teamDefenceOverrides]
  )

  const playerStatOptions = useMemo(() => {
    const position = playerDetailPlayer?.position
    return ALL_PLAYER_STAT_OPTIONS.filter((opt) => {
      if (opt.key === 'saves' && position != null && position !== 1) return false
      if (opt.key === 'clean_sheets' && position === 4) return false
      return true
    })
  }, [playerDetailPlayer?.position])

  useEffect(() => {
    if (!playerStatOptions.some((o) => o.key === selectedPlayerStat) && playerStatOptions.length > 0) {
      setSelectedPlayerStat(playerStatOptions[0].key)
    }
  }, [playerStatOptions, selectedPlayerStat])

  useEffect(() => {
    if (!showPlayerStatPopup) return
    const handleClickOutside = (e) => {
      const insideHeader = playerStatPopupRef.current?.contains(e.target)
      const insidePopup = filterPopupPanelRef.current?.contains(e.target)
      if (!insideHeader && !insidePopup) setShowPlayerStatPopup(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showPlayerStatPopup])

  useEffect(() => {
    if (playerId == null) return
    const handleEscape = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [playerId, onClose])

  if (playerId == null) return null

  return (
    <div
      className="manager-detail-modal-overlay player-detail-modal-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="player-detail-modal-title"
    >
      <div
        className="manager-detail-modal-content player-detail-modal-content"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="manager-detail-modal-header">
          <div className="manager-detail-modal-header-title-wrap player-detail-modal-header-row">
            {playerDetailPlayer?.team_short_name && (
              <img
                src={`/badges/${playerDetailPlayer.team_short_name}.svg`}
                alt=""
                className="player-detail-modal-badge"
                onError={(e) => { e.target.style.display = 'none' }}
              />
            )}
            <h2 id="player-detail-modal-title" className="manager-detail-modal-title">
              {playerName || 'Player'}
            </h2>
            {playerDetailPlayer?.positionLabel && (
              <span className="player-detail-modal-position-pill">
                {playerDetailPlayer.positionLabel}
              </span>
            )}
          </div>
          <button
            type="button"
            className="manager-detail-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={20} strokeWidth={2} />
          </button>
        </div>
        <div className="manager-detail-modal-body player-detail-modal-body">
          <div className={`player-detail-bento-collapsible ${detailsExpanded ? 'player-detail-bento-collapsible--expanded' : 'player-detail-bento-collapsible--collapsed'}`}>
            <div className="player-detail-bento-collapsible-content">
              <div
                className="player-detail-bento-collapsible-header"
                role="button"
                tabIndex={0}
                onClick={() => setDetailsExpanded((v) => !v)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailsExpanded((v) => !v); } }}
                aria-expanded={detailsExpanded}
                aria-label={detailsExpanded ? 'Collapse Player details' : 'Expand Player details'}
              >
                <span className="player-detail-bento-collapsible-title">Player details</span>
                <span className="player-detail-bento-collapsible-expand-icon" title={detailsExpanded ? 'Collapse' : 'Expand'} aria-hidden>
                  {detailsExpanded ? <Minimize2 size={11} strokeWidth={1.5} /> : <MoveDiagonal size={11} strokeWidth={1.5} />}
                </span>
              </div>
              {detailsExpanded && (
                <div className="player-detail-bento-collapsible-body">
                  <div className="player-detail-details-bento bento-card bento-card-animate">
                    {playerDetailLoading ? (
                      <div className="bento-card-value loading">...</div>
                    ) : (
                      <div className="player-detail-details-grid">
                        <div className="player-detail-detail-row">
                          <span className="player-detail-detail-label">Current price</span>
                          <span className="player-detail-detail-value">
                            {currentPrice != null ? `£${currentPrice.toFixed(1)}` : '—'}
                          </span>
                        </div>
                        <div className="player-detail-detail-row">
                          <span className="player-detail-detail-label">Position rank (Pts)</span>
                          <span className="player-detail-detail-value">{positionRank != null ? positionRank : '—'}</span>
                        </div>
                        <div className="player-detail-detail-row">
                          <span className="player-detail-detail-label">Overall rank (Pts)</span>
                          <span className="player-detail-detail-value">{overallRank != null ? overallRank : '—'}</span>
                        </div>
                        <div className="player-detail-detail-row">
                          <span className="player-detail-detail-label">Total Pts</span>
                          <span className="player-detail-detail-value">{seasonPoints ?? '—'}</span>
                        </div>
                        <div className="player-detail-detail-row">
                          <span className="player-detail-detail-label">Ownership (League)</span>
                          <span className="player-detail-detail-value">
                            {leagueOwnershipPct != null ? `${leagueOwnershipPct}%` : '—'}
                          </span>
                        </div>
                        <div className="player-detail-detail-row">
                          <span className="player-detail-detail-label">Ownership (Overall)</span>
                          <span className="player-detail-detail-value">
                            {overallOwnershipPct != null ? `${overallOwnershipPct}%` : '—'}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className={`player-detail-bento-collapsible ${pointsImpactExpanded ? 'player-detail-bento-collapsible--expanded' : 'player-detail-bento-collapsible--collapsed'}`}>
            <div className="player-detail-bento-collapsible-content">
              <div
                className="player-detail-bento-collapsible-header"
                role="button"
                tabIndex={0}
                onClick={() => setPointsImpactExpanded((v) => !v)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPointsImpactExpanded((v) => !v); } }}
                aria-expanded={pointsImpactExpanded}
                aria-label={pointsImpactExpanded ? 'Collapse Gameweek Points' : 'Expand Gameweek Points'}
              >
                <span className="player-detail-bento-collapsible-title">
                  Gameweek Points
                  {pointsImpactExpanded && (
                    <span className="bento-card-label-suffix">
                      | GW{gameweek}
                    </span>
                  )}
                </span>
                <span className="player-detail-bento-collapsible-expand-icon" title={pointsImpactExpanded ? 'Collapse' : 'Expand'} aria-hidden>
                  {pointsImpactExpanded ? <Minimize2 size={11} strokeWidth={1.5} /> : <MoveDiagonal size={11} strokeWidth={1.5} />}
                </span>
              </div>
              {pointsImpactExpanded && (
                <div className="player-detail-bento-collapsible-body">
                  <div className="player-detail-points-impact-bento bento-card bento-card-animate">
                    {gwStatsLoading ? (
                      <div className="bento-card-value loading">...</div>
                    ) : pointsImpactEvents.length === 0 && gwTotalPts === 0 ? (
                      <div className="player-detail-points-impact-empty">No points this gameweek</div>
                    ) : (
                      <>
                        <div className="player-detail-points-impact-list">
                          {pointsImpactEvents.map((ev, i) => (
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
                          <span className="player-detail-points-impact-total-label">
                            Total points
                            {gwStats?.bonus_status === 'provisional' && (gwStats?.provisional_bonus ?? 0) > 0 ? (
                              <span className="player-detail-points-impact-total-provisional-hint"> (incl. provisional bonus)</span>
                            ) : null}
                          </span>
                          <span className="player-detail-points-impact-total-value">{gwTotalPts}</span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className={`player-detail-bento-collapsible ${chartExpanded ? 'player-detail-bento-collapsible--expanded' : 'player-detail-bento-collapsible--collapsed'}`}>
            <div className="player-detail-bento-collapsible-content">
              <div
                className="player-detail-bento-collapsible-header player-detail-chart-bento-header"
                role="button"
                tabIndex={0}
                onClick={() => setChartExpanded((v) => !v)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setChartExpanded((v) => !v); } }}
                aria-expanded={chartExpanded}
                aria-label={chartExpanded ? 'Collapse Stats by gameweek' : 'Expand Stats by gameweek'}
              >
                <div className="player-detail-chart-bento-header-inner" ref={playerStatPopupRef} onClick={(e) => e.stopPropagation()}>
                  <span className="bento-card-label player-detail-chart-bento-label">
                    Stats by gameweek
                    {chartExpanded && (
                      <span className="bento-card-label-suffix">
                        | {(() => { const o = playerStatOptions.find((opt) => opt.key === selectedPlayerStat); return o ? <CardStatLabel statKey={o.key} label={o.label} /> : 'Points'; })()}
                      </span>
                    )}
                  </span>
                  {chartExpanded && (
                    <div className="player-detail-chart-bento-actions">
                      <button
                        type="button"
                        className="player-detail-chart-stat-btn"
                        onClick={() => setShowPlayerStatPopup((v) => !v)}
                        aria-label="Filters: stat and GW range"
                        aria-expanded={showPlayerStatPopup}
                        aria-haspopup="dialog"
                        title="Filters"
                      >
                        <Filter size={14} strokeWidth={2} aria-hidden />
                      </button>
                    </div>
                  )}
                </div>
                <span className="player-detail-bento-collapsible-expand-icon" title={chartExpanded ? 'Collapse' : 'Expand'} aria-hidden>
                  {chartExpanded ? <Minimize2 size={11} strokeWidth={1.5} /> : <MoveDiagonal size={11} strokeWidth={1.5} />}
                </span>
              </div>
              {chartExpanded && (
                <div className="player-detail-bento-collapsible-body">
                  <div className="player-detail-chart-bento bento-card bento-card-animate">
                    <div className="player-detail-chart-wrap">
                      <PlayerGameweekPointsChart
                        key={`player-chart-${selectedPlayerStat}-${chartRangeFilter}`}
                        data={gameweekPoints}
                        loading={playerDetailLoading}
                        statKey={selectedPlayerStat}
                        position={playerDetailPlayer?.position}
                        filter={chartRangeFilter}
                        onFilterChange={setChartRangeFilter}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className={`player-detail-bento-collapsible player-detail-bento-collapsible--schedule ${scheduleExpanded ? 'player-detail-bento-collapsible--expanded' : 'player-detail-bento-collapsible--collapsed'}`}>
            <div className="player-detail-bento-collapsible-content">
              <div
                className="player-detail-bento-collapsible-header"
                role="button"
                tabIndex={0}
                onClick={() => setScheduleExpanded((v) => !v)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setScheduleExpanded((v) => !v); } }}
                aria-expanded={scheduleExpanded}
                aria-label={scheduleExpanded ? 'Collapse Schedule' : 'Expand Schedule'}
              >
                <span className="player-detail-bento-collapsible-title">Schedule</span>
                <span className="player-detail-bento-collapsible-expand-icon" title={scheduleExpanded ? 'Collapse' : 'Expand'} aria-hidden>
                  {scheduleExpanded ? <Minimize2 size={11} strokeWidth={1.5} /> : <MoveDiagonal size={11} strokeWidth={1.5} />}
                </span>
              </div>
              {scheduleExpanded && (
                <div className="player-detail-bento-collapsible-body player-detail-bento-collapsible-body--hide-label">
                  <ScheduleBento
                    teamId={playerDetailPlayer?.team_id}
                    opponentStatsByTeamId={teamLast6ByTeamId}
                    opponentStatsLoading={teamLast6Loading}
                    difficultyOverridesByDimension={difficultyOverridesByDimension}
                    useCustomDifficulty={useCustomDifficulty}
                  />
                </div>
              )}
            </div>
          </div>
          <div className={`player-detail-bento-collapsible ${opponentStatsExpanded ? 'player-detail-bento-collapsible--expanded' : 'player-detail-bento-collapsible--collapsed'}`}>
            <div className="player-detail-bento-collapsible-content">
              <div
                className="player-detail-bento-collapsible-header"
                role="button"
                tabIndex={0}
                onClick={() => setOpponentStatsExpanded((v) => !v)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpponentStatsExpanded((v) => !v); } }}
                aria-expanded={opponentStatsExpanded}
                aria-label={opponentStatsExpanded ? 'Collapse Opponent stat rankings' : 'Expand Opponent stat rankings'}
              >
                <span className="player-detail-bento-collapsible-title">Opponent stat rankings</span>
                <span className="player-detail-bento-collapsible-expand-icon" title={opponentStatsExpanded ? 'Collapse' : 'Expand'} aria-hidden>
                  {opponentStatsExpanded ? <Minimize2 size={11} strokeWidth={1.5} /> : <MoveDiagonal size={11} strokeWidth={1.5} />}
                </span>
              </div>
              {opponentStatsExpanded && (
                <div className="player-detail-bento-collapsible-body player-detail-bento-collapsible-body--hide-label">
                  <ScheduleOpponentStatsTable
                    teamId={playerDetailPlayer?.team_id}
                    opponentStatsByTeamId={teamLast6ByTeamId}
                    opponentStatsLoading={teamLast6Loading}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
        {showPlayerStatPopup && (
          <div ref={filterPopupPanelRef} className="player-detail-filter-popup-layer" style={{ position: 'fixed', inset: 0, zIndex: 1200, pointerEvents: 'auto' }}>
            <div
              className="player-detail-filter-backdrop"
              style={{ position: 'absolute', inset: 0, pointerEvents: 'auto' }}
              onClick={() => setShowPlayerStatPopup(false)}
              aria-hidden
            />
            <div
              className="player-detail-filter-popup-portal"
              style={{ position: 'fixed', inset: 0, zIndex: 1, pointerEvents: 'auto' }}
              onClick={() => setShowPlayerStatPopup(false)}
            >
              <div
                className="player-detail-stat-popup stats-filter-overlay-panel"
                role="dialog"
                aria-label="Filters"
                style={{ pointerEvents: 'auto' }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="stats-filter-overlay-header">
                  <span className="stats-filter-overlay-title">Filters</span>
                  <div className="stats-filter-overlay-header-actions">
                    <button
                      type="button"
                      className="stats-filter-overlay-close"
                      onClick={() => setShowPlayerStatPopup(false)}
                      aria-label="Close"
                    >
                      <X size={20} strokeWidth={2} />
                    </button>
                  </div>
                </div>
                <div className="stats-filter-overlay-body">
                  <div className="stats-filter-section">
                    <div className="stats-filter-section-title">Statistic</div>
                    <div className="stats-filter-buttons">
                      {playerStatOptions.map(({ key, label }) => (
                        <button
                          key={key}
                          type="button"
                          className={`stats-filter-option-btn ${selectedPlayerStat === key ? 'stats-filter-option-btn--active' : ''}`}
                          onClick={() => {
                            setSelectedPlayerStat(key)
                            setShowPlayerStatPopup(false)
                          }}
                          aria-pressed={selectedPlayerStat === key}
                        >
                          <CardStatLabel statKey={key} label={label} />
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="stats-filter-section">
                    <div className="stats-filter-section-title">Chart range</div>
                    <div className="stats-filter-buttons">
                      {CHART_RANGE_FILTERS.map(({ key, label }) => (
                        <button
                          key={key}
                          type="button"
                          className={`stats-filter-option-btn ${chartRangeFilter === key ? 'stats-filter-option-btn--active' : ''}`}
                          onClick={() => setChartRangeFilter(key)}
                          aria-pressed={chartRangeFilter === key}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="stats-filter-overlay-footer">
                  <button
                    type="button"
                    className="stats-filter-overlay-done"
                    onClick={() => setShowPlayerStatPopup(false)}
                    aria-label="Done"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
