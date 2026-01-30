import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useConfiguration } from '../contexts/ConfigurationContext'

/**
 * Fetches transfer point impacts for the configured manager in a gameweek.
 * Uses mv_manager_transfer_impacts for player in/out names and point delta.
 */
export function useTransferImpacts(gameweek = null) {
  const { config } = useConfiguration()
  const MANAGER_ID = config?.managerId || import.meta.env.VITE_MANAGER_ID || null

  const { data: transfers = [], isLoading, error } = useQuery({
    queryKey: ['transfer-impacts', MANAGER_ID, gameweek],
    queryFn: async () => {
      if (!MANAGER_ID || !gameweek) return []

      const { data, error } = await supabase
        .from('mv_manager_transfer_impacts')
        .select('player_in_name, player_out_name, point_impact, transfer_time')
        .eq('manager_id', MANAGER_ID)
        .eq('gameweek', gameweek)
        .order('transfer_time', { ascending: true })

      if (error) throw error

      return (data || []).map((row) => ({
        playerInName: row.player_in_name ?? 'Unknown',
        playerOutName: row.player_out_name ?? 'Unknown',
        pointImpact: row.point_impact != null ? row.point_impact : null,
      }))
    },
    enabled: !!MANAGER_ID && !!gameweek,
    staleTime: 60000,
    refetchInterval: 60000,
  })

  return { transfers, loading: isLoading, error }
}
