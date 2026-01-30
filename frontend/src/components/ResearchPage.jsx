import { useState } from 'react'
import { useGameweekData } from '../hooks/useGameweekData'
import { usePlayerResearch } from '../hooks/usePlayerResearch'
import './ResearchPage.css'

export default function ResearchPage() {
  const { gameweek } = useGameweekData()
  const { players, loading } = usePlayerResearch(gameweek)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterPosition, setFilterPosition] = useState('all')

  const filteredPlayers = players.filter(player => {
    const matchesSearch = !searchTerm || 
      player.player?.web_name?.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesPosition = filterPosition === 'all' || 
      player.player?.position?.toString() === filterPosition
    return matchesSearch && matchesPosition
  })

  const positionNames = {
    '1': 'GK',
    '2': 'DEF',
    '3': 'MID',
    '4': 'FWD'
  }

  return (
    <div className="research-page">
      <h2>Player Research - Gameweek {gameweek}</h2>
      
      <div className="research-filters">
        <input
          type="text"
          placeholder="Search players..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="search-input"
        />
        <select
          value={filterPosition}
          onChange={(e) => setFilterPosition(e.target.value)}
          className="position-filter"
        >
          <option value="all">All Positions</option>
          <option value="1">Goalkeeper</option>
          <option value="2">Defender</option>
          <option value="3">Midfielder</option>
          <option value="4">Forward</option>
        </select>
      </div>

      {loading ? (
        <div className="loading-state">Loading players...</div>
      ) : (
        <div className="players-grid">
          {filteredPlayers.map((item) => (
            <div key={item.player_id} className="player-card">
              <div className="player-header">
                <span className="player-name">{item.player?.web_name || 'Unknown'}</span>
                <span className="player-position">{positionNames[item.player?.position] || '—'}</span>
              </div>
              <div className="player-stats">
                <div className="stat">
                  <span className="stat-label">Points</span>
                  <span className="stat-value">{item.total_points}</span>
                </div>
                <div className="stat">
                  <span className="stat-label">Goals</span>
                  <span className="stat-value">{item.goals_scored || 0}</span>
                </div>
                <div className="stat">
                  <span className="stat-label">Assists</span>
                  <span className="stat-value">{item.assists || 0}</span>
                </div>
                <div className="stat">
                  <span className="stat-label">DEFCON</span>
                  <span className="stat-value">{item.defcon || 0}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
