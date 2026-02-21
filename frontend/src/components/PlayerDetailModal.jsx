import { useState, useMemo, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, Filter } from 'lucide-react'
import { CardStatLabel } from './CardStatLabel'
import { usePlayerDetail } from '../hooks/usePlayerDetail'
import { useTeamLast6Stats } from '../hooks/useTeamLast6Stats'
import { useConfiguration } from '../contexts/ConfigurationContext'
import PlayerGameweekPointsChart, { CHART_RANGE_FILTERS } from './PlayerGameweekPointsChart'
import ScheduleBento from './ScheduleBento'
import ScheduleOpponentStatsTable from './ScheduleOpponentStatsTable'
import './MiniLeaguePage.css'

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
  const [chartAverage, setChartAverage] = useState(null)
  const playerStatPopupRef = useRef(null)

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
    if (playerDetailLoading) setChartAverage(null)
  }, [playerDetailLoading])

  useEffect(() => {
    if (!showPlayerStatPopup) return
    const handleClickOutside = (e) => {
      if (playerStatPopupRef.current && !playerStatPopupRef.current.contains(e.target)) {
        setShowPlayerStatPopup(false)
      }
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
          <div className="player-detail-details-bento bento-card bento-card-animate">
            <span className="bento-card-label">Player details</span>
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
          <div className="player-detail-chart-bento bento-card bento-card-animate">
            <div className="player-detail-chart-bento-header" ref={playerStatPopupRef}>
              <span className="bento-card-label player-detail-chart-bento-label">
                Stats by gameweek
                <span className="bento-card-label-suffix">
                  | {(() => { const o = playerStatOptions.find((opt) => opt.key === selectedPlayerStat); return o ? <CardStatLabel statKey={o.key} label={o.label} /> : 'Points'; })()}
                </span>
              </span>
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
            </div>
            {chartAverage != null && (
              <div className="player-detail-chart-bento-average">Average: {chartAverage} per GW</div>
            )}
            <div className="player-detail-chart-wrap">
              <PlayerGameweekPointsChart
                key={`player-chart-${selectedPlayerStat}-${chartRangeFilter}`}
                data={gameweekPoints}
                loading={playerDetailLoading}
                statKey={selectedPlayerStat}
                position={playerDetailPlayer?.position}
                onAverageChange={setChartAverage}
                filter={chartRangeFilter}
                onFilterChange={setChartRangeFilter}
              />
            </div>
          </div>
          <ScheduleBento
            teamId={playerDetailPlayer?.team_id}
            opponentStatsByTeamId={teamLast6ByTeamId}
            opponentStatsLoading={teamLast6Loading}
            difficultyOverridesByDimension={difficultyOverridesByDimension}
            useCustomDifficulty={useCustomDifficulty}
          />
          <ScheduleOpponentStatsTable
            teamId={playerDetailPlayer?.team_id}
            opponentStatsByTeamId={teamLast6ByTeamId}
            opponentStatsLoading={teamLast6Loading}
          />
        </div>
        {showPlayerStatPopup && typeof document !== 'undefined' && createPortal(
          <div className="player-detail-filter-popup-layer" style={{ position: 'fixed', inset: 0, zIndex: 1200, pointerEvents: 'auto' }}>
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
          </div>,
          document.body
        )}
      </div>
    </div>
  )
}
