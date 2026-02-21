import { useState, useMemo, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, Filter } from 'lucide-react'
import { CardStatLabel } from './CardStatLabel'
import { useTeamDetail } from '../hooks/useTeamDetail'
import { useTeamLast6Stats } from '../hooks/useTeamLast6Stats'
import { useConfiguration } from '../contexts/ConfigurationContext'
import PlayerGameweekPointsChart, { CHART_RANGE_FILTERS } from './PlayerGameweekPointsChart'
import ScheduleBento from './ScheduleBento'
import ScheduleOpponentStatsTable from './ScheduleOpponentStatsTable'
import './MiniLeaguePage.css'

const ALL_TEAM_STAT_OPTIONS = [
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

export default function TeamDetailModal({
  teamId,
  teamName,
  gameweek,
  pointsRank = null,
  onClose,
}) {
  const [selectedStat, setSelectedStat] = useState('points')
  const [chartRangeFilter, setChartRangeFilter] = useState('last6')
  const [showStatPopup, setShowStatPopup] = useState(false)
  const [chartAverage, setChartAverage] = useState(null)
  const statPopupRef = useRef(null)
  const filterPopupLayerRef = useRef(null)

  const {
    team,
    seasonPoints,
    gameweekPoints = [],
    loading: teamDetailLoading,
  } = useTeamDetail(teamId, gameweek)

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

  const resolvedTeamId = team?.team_id ?? teamId

  useEffect(() => {
    if (!ALL_TEAM_STAT_OPTIONS.some((o) => o.key === selectedStat)) {
      setSelectedStat('points')
    }
  }, [selectedStat])

  useEffect(() => {
    if (teamDetailLoading) setChartAverage(null)
  }, [teamDetailLoading])

  useEffect(() => {
    if (!showStatPopup) return
    const handleClickOutside = (e) => {
      const inTrigger = statPopupRef.current && statPopupRef.current.contains(e.target)
      const inPopup = filterPopupLayerRef.current && filterPopupLayerRef.current.contains(e.target)
      if (!inTrigger && !inPopup) setShowStatPopup(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showStatPopup])

  useEffect(() => {
    if (teamId == null) return
    const handleEscape = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [teamId, onClose])

  if (teamId == null) return null

  const displayName = teamName || team?.team_name || 'Team'
  const badgeShortName = team?.short_name ?? null

  return (
    <div
      className="manager-detail-modal-overlay team-detail-modal-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="team-detail-modal-title"
    >
      <div
        className="manager-detail-modal-content team-detail-modal-content"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="manager-detail-modal-header">
          <div className="manager-detail-modal-header-title-wrap player-detail-modal-header-row">
            {badgeShortName && (
              <img
                src={`/badges/${badgeShortName}.svg`}
                alt=""
                className="player-detail-modal-badge"
                onError={(e) => { e.target.style.display = 'none' }}
              />
            )}
            <h2 id="team-detail-modal-title" className="manager-detail-modal-title">
              {displayName}
            </h2>
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
        <div className="manager-detail-modal-body player-detail-modal-body team-detail-modal-body">
          <div className="player-detail-details-bento bento-card bento-card-animate">
            <span className="bento-card-label">Team details</span>
            {teamDetailLoading ? (
              <div className="bento-card-value loading">...</div>
            ) : (
              <div className="player-detail-details-grid">
                <div className="player-detail-detail-row">
                  <span className="player-detail-detail-label">Rank (Pts)</span>
                  <span className="player-detail-detail-value">{pointsRank != null ? pointsRank : '—'}</span>
                </div>
                <div className="player-detail-detail-row">
                  <span className="player-detail-detail-label">Total Pts</span>
                  <span className="player-detail-detail-value">{seasonPoints ?? '—'}</span>
                </div>
              </div>
            )}
          </div>
          <div className="player-detail-chart-bento bento-card bento-card-animate">
            <div className="player-detail-chart-bento-header" ref={statPopupRef}>
              <span className="bento-card-label player-detail-chart-bento-label">
                Stats by gameweek
                <span className="bento-card-label-suffix">
                  | {(() => { const o = ALL_TEAM_STAT_OPTIONS.find((opt) => opt.key === selectedStat); return o ? <CardStatLabel statKey={o.key} label={o.label} /> : 'Points'; })()}
                </span>
              </span>
              <div className="player-detail-chart-bento-actions">
                <button
                  type="button"
                  className="player-detail-chart-stat-btn"
                  onClick={() => setShowStatPopup((v) => !v)}
                  aria-label="Filters: stat and GW range"
                  aria-expanded={showStatPopup}
                  aria-haspopup="dialog"
                  title="Filters"
                >
                  <Filter size={14} strokeWidth={2} aria-hidden />
                </button>
              </div>
            </div>
            {chartAverage != null && (
              <div className="player-detail-chart-bento-average">Average: {chartAverage} per GW</div>
            )}
            <div className="player-detail-chart-wrap">
              <PlayerGameweekPointsChart
                key={`team-chart-${selectedStat}-${chartRangeFilter}`}
                data={gameweekPoints}
                loading={teamDetailLoading}
                statKey={selectedStat}
                position={null}
                onAverageChange={setChartAverage}
                filter={chartRangeFilter}
                onFilterChange={setChartRangeFilter}
              />
            </div>
          </div>
          <ScheduleBento
            teamId={resolvedTeamId}
            opponentStatsByTeamId={teamLast6ByTeamId}
            opponentStatsLoading={teamLast6Loading}
            difficultyOverridesByDimension={difficultyOverridesByDimension}
            useCustomDifficulty={useCustomDifficulty}
          />
          <ScheduleOpponentStatsTable
            teamId={resolvedTeamId}
            opponentStatsByTeamId={teamLast6ByTeamId}
            opponentStatsLoading={teamLast6Loading}
          />
        </div>
        {showStatPopup && typeof document !== 'undefined' && createPortal(
          <div ref={filterPopupLayerRef} className="team-detail-filter-popup-layer" style={{ position: 'fixed', inset: 0, zIndex: 1200, pointerEvents: 'none' }}>
            <div
              className="player-detail-filter-backdrop"
              style={{ position: 'absolute', inset: 0, pointerEvents: 'auto' }}
              onClick={() => setShowStatPopup(false)}
              aria-hidden
            />
            <div
              className="player-detail-filter-popup-portal"
              style={{ position: 'fixed', inset: 0, zIndex: 1, pointerEvents: 'auto' }}
              onClick={() => setShowStatPopup(false)}
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
                      onClick={() => setShowStatPopup(false)}
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
                      {ALL_TEAM_STAT_OPTIONS.map(({ key, label }) => (
                        <button
                          key={key}
                          type="button"
                          className={`stats-filter-option-btn ${selectedStat === key ? 'stats-filter-option-btn--active' : ''}`}
                          onClick={() => {
                            setSelectedStat(key)
                            setShowStatPopup(false)
                          }}
                          aria-pressed={selectedStat === key}
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
                    onClick={() => setShowStatPopup(false)}
                    aria-label="Done"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
      </div>
    </div>
  )
}
