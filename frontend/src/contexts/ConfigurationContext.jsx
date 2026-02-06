import { createContext, useContext, useState, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'
import ConfigurationModal from '../components/ConfigurationModal'

const ConfigurationContext = createContext()

export function ConfigurationProvider({ children }) {
  const queryClient = useQueryClient()
  const { user, loading: authLoading } = useAuth()
  const prevConfigRef = useRef(null)
  const configRef = useRef(config)
  const isInitialMount = useRef(true)
  const migrationAttemptedRef = useRef(false)
  const prevUserRef = useRef(user)
  configRef.current = config
  const [loading, setLoading] = useState(true)
  const [configModalOpen, setConfigModalOpen] = useState(false)

  const [config, setConfig] = useState(() => {
    // Load from localStorage on mount (fallback for non-authenticated users)
    const saved = localStorage.getItem('fpl_configuration')
    if (saved) {
      try {
        return JSON.parse(saved)
      } catch (e) {
        return null
      }
    }
    // Fallback to env variables if available
    const managerId = import.meta.env.VITE_MANAGER_ID
    const leagueId = import.meta.env.VITE_LEAGUE_ID
    if (managerId && leagueId) {
      return {
        managerId: parseInt(managerId),
        leagueId: parseInt(leagueId)
      }
    }
    return null
  })

  // Load configuration from Supabase for authenticated users
  useEffect(() => {
    const loadUserConfig = async () => {
      // Don't conclude "no config" until auth has resolved (avoids flash of login/welcome)
      if (authLoading) return
      if (!user) {
        setLoading(false)
        return
      }

      try {
        const { data, error } = await supabase
          .from('user_configurations')
          .select('manager_id, league_id, team_strength_overrides, team_attack_overrides, team_defence_overrides')
          .eq('user_id', user.id)
          .single()

        if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
          console.error('Error loading user configuration:', error)
          setLoading(false)
          return
        }

        if (data && data.manager_id && data.league_id) {
          // User has config in Supabase, use it
          setConfig({
            managerId: data.manager_id,
            leagueId: data.league_id,
            teamStrengthOverrides: data.team_strength_overrides ?? null,
            teamAttackOverrides: data.team_attack_overrides ?? null,
            teamDefenceOverrides: data.team_defence_overrides ?? null,
          })
        } else if (!migrationAttemptedRef.current) {
          // User just signed in: migrate current config (localStorage or initial) to Supabase (once)
          const toMigrate = configRef.current
          if (toMigrate?.managerId != null && toMigrate?.leagueId != null) {
            migrationAttemptedRef.current = true
            const { error: upsertError } = await supabase
              .from('user_configurations')
              .upsert({
                user_id: user.id,
                manager_id: toMigrate.managerId,
                league_id: toMigrate.leagueId,
                team_strength_overrides: toMigrate.teamStrengthOverrides ?? null,
                team_attack_overrides: toMigrate.teamAttackOverrides ?? null,
                team_defence_overrides: toMigrate.teamDefenceOverrides ?? null,
                updated_at: new Date().toISOString()
              }, {
                onConflict: 'user_id'
              })
            if (upsertError) {
              console.error('Error migrating config to Supabase:', upsertError)
              migrationAttemptedRef.current = false
            }
          }
        }
      } catch (error) {
        console.error('Error loading user configuration:', error)
      } finally {
        setLoading(false)
      }
    }

    loadUserConfig()
  }, [user, authLoading])

  // Reset migration flag when user changes
  useEffect(() => {
    migrationAttemptedRef.current = false
  }, [user?.id])

  // Clear config when user signs out so we don't show previous user's data
  useEffect(() => {
    if (prevUserRef.current && !user) {
      setConfig(null)
      localStorage.removeItem('fpl_configuration')
    }
    prevUserRef.current = user
  }, [user])

  // Save configuration to Supabase for authenticated users, localStorage for others
  useEffect(() => {
    if (loading) return

    const saveConfig = async () => {
      if (user && config) {
        // Save to Supabase for authenticated users
        try {
          const { error } = await supabase
            .from('user_configurations')
            .upsert({
              user_id: user.id,
              manager_id: config.managerId,
              league_id: config.leagueId,
              team_strength_overrides: config.teamStrengthOverrides ?? null,
              team_attack_overrides: config.teamAttackOverrides ?? null,
              team_defence_overrides: config.teamDefenceOverrides ?? null,
              updated_at: new Date().toISOString()
            }, {
              onConflict: 'user_id'
            })

          if (error) {
            console.error('Error saving user configuration:', error)
          }
        } catch (error) {
          console.error('Error saving user configuration:', error)
        }
      } else {
        // Save to localStorage for non-authenticated users
        if (config) {
          localStorage.setItem('fpl_configuration', JSON.stringify(config))
        } else {
          localStorage.removeItem('fpl_configuration')
        }
      }
    }

    saveConfig()
  }, [config, user, loading])

  // Invalidate queries when config changes (league or manager)
  useEffect(() => {
    // Skip on initial mount - we don't want to invalidate on first load
    if (isInitialMount.current) {
      isInitialMount.current = false
      prevConfigRef.current = config
      return
    }

    const prevConfig = prevConfigRef.current
    if (prevConfig && config) {
      const leagueChanged = prevConfig.leagueId !== config.leagueId
      const managerChanged = prevConfig.managerId !== config.managerId
      
      if (leagueChanged || managerChanged) {
        // Invalidate all queries that depend on league or manager configuration
        // This will trigger automatic refetch since query keys include league/manager IDs
        queryClient.invalidateQueries({ queryKey: ['standings'] })
        queryClient.invalidateQueries({ queryKey: ['manager'] })
        queryClient.invalidateQueries({ queryKey: ['transfers'] })
        queryClient.invalidateQueries({ queryKey: ['transfer-impacts'] })
        
        // Force immediate refetch for better UX
        queryClient.refetchQueries({ 
          queryKey: ['standings'],
          type: 'active' // Only refetch active queries
        })
        queryClient.refetchQueries({ 
          queryKey: ['manager'],
          type: 'active'
        })
        queryClient.refetchQueries({ 
          queryKey: ['transfers'],
          type: 'active'
        })
        queryClient.refetchQueries({ 
          queryKey: ['transfer-impacts'],
          type: 'active'
        })
      }
    }
    
    // Update ref for next comparison
    prevConfigRef.current = config
  }, [config, queryClient])

  const updateConfig = (newConfig) => {
    setConfig(newConfig)
  }

  const openConfigModal = () => setConfigModalOpen(true)
  const handleConfigSave = ({ leagueId, managerId }) => {
    updateConfig({
      ...config,
      leagueId: parseInt(leagueId),
      managerId: parseInt(managerId)
    })
    setConfigModalOpen(false)
  }

  const saveTeamStrengthOverrides = (overrides) => {
    setConfig((prev) => ({ ...prev, teamStrengthOverrides: overrides }))
  }
  const saveTeamAttackOverrides = (overrides) => {
    setConfig((prev) => ({ ...prev, teamAttackOverrides: overrides }))
  }
  const saveTeamDefenceOverrides = (overrides) => {
    setConfig((prev) => ({ ...prev, teamDefenceOverrides: overrides }))
  }
  const resetTeamStrengthOverrides = () => {
    setConfig((prev) => ({ ...prev, teamStrengthOverrides: null }))
  }
  const resetTeamAttackOverrides = () => {
    setConfig((prev) => ({ ...prev, teamAttackOverrides: null }))
  }
  const resetTeamDefenceOverrides = () => {
    setConfig((prev) => ({ ...prev, teamDefenceOverrides: null }))
  }
  const resetAllDifficultyOverrides = () => {
    setConfig((prev) => ({
      ...prev,
      teamStrengthOverrides: null,
      teamAttackOverrides: null,
      teamDefenceOverrides: null,
    }))
  }

  return (
    <ConfigurationContext.Provider value={{
      config,
      updateConfig,
      openConfigModal,
      loading,
      saveTeamStrengthOverrides,
      saveTeamAttackOverrides,
      saveTeamDefenceOverrides,
      resetTeamStrengthOverrides,
      resetTeamAttackOverrides,
      resetTeamDefenceOverrides,
      resetAllDifficultyOverrides,
    }}>
      {children}
      <ConfigurationModal
        isOpen={configModalOpen}
        onClose={() => setConfigModalOpen(false)}
        onSave={handleConfigSave}
        currentConfig={config}
      />
    </ConfigurationContext.Provider>
  )
}

const defaultConfigContext = {
  config: null,
  updateConfig: () => {},
  openConfigModal: () => {},
  loading: true,
  saveTeamStrengthOverrides: () => {},
  saveTeamAttackOverrides: () => {},
  saveTeamDefenceOverrides: () => {},
  resetTeamStrengthOverrides: () => {},
  resetTeamAttackOverrides: () => {},
  resetTeamDefenceOverrides: () => {},
  resetAllDifficultyOverrides: () => {},
}

export function useConfiguration() {
  const context = useContext(ConfigurationContext)
  if (!context) {
    if (import.meta.env.DEV) {
      console.warn('useConfiguration used outside ConfigurationProvider (e.g. during HMR). Using default.')
    }
    return defaultConfigContext
  }
  return context
}
