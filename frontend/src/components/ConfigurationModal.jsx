import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import './ConfigurationModal.css'

export default function ConfigurationModal({ isOpen, onClose, onSave }) {
  const { user, loading: authLoading, signInWithGoogle, signOut } = useAuth()
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
        .select('manager_id, manager_name')
        .in('manager_id', managerIds)
        .order('manager_id', { ascending: true })
      
      if (managerError) throw managerError
      
      return (managerDetails || []).map(manager => ({
        manager_id: manager.manager_id,
        manager_name: manager.manager_name || `Manager ${manager.manager_id}`
      }))
    },
    enabled: isOpen && step === 2 && !!selectedLeague,
    staleTime: 300000, // Cache for 5 minutes
  })

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setStep(1)
      setSelectedLeague(null)
      setSelectedManagerId(null)
    }
  }, [isOpen])

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

              <div className="modal-auth-section">
                {authLoading ? (
                  <div className="modal-auth-loading">Loading...</div>
                ) : user ? (
                  <div className="modal-auth-signed-in">
                    <img
                      src={user.user_metadata?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.user_metadata?.full_name || user.email)}&background=random`}
                      alt=""
                      className="modal-auth-avatar"
                    />
                    <span className="modal-auth-name">
                      {user.user_metadata?.full_name || user.email}
                    </span>
                    <button
                      type="button"
                      className="modal-auth-signout"
                      onClick={signOut}
                    >
                      Sign out
                    </button>
                  </div>
                ) : (
                  <div className="modal-auth-unsigned">
                    <p className="modal-auth-hint">Sign in to save your configuration across devices</p>
                    <button
                      type="button"
                      className="modal-auth-google"
                      onClick={signInWithGoogle}
                    >
                      <svg className="modal-auth-google-icon" viewBox="0 0 24 24" width="20" height="20">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                      </svg>
                      Sign in with Google
                    </button>
                  </div>
                )}
              </div>
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
                        <span className="modal-option-name">{manager.manager_name || `Manager ${manager.manager_id}`}</span>
                        {manager.manager_name && manager.manager_name !== `Manager ${manager.manager_id}` && (
                          <span className="modal-option-id">ID: {manager.manager_id}</span>
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
