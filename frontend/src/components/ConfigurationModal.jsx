import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import './ConfigurationModal.css'

export default function ConfigurationModal({ isOpen, onClose, onSave, currentConfig }) {
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

        </div>

        <div className="modal-footer">
          <button className="modal-button modal-button-cancel" onClick={onClose}>
            Cancel
          </button>
          {step === 2 && selectedManagerId && (
            <button className="modal-button modal-button-save" onClick={handleSave}>
              Save Configuration
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
