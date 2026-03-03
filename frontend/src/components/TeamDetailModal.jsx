import { useState, useMemo, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, Filter, Minimize2, MoveDiagonal, ChevronUp, ChevronDown, ChevronsUp, ChevronsDown, Info } from 'lucide-react'

function ordinal(n) {
  if (n == null || n < 1) return '—'
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
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
  { key: 'goals_conceded', label: 'GC' },
  { key: 'expected_goals_conceded', label: 'xGC' },
]

export default function TeamDetailModal({
  teamId,
  teamName,
  gameweek,
  onClose,
}) {
  const [selectedStat, setSelectedStat] = useState('goals')
  const [chartRangeFilter, setChartRangeFilter] = useState(() => {
    if (typeof window === 'undefined') return 'gw20plus'
    return window.matchMedia('(max-width: 768px)').matches ? 'last6' : 'gw20plus'
  })
  const [showStatPopup, setShowStatPopup] = useState(false)
  const [detailsExpanded, setDetailsExpanded] = useState(true)
  const [chartExpanded, setChartExpanded] = useState(true)
  const [scheduleExpanded, setScheduleExpanded] = useState(true)
  const [opponentStatsExpanded, setOpponentStatsExpanded] = useState(true)
  const [showDetailsRankInfo, setShowDetailsRankInfo] = useState(false)
  const statPopupRef = useRef(null)
  const filterPopupLayerRef = useRef(null)
  const detailsRankInfoRef = useRef(null)
  const detailsRankInfoMsgRef = useRef(null)

  const {
    team,
    gameweekPoints = [],
    tablePosition,
    rankGoals,
    rankXg,
    rankGoalsConceded,
    rankXgc,
    tablePositionChange,
    rankGoalsChange,
    rankXgChange,
    rankGoalsConcededChange,
    rankXgcChange,
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
      setSelectedStat('goals')
    }
  }, [selectedStat])

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
    if (!showDetailsRankInfo) return
    const handleClickOutside = (e) => {
      const inBtn = detailsRankInfoRef.current?.contains(e.target)
      const inMsg = detailsRankInfoMsgRef.current?.contains(e.target)
      if (!inBtn && !inMsg) setShowDetailsRankInfo(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showDetailsRankInfo])

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
          <div className={`player-detail-bento-collapsible player-detail-bento-collapsible--bento-1x1 team-details-bento ${detailsExpanded ? 'player-detail-bento-collapsible--expanded' : 'player-detail-bento-collapsible--collapsed'}`}>
            <div className="player-detail-bento-collapsible-content">
              <div
                className="player-detail-bento-collapsible-header"
                role="button"
                tabIndex={0}
                onClick={() => setDetailsExpanded((v) => !v)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailsExpanded((v) => !v); } }}
                aria-expanded={detailsExpanded}
                aria-label={detailsExpanded ? 'Collapse Team details' : 'Expand Team details'}
              >
                <span className="player-detail-bento-collapsible-title">Team details</span>
                <div className="team-details-header-actions" ref={detailsRankInfoRef}>
                  <button
                    type="button"
                    className="team-details-info-btn"
                    onClick={(e) => { e.stopPropagation(); setShowDetailsRankInfo((v) => !v); }}
                    aria-label={showDetailsRankInfo ? 'Hide rank change explanation' : 'What do the rank changes mean?'}
                    aria-expanded={showDetailsRankInfo}
                    title="Rank change explanation"
                  >
                    <Info size={11} strokeWidth={1.5} aria-hidden />
                  </button>
                  <span className="player-detail-bento-collapsible-expand-icon" title={detailsExpanded ? 'Collapse' : 'Expand'} aria-hidden>
                    {detailsExpanded ? <Minimize2 size={11} strokeWidth={1.5} /> : <MoveDiagonal size={11} strokeWidth={1.5} />}
                  </span>
                </div>
              </div>
              {detailsExpanded && (
                <div className="player-detail-bento-collapsible-body team-details-bento-body">
                  {showDetailsRankInfo && (
                    <p ref={detailsRankInfoMsgRef} className="team-details-rank-info-msg">
                      Rank changes show how each stat has moved compared to last gameweek. Green ↑ = improved position, red ↓ = dropped.
                    </p>
                  )}
                  {teamDetailLoading ? (
                    <div className="bento-card-value loading">...</div>
                  ) : (
                    <div className="team-details-stats">
                      <div className="team-details-stat">
                        <span className="team-details-stat-label">Table</span>
                        <div className="team-details-stat-value-wrap">
                          <span className="team-details-stat-value">{tablePosition != null ? ordinal(tablePosition) : '—'}</span>
                          {tablePositionChange != null && tablePositionChange !== 0 ? (
                            <span className={`team-details-rank-change league-standings-bento-change-badge ${tablePositionChange > 0 ? 'positive' : 'negative'}`} title={`${tablePositionChange > 0 ? '+' : ''}${tablePositionChange} since last gameweek`}>
                              {Math.abs(tablePositionChange) >= 2 ? (tablePositionChange > 0 ? <ChevronsUp size={10} /> : <ChevronsDown size={10} />) : (tablePositionChange > 0 ? <ChevronUp size={10} /> : <ChevronDown size={10} />)}{' '}
                              {Math.abs(tablePositionChange)}
                            </span>
                          ) : (
                            <span className="team-details-rank-change-placeholder" aria-hidden />
                          )}
                        </div>
                      </div>
                      <div className="team-details-stat">
                        <span className="team-details-stat-label">Goals</span>
                        <div className="team-details-stat-value-wrap">
                          <span className="team-details-stat-value">{rankGoals != null ? ordinal(rankGoals) : '—'}</span>
                          {rankGoalsChange != null && rankGoalsChange !== 0 ? (
                            <span className={`team-details-rank-change league-standings-bento-change-badge ${rankGoalsChange > 0 ? 'positive' : 'negative'}`} title={`${rankGoalsChange > 0 ? '+' : ''}${rankGoalsChange} since last gameweek`}>
                              {Math.abs(rankGoalsChange) >= 2 ? (rankGoalsChange > 0 ? <ChevronsUp size={10} /> : <ChevronsDown size={10} />) : (rankGoalsChange > 0 ? <ChevronUp size={10} /> : <ChevronDown size={10} />)}{' '}
                              {Math.abs(rankGoalsChange)}
                            </span>
                          ) : (
                            <span className="team-details-rank-change-placeholder" aria-hidden />
                          )}
                        </div>
                      </div>
                      <div className="team-details-stat">
                        <span className="team-details-stat-label">xG</span>
                        <div className="team-details-stat-value-wrap">
                          <span className="team-details-stat-value">{rankXg != null ? ordinal(rankXg) : '—'}</span>
                          {rankXgChange != null && rankXgChange !== 0 ? (
                            <span className={`team-details-rank-change league-standings-bento-change-badge ${rankXgChange > 0 ? 'positive' : 'negative'}`} title={`${rankXgChange > 0 ? '+' : ''}${rankXgChange} since last gameweek`}>
                              {Math.abs(rankXgChange) >= 2 ? (rankXgChange > 0 ? <ChevronsUp size={10} /> : <ChevronsDown size={10} />) : (rankXgChange > 0 ? <ChevronUp size={10} /> : <ChevronDown size={10} />)}{' '}
                              {Math.abs(rankXgChange)}
                            </span>
                          ) : (
                            <span className="team-details-rank-change-placeholder" aria-hidden />
                          )}
                        </div>
                      </div>
                      <div className="team-details-stat">
                        <span className="team-details-stat-label">GC</span>
                        <div className="team-details-stat-value-wrap">
                          <span className="team-details-stat-value">{rankGoalsConceded != null ? ordinal(rankGoalsConceded) : '—'}</span>
                          {rankGoalsConcededChange != null && rankGoalsConcededChange !== 0 ? (
                            <span className={`team-details-rank-change league-standings-bento-change-badge ${rankGoalsConcededChange > 0 ? 'positive' : 'negative'}`} title="Lower GC rank is better (fewer goals conceded); positive = improved">
                              {Math.abs(rankGoalsConcededChange) >= 2 ? (rankGoalsConcededChange > 0 ? <ChevronsUp size={10} /> : <ChevronsDown size={10} />) : (rankGoalsConcededChange > 0 ? <ChevronUp size={10} /> : <ChevronDown size={10} />)}{' '}
                              {Math.abs(rankGoalsConcededChange)}
                            </span>
                          ) : (
                            <span className="team-details-rank-change-placeholder" aria-hidden />
                          )}
                        </div>
                      </div>
                      <div className="team-details-stat">
                        <span className="team-details-stat-label">xGC</span>
                        <div className="team-details-stat-value-wrap">
                          <span className="team-details-stat-value">{rankXgc != null ? ordinal(rankXgc) : '—'}</span>
                          {rankXgcChange != null && rankXgcChange !== 0 ? (
                            <span className={`team-details-rank-change league-standings-bento-change-badge ${rankXgcChange > 0 ? 'positive' : 'negative'}`} title="Lower xGC rank is better; positive = improved">
                              {Math.abs(rankXgcChange) >= 2 ? (rankXgcChange > 0 ? <ChevronsUp size={10} /> : <ChevronsDown size={10} />) : (rankXgcChange > 0 ? <ChevronUp size={10} /> : <ChevronDown size={10} />)}{' '}
                              {Math.abs(rankXgcChange)}
                            </span>
                          ) : (
                            <span className="team-details-rank-change-placeholder" aria-hidden />
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className={`player-detail-bento-collapsible player-detail-bento-collapsible--bento-1x2 ${chartExpanded ? 'player-detail-bento-collapsible--expanded' : 'player-detail-bento-collapsible--collapsed'}`}>
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
                <div className="player-detail-chart-bento-header-inner" ref={statPopupRef} onClick={(e) => e.stopPropagation()}>
                  <span className="bento-card-label player-detail-chart-bento-label">
                    Stats by gameweek
                    {chartExpanded && (
                      <span className="bento-card-label-suffix">
                        | {(() => { const o = ALL_TEAM_STAT_OPTIONS.find((opt) => opt.key === selectedStat); return o ? <CardStatLabel statKey={o.key} label={o.label} /> : 'Points'; })()}
                      </span>
                    )}
                  </span>
                  {chartExpanded && (
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
                        <Filter size={11} strokeWidth={1.5} aria-hidden />
                      </button>
                    </div>
                  )}
                </div>
                <span className="player-detail-bento-collapsible-expand-icon" title={chartExpanded ? 'Collapse' : 'Expand'} aria-hidden>
                  {chartExpanded ? <Minimize2 size={11} strokeWidth={1.5} /> : <MoveDiagonal size={11} strokeWidth={1.5} />}
                </span>
              </div>
              {chartExpanded && (
                <div className="player-detail-bento-collapsible-body player-detail-bento-collapsible-body--chart">
                  <div className="player-detail-chart-wrap">
                    <PlayerGameweekPointsChart
                      key={`team-chart-${selectedStat}-${chartRangeFilter}`}
                      data={gameweekPoints}
                      loading={teamDetailLoading}
                      statKey={selectedStat}
                      position={null}
                      filter={chartRangeFilter}
                      onFilterChange={setChartRangeFilter}
                      compactBars
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className={`player-detail-bento-collapsible player-detail-bento-collapsible--schedule player-detail-bento-collapsible--bento-1x1 ${scheduleExpanded ? 'player-detail-bento-collapsible--expanded' : 'player-detail-bento-collapsible--collapsed'}`}>
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
                <div className="player-detail-bento-collapsible-body player-detail-bento-collapsible-body--hide-label player-detail-bento-collapsible-body--schedule">
                  <ScheduleBento
                    embedded
                    teamId={resolvedTeamId}
                    opponentStatsByTeamId={teamLast6ByTeamId}
                    opponentStatsLoading={teamLast6Loading}
                    difficultyOverridesByDimension={difficultyOverridesByDimension}
                    useCustomDifficulty={useCustomDifficulty}
                  />
                </div>
              )}
            </div>
          </div>
          <div className={`player-detail-bento-collapsible player-detail-bento-collapsible--bento-1x3 ${opponentStatsExpanded ? 'player-detail-bento-collapsible--expanded' : 'player-detail-bento-collapsible--collapsed'}`}>
            <div className="player-detail-bento-collapsible-content">
              <div
                className="player-detail-bento-collapsible-header"
                role="button"
                tabIndex={0}
                onClick={() => setOpponentStatsExpanded((v) => !v)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpponentStatsExpanded((v) => !v); } }}
                aria-expanded={opponentStatsExpanded}
                aria-label={opponentStatsExpanded ? 'Collapse Opponent Statistic Rank (Last 6 GW)' : 'Expand Opponent Statistic Rank (Last 6 GW)'}
              >
                <span className="player-detail-bento-collapsible-title">Opponent Statistic Rank (Last 6 GW)</span>
                <span className="player-detail-bento-collapsible-expand-icon" title={opponentStatsExpanded ? 'Collapse' : 'Expand'} aria-hidden>
                  {opponentStatsExpanded ? <Minimize2 size={11} strokeWidth={1.5} /> : <MoveDiagonal size={11} strokeWidth={1.5} />}
                </span>
              </div>
              {opponentStatsExpanded && (
                <div className="player-detail-bento-collapsible-body player-detail-bento-collapsible-body--hide-label player-detail-bento-collapsible-body--opponent-stats">
                  <ScheduleOpponentStatsTable
                    embedded
                    teamId={resolvedTeamId}
                    opponentStatsByTeamId={teamLast6ByTeamId}
                    opponentStatsLoading={teamLast6Loading}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
        {showStatPopup && typeof document !== 'undefined' && createPortal(
          <div ref={filterPopupLayerRef} className="player-detail-filter-popup-layer" style={{ position: 'fixed', inset: 0, zIndex: 1200, pointerEvents: 'auto' }}>
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
