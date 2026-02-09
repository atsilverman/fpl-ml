import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useConfiguration } from '../contexts/ConfigurationContext'
import UserAvatar from './UserAvatar'
import './OnboardingPage.css'

export default function OnboardingPage() {
  const navigate = useNavigate()
  const { user, loading: authLoading, signInWithGoogle, signOut } = useAuth()
  const { config, updateConfig } = useConfiguration()
  const [step, setStep] = useState(1)

  useEffect(() => {
    if (config?.leagueId != null && config?.managerId != null) {
      navigate('/', { replace: true })
    }
  }, [config?.leagueId, config?.managerId, navigate])
  const [selectedLeague, setSelectedLeague] = useState(null)
  const [selectedManagerId, setSelectedManagerId] = useState(null)

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
    staleTime: 300000,
  })

  const { data: managers = [], isLoading: managersLoading } = useQuery({
    queryKey: ['managers', selectedLeague],
    queryFn: async () => {
      if (!selectedLeague) return []
      const { data: leagueManagers, error: leagueError } = await supabase
        .from('mini_league_managers')
        .select('manager_id')
        .eq('league_id', selectedLeague)
      if (leagueError) throw leagueError
      if (!leagueManagers?.length) return []
      const managerIds = leagueManagers.map((m) => m.manager_id)
      const { data: managerDetails, error: managerError } = await supabase
        .from('managers')
        .select('manager_id, manager_name, manager_team_name')
        .in('manager_id', managerIds)
        .order('manager_id', { ascending: true })
      if (managerError) throw managerError
      return (managerDetails || []).map((m) => ({
        manager_id: m.manager_id,
        manager_name: m.manager_name || null,
        manager_team_name: m.manager_team_name || null,
      }))
    },
    enabled: !!selectedLeague,
    staleTime: 300000,
  })

  const handleLeagueSelect = (leagueId) => {
    setSelectedLeague(leagueId)
    setSelectedManagerId(null)
    setStep(2)
  }

  const handleManagerSelect = (managerId) => {
    setSelectedManagerId(managerId)
  }

  const handleBack = () => {
    setStep(1)
    setSelectedLeague(null)
    setSelectedManagerId(null)
  }

  const handleGetStarted = () => {
    if (!selectedLeague || !selectedManagerId) return
    updateConfig({
      leagueId: parseInt(selectedLeague),
      managerId: parseInt(selectedManagerId),
    })
    navigate('/', { replace: true })
  }

  const canFinish = selectedLeague && selectedManagerId

  return (
    <div className="onboarding">
      <div className="onboarding-card">
        <header className="onboarding-header">
          <h1 className="onboarding-title">Welcome to FPL Mini League</h1>
          <p className="onboarding-description">
            Track your Fantasy Premier League mini league and your team in one place. Choose your league and manager to get started.
          </p>
        </header>

        <div className="onboarding-auth">
          {authLoading ? (
            <div className="onboarding-auth-loading">Loading…</div>
          ) : user ? (
            <div className="onboarding-auth-signed-in">
              <UserAvatar user={user} className="onboarding-auth-avatar" />
              <span className="onboarding-auth-name">
                {user.user_metadata?.full_name || user.email}
              </span>
              <button type="button" className="onboarding-auth-signout" onClick={signOut}>
                Sign out
              </button>
            </div>
          ) : (
            <div className="onboarding-auth-unsigned">
              <p className="onboarding-auth-hint">
                Sign in with Google to save your league and manager across devices
              </p>
              <button
                type="button"
                className="onboarding-auth-google"
                onClick={signInWithGoogle}
              >
                <svg className="onboarding-auth-google-icon" viewBox="0 0 24 24" width="20" height="20">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                Sign in with Google
              </button>
            </div>
          )}
        </div>

        <div className="onboarding-steps">
          {step === 1 && (
            <div className="onboarding-step">
              <h2 className="onboarding-step-title">Choose your league</h2>
              <p className="onboarding-step-description">Select the mini league you want to track</p>
              {leaguesLoading ? (
                <div className="onboarding-loading">Loading leagues…</div>
              ) : leagues.length === 0 ? (
                <div className="onboarding-empty">No leagues available</div>
              ) : (
                <div className="onboarding-options">
                  {leagues.map((league) => (
                    <button
                      key={league.league_id}
                      type="button"
                      className="onboarding-option"
                      onClick={() => handleLeagueSelect(league.league_id)}
                    >
                      <span className="onboarding-option-name">
                        {league.league_name || `League ${league.league_id}`}
                      </span>
                      <span className="onboarding-option-arrow">→</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="onboarding-step">
              <button type="button" className="onboarding-back" onClick={handleBack}>
                ← Back to leagues
              </button>
              <h2 className="onboarding-step-title">Choose your manager</h2>
              <p className="onboarding-step-description">Select the manager (team) to view on your dashboard</p>
              {managersLoading ? (
                <div className="onboarding-loading">Loading managers…</div>
              ) : managers.length === 0 ? (
                <div className="onboarding-empty">No managers in this league</div>
              ) : (
                <div className="onboarding-options">
                  {managers.map((manager) => (
                    <button
                      key={manager.manager_id}
                      type="button"
                      className={`onboarding-option ${selectedManagerId === manager.manager_id ? 'selected' : ''}`}
                      onClick={() => handleManagerSelect(manager.manager_id)}
                    >
                      <div className="onboarding-option-content">
                        <span className="onboarding-option-name">
                          {manager.manager_team_name || manager.manager_name || `Manager ${manager.manager_id}`}
                        </span>
                        {manager.manager_team_name && manager.manager_name && manager.manager_name !== manager.manager_team_name && (
                          <span className="onboarding-option-subtitle">{manager.manager_name}</span>
                        )}
                      </div>
                      {selectedManagerId === manager.manager_id && (
                        <span className="onboarding-option-check">✓</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              {canFinish && (
                <button
                  type="button"
                  className="onboarding-cta"
                  onClick={handleGetStarted}
                >
                  Get started
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
