import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useConfiguration } from '../contexts/ConfigurationContext'

export function useTransfers(gameweek = null) {
  const { config } = useConfiguration()
  const MANAGER_ID = config?.managerId || import.meta.env.VITE_MANAGER_ID || null

  const { data: transfers = [], isLoading, error } = useQuery({
    queryKey: ['transfers', MANAGER_ID, gameweek],
    queryFn: async () => {
      if (!MANAGER_ID) return []

      let query = supabase
        .from('manager_transfers')
        .select(`
          *,
          player_in:players!manager_transfers_player_in_id_fkey(fpl_player_id, web_name),
          player_out:players!manager_transfers_player_out_id_fkey(fpl_player_id, web_name)
        `)
        .eq('manager_id', MANAGER_ID)
        .order('transfer_time', { ascending: false })

      if (gameweek) {
        query = query.eq('gameweek', gameweek)
      }

      const { data, error } = await query

      if (error) throw error
      return data || []
    },
    enabled: !!MANAGER_ID, // Only run if we have a manager ID
    staleTime: 60000, // Transfers change less frequently - cache for 60 seconds
    refetchInterval: 60000, // Poll every 60 seconds (automatic background refetch)
  })

  return { transfers, loading: isLoading, error }
}
