import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useConfiguration } from '../contexts/ConfigurationContext'
import './ConfigurationModal.css'

export default function ConfigurationModal({ isOpen, onClose, onSave, currentConfig }) {
  const { config, saveTeamStrengthOverrides, resetTeamStrengthOverrides } = useConfiguration()
  const [step, setStep] = useState(1)
  const [selectedLeague, setSelectedLeague] = useState(null)
  const [selectedManagerId, setSelectedManagerId] = useState(null)

  // Fetch all leagues
  const { data: leagues = [], isLoading: leaguesLoading } = useQuery({
    queryKey: ['leagues'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mini_leagues')
        .select('league_id, league_name')
        .order('league_id', { ascending: true })
      
      if (error) throw error
      return data || []
    },
    enabled: isOpen,
    staleTime: 300000, // Cache for 5 minutes
  })

  // Fetch teams for step 3 (strength sliders); shares cache with useScheduleData
  const { data: teams = [], isLoading: teamsLoading } = useQuery({
    queryKey: ['teams', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teams')
        .select('team_id, short_name, team_name, strength')
        .order('team_id', { ascending: true })
      if (error) {
        const isMissingColumn = error.code === 'PGRST204' || error.status === 400 || error.message?.includes('strength')
        if (isMissingColumn) {
          const { data: fallback, error: err2 } = await supabase
            .from('teams')
            .select('team_id, short_name, team_name')
            .order('team_id', { ascending: true })
          if (err2) throw err2
          return (fallback ?? []).map((t) => ({ ...t, strength: null }))
        }
        throw error
      }
      return data ?? []
    },
    enabled: isOpen,
    staleTime: 5 * 60 * 1000,
  })

  // Fetch managers for selected league
  const { data: managers = [], isLoading: managersLoading } = useQuery({
    queryKey: ['managers', selectedLeague],
    queryFn: async () => {
      if (!selectedLeague) return []
      
      // First get manager IDs from the league
      const { data: leagueManagers, error: leagueError } = await supabase
        .from('mini_league_managers')
        .select('manager_id')
        .eq('league_id', selectedLeague)
      
      if (leagueError) throw leagueError
      
      if (!leagueManagers || leagueManagers.length === 0) return []
      
      // Then get manager details
      const managerIds = leagueManagers.map(m => m.manager_id)
      const { data: managerDetails, error: managerError } = await supabase
        .from('managers')
        .select('manager_id, manager_name, manager_team_name')
        .in('manager_id', managerIds)
        .order('manager_id', { ascending: true })
      
      if (managerError) throw managerError
      
      return (managerDetails || []).map(manager => ({
        manager_id: manager.manager_id,
        manager_name: manager.manager_name || null,
        manager_team_name: manager.manager_team_name || null
      }))
    },
    enabled: isOpen && step === 2 && !!selectedLeague,
    staleTime: 300000, // Cache for 5 minutes
  })

  // When modal opens: always show step 1 (league select) first; pre-seed selection for step 2 if already configured
  useEffect(() => {
    if (isOpen) {
      setStep(1)
      if (currentConfig?.leagueId != null && currentConfig?.managerId != null) {
        setSelectedLeague(currentConfig.leagueId)
        setSelectedManagerId(currentConfig.managerId)
      } else {
        setSelectedLeague(null)
        setSelectedManagerId(null)
      }
    }
  }, [isOpen, currentConfig?.leagueId, currentConfig?.managerId])

  const handleLeagueSelect = (leagueId) => {
    setSelectedLeague(leagueId)
    setStep(2)
  }

  const handleManagerSelect = (managerId) => {
    setSelectedManagerId(managerId)
  }

  const handleSave = () => {
    if (selectedLeague && selectedManagerId) {
      onSave({
        leagueId: selectedLeague,
        managerId: selectedManagerId
      })
      onClose()
    }
  }

  const handleBack = () => {
    setStep(1)
    setSelectedManagerId(null)
  }

  const handleBackFromStrength = () => setStep(2)

  const getEffectiveStrength = (teamId, apiStrength) => {
    const overrides = config?.teamStrengthOverrides
    if (!overrides) return apiStrength != null ? Math.min(5, Math.max(1, apiStrength)) : null
    const v = overrides[String(teamId)] ?? overrides[teamId]
    return v != null ? Math.min(5, Math.max(1, Number(v))) : (apiStrength != null ? Math.min(5, Math.max(1, apiStrength)) : null)
  }

  const handleStrengthChange = (teamId, newValue) => {
    const apiStrength = teams.find((t) => t.team_id === teamId)?.strength
    const num = Math.min(5, Math.max(1, Number(newValue)))
    const overrides = config?.teamStrengthOverrides || {}
    if (num === (apiStrength != null ? Math.min(5, Math.max(1, apiStrength)) : null)) {
      const next = { ...overrides }
      delete next[String(teamId)]
      delete next[teamId]
      saveTeamStrengthOverrides(Object.keys(next).length ? next : null)
    } else {
      saveTeamStrengthOverrides({ ...overrides, [teamId]: num })
    }
  }

  const handleResetStrength = () => {
    resetTeamStrengthOverrides()
  }

  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Configure Manager</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          {step === 1 && (
            <div className="modal-step">
              <h3>Step 1: Select League</h3>
              <p className="modal-step-description">Choose one of the available leagues</p>
              
              {leaguesLoading ? (
                <div className="modal-loading">Loading leagues...</div>
              ) : leagues.length === 0 ? (
                <div className="modal-empty">No leagues available</div>
              ) : (
                <div className="modal-options">
                  {leagues.map((league) => (
                    <button
                      key={league.league_id}
                      className="modal-option"
                      onClick={() => handleLeagueSelect(league.league_id)}
                    >
                      <div className="modal-option-content">
                        <span className="modal-option-name">{league.league_name || `League ${league.league_id}`}</span>
                        {league.league_name && league.league_name !== `League ${league.league_id}` && (
                          <span className="modal-option-id">ID: {league.league_id}</span>
                        )}
                      </div>
                      <span className="modal-option-arrow">→</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="modal-step">
              <h3>Step 2: Select Manager</h3>
              <p className="modal-step-description">Choose the manager to visualize on the home page</p>
              
              <button className="modal-back" onClick={handleBack}>
                ← Back to Leagues
              </button>

              {managersLoading ? (
                <div className="modal-loading">Loading managers...</div>
              ) : managers.length === 0 ? (
                <div className="modal-empty">No managers available in this league</div>
              ) : (
                <div className="modal-options">
                  {managers.map((manager) => (
                    <button
                      key={manager.manager_id}
                      className={`modal-option ${selectedManagerId === manager.manager_id ? 'selected' : ''}`}
                      onClick={() => handleManagerSelect(manager.manager_id)}
                    >
                      <div className="modal-option-content">
                        <span className="modal-option-name">
                          {manager.manager_team_name || manager.manager_name || `Manager ${manager.manager_id}`}
                        </span>
                        {manager.manager_team_name && manager.manager_name && (
                          <span className="modal-option-subtitle">{manager.manager_name}</span>
                        )}
                      </div>
                      {selectedManagerId === manager.manager_id && (
                        <span className="modal-option-check">✓</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="modal-step">
              <h3>Team strength (difficulty)</h3>
              <p className="modal-step-description">
                1 = easiest opponent, 5 = hardest. Used for schedule cell colors. Sign in to save.
              </p>
              <button className="modal-back" onClick={handleBackFromStrength}>
                ← Back to Manager
              </button>
              <button type="button" className="config-strength-reset" onClick={handleResetStrength}>
                Reset to FPL defaults
              </button>
              {teamsLoading ? (
                <div className="modal-loading">Loading teams...</div>
              ) : (
                <div className="config-strength-list">
                  {teams.map((team) => {
                    const effective = getEffectiveStrength(team.team_id, team.strength)
                    return (
                      <div key={team.team_id} className="config-strength-row">
                        <label className="config-strength-label">
                          <span className="config-strength-name">{team.short_name ?? team.team_name ?? team.team_id}</span>
                          <span className="config-strength-value">{effective ?? '–'}</span>
                        </label>
                        <input
                          type="range"
                          min={1}
                          max={5}
                          value={effective ?? 3}
                          onChange={(e) => handleStrengthChange(team.team_id, e.target.value)}
                          className="config-strength-slider"
                        />
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="modal-button modal-button-cancel" onClick={onClose}>
            Cancel
          </button>
          {step === 2 && selectedManagerId && (
            <>
              <button className="modal-button modal-button-secondary" onClick={() => setStep(3)}>
                Next: Team strength
              </button>
              <button className="modal-button modal-button-save" onClick={handleSave}>
                Save Configuration
              </button>
            </>
          )}
          {step === 3 && (
            <button className="modal-button modal-button-save" onClick={onClose}>
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
