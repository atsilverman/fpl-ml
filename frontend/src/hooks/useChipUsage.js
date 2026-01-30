import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useConfiguration } from '../contexts/ConfigurationContext'

/**
 * Hook to fetch chip usage data for a manager
 * Returns a map of chip types to gameweek used
 */
export function useChipUsage() {
  const { config } = useConfiguration()
  const MANAGER_ID = config?.managerId || import.meta.env.VITE_MANAGER_ID || null

  const { data: chipUsage, isLoading, error } = useQuery({
    queryKey: ['chip-usage', MANAGER_ID],
    queryFn: async () => {
      if (!MANAGER_ID) return null

      const { data, error } = await supabase
        .from('manager_gameweek_history')
        .select('gameweek, active_chip')
        .eq('manager_id', MANAGER_ID)
        .not('active_chip', 'is', null)
        .order('gameweek', { ascending: true })

      if (error) {
        throw error
      }

      // Transform to map: chip type -> gameweek used
      // Track first half (GW 1-19) and second half (GW 20+) separately
      const usage = {
        wc1: null, // First half wildcard (GW 1-19)
        wc2: null, // Second half wildcard (GW 20+)
        fh: null,  // Free Hit (first half, GW 1-19)
        fh2: null, // Free Hit (second half, GW 20+)
        bb: null,  // Bench Boost (first half, GW 1-19)
        bb2: null, // Bench Boost (second half, GW 20+)
        tc: null,  // Triple Captain (first half, GW 1-19)
        tc2: null  // Triple Captain (second half, GW 20+)
      }

      ;(data || []).forEach(row => {
        const chip = row.active_chip
        const gameweek = row.gameweek
        const isSecondHalf = gameweek > 19

        if (chip === 'wildcard') {
          if (isSecondHalf) {
            usage.wc2 = gameweek
          } else {
            usage.wc1 = gameweek
          }
        } else if (chip === 'freehit') {
          if (isSecondHalf) {
            usage.fh2 = gameweek
          } else {
            usage.fh = gameweek
          }
        } else if (chip === 'bboost') {
          if (isSecondHalf) {
            usage.bb2 = gameweek
          } else {
            usage.bb = gameweek
          }
        } else if (chip === '3xc') {
          if (isSecondHalf) {
            usage.tc2 = gameweek
          } else {
            usage.tc = gameweek
          }
        }
      })

      return usage
    },
    enabled: !!MANAGER_ID,
    staleTime: 60000, // Cache for 1 minute
    refetchInterval: 60000, // Poll every minute
  })

  return { chipUsage, loading: isLoading, error }
}
