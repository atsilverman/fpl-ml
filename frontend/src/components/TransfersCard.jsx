import { useTransfers } from '../hooks/useTransfers'
import { useGameweekData } from '../hooks/useGameweekData'
import './TransfersCard.css'

export default function TransfersCard() {
  const { gameweek } = useGameweekData()
  const { transfers, loading } = useTransfers(gameweek)

  if (loading) {
    return (
      <div className="bento-card">
        <div className="bento-card-label">Transfers</div>
        <div className="bento-card-value loading">
          <div className="skeleton-text"></div>
        </div>
      </div>
    )
  }

  const gwTransfers = transfers.filter(t => t.gameweek === gameweek)

  return (
    <div className="bento-card bento-card-large">
      <div className="bento-card-label">Transfers</div>
      {gwTransfers.length === 0 ? (
        <div className="bento-card-subtext">No transfers made</div>
      ) : (
        <div className="transfers-list">
          {gwTransfers.map((transfer, index) => (
            <div key={index} className="transfer-item">
              <span className="transfer-player-out">
                {transfer.player_out?.web_name || 'Unknown'}
              </span>
              <span className="transfer-arrow">→</span>
              <span className="transfer-player-in">
                {transfer.player_in?.web_name || 'Unknown'}
              </span>
              <span className={`transfer-net-value ${
                transfer.net_price_change_tenths >= 0 ? 'positive' : 'negative'
              }`}>
                {transfer.net_price_change_tenths >= 0 ? '+' : ''}
                {(transfer.net_price_change_tenths / 10).toFixed(1)}m
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
