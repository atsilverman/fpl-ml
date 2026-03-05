import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useAllTeams } from '../hooks/useAllTeams'
import { useGameweekData } from '../hooks/useGameweekData'
import TeamDetailModal from './TeamDetailModal'
import './ResearchPage.css'
import './TeamsSubpage.css'

export default function TeamsSubpage() {
  const { teams, loading } = useAllTeams()
  const { gameweek } = useGameweekData()
  const [selectedTeamId, setSelectedTeamId] = useState(null)
  const [selectedTeamName, setSelectedTeamName] = useState('')

  const handleTeamClick = (team) => {
    setSelectedTeamId(team.team_id)
    setSelectedTeamName(team.team_name || team.short_name || '')
  }

  return (
    <div className="research-teams-subpage">
      <div className="research-teams-card research-card bento-card bento-card-animate bento-card-expanded">
        <div className="research-teams-content">
          {loading ? (
            <div className="research-teams-loading">Loading teams…</div>
          ) : (
            <div className="research-teams-grid" role="list">
              {teams.map((team) => (
                <button
                  key={team.team_id}
                  type="button"
                  className="research-teams-bento"
                  onClick={() => handleTeamClick(team)}
                  aria-label={`View details for ${team.team_name || team.short_name || 'Team'}`}
                  role="listitem"
                >
                  <span className="research-teams-bento-badge-wrap">
                    <img
                      src={`/badges/${team.short_name}.svg`}
                      alt=""
                      className="research-teams-bento-badge"
                      onError={(e) => { e.target.style.display = 'none' }}
                    />
                  </span>
                  <span className="research-teams-bento-name">
                    {team.team_name || team.short_name || `Team ${team.team_id}`}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {selectedTeamId != null && typeof document !== 'undefined' && createPortal(
        <TeamDetailModal
          teamId={selectedTeamId}
          teamName={selectedTeamName}
          gameweek={gameweek}
          onClose={() => {
            setSelectedTeamId(null)
            setSelectedTeamName('')
          }}
        />,
        document.body
      )}
    </div>
  )
}
