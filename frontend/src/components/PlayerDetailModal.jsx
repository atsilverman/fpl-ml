import { useState, useMemo, useEffect, useRef } from 'react'
import { X, Eye } from 'lucide-react'
import { usePlayerDetail } from '../hooks/usePlayerDetail'
import PlayerGameweekPointsChart from './PlayerGameweekPointsChart'
import ScheduleBento from './ScheduleBento'
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
  { key: 'yellow_cards', label: 'Yellow cards' },
  { key: 'red_cards', label: 'Red cards' },
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
                  | {playerStatOptions.find((o) => o.key === selectedPlayerStat)?.label ?? 'Points'}
                </span>
              </span>
              <div className="player-detail-chart-bento-actions">
                <button
                  type="button"
                  className="player-detail-chart-stat-btn"
                  onClick={() => setShowPlayerStatPopup((v) => !v)}
                  aria-label="Choose stat to display"
                  aria-expanded={showPlayerStatPopup}
                  aria-haspopup="dialog"
                  title="Show stat"
                >
                  <Eye size={14} strokeWidth={2} aria-hidden />
                </button>
                {showPlayerStatPopup && (
                  <div className="player-detail-stat-popup gw-legend-popup" role="dialog" aria-label="Chart stat filter">
                    <div className="gw-legend-popup-title">Show stat</div>
                    {playerStatOptions.map(({ key, label }) => (
                      <div
                        key={key}
                        className={`gw-legend-popup-row player-detail-stat-popup-row ${selectedPlayerStat === key ? 'player-detail-stat-popup-row--active' : ''}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          setSelectedPlayerStat(key)
                          setShowPlayerStatPopup(false)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            setSelectedPlayerStat(key)
                            setShowPlayerStatPopup(false)
                          }
                        }}
                      >
                        <span className="gw-legend-popup-text">{label}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {chartAverage != null && (
              <div className="player-detail-chart-bento-average">Average: {chartAverage} per GW</div>
            )}
            <div className="player-detail-chart-wrap">
              <PlayerGameweekPointsChart
                data={gameweekPoints}
                loading={playerDetailLoading}
                statKey={selectedPlayerStat}
                position={playerDetailPlayer?.position}
                onAverageChange={setChartAverage}
              />
            </div>
          </div>
          <ScheduleBento teamId={playerDetailPlayer?.team_id} />
        </div>
      </div>
    </div>
  )
}
