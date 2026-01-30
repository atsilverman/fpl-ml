import { createContext, useContext, useState, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'
import ConfigurationModal from '../components/ConfigurationModal'

const ConfigurationContext = createContext()

export function ConfigurationProvider({ children }) {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const prevConfigRef = useRef(null)
  const isInitialMount = useRef(true)
  const migrationAttemptedRef = useRef(false)
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
      if (!user) {
        setLoading(false)
        return
      }

      try {
        const { data, error } = await supabase
          .from('user_configurations')
          .select('manager_id, league_id')
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
            leagueId: data.league_id
          })
        } else if (config && !migrationAttemptedRef.current) {
          // User just signed in and has localStorage config, migrate it to Supabase (once)
          migrationAttemptedRef.current = true
          try {
            await supabase
              .from('user_configurations')
              .upsert({
                user_id: user.id,
                manager_id: config.managerId,
                league_id: config.leagueId,
                updated_at: new Date().toISOString()
              }, {
                onConflict: 'user_id'
              })
          } catch (migrateError) {
            console.error('Error migrating config to Supabase:', migrateError)
          }
        }
      } catch (error) {
        console.error('Error loading user configuration:', error)
      } finally {
        setLoading(false)
      }
    }

    loadUserConfig()
  }, [user])

  // Reset migration flag when user changes
  useEffect(() => {
    migrationAttemptedRef.current = false
  }, [user?.id])

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
      leagueId: parseInt(leagueId),
      managerId: parseInt(managerId)
    })
    setConfigModalOpen(false)
  }

  return (
    <ConfigurationContext.Provider value={{ config, updateConfig, openConfigModal }}>
      {children}
      <ConfigurationModal
        isOpen={configModalOpen}
        onClose={() => setConfigModalOpen(false)}
        onSave={handleConfigSave}
      />
    </ConfigurationContext.Provider>
  )
}

export function useConfiguration() {
  const context = useContext(ConfigurationContext)
  if (!context) {
    throw new Error('useConfiguration must be used within ConfigurationProvider')
  }
  return context
}
