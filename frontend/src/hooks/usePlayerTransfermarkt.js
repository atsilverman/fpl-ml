import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { supabase } from '../lib/supabase'

const TM_BASE = 'https://www.transfermarkt.com'
const TM_SEARCH = `${TM_BASE}/schnellsuche/ergebnis/schnellsuche`;

/**
 * Fetches Transfermarkt mapping for a player so we can show a "View on Transfermarkt" link.
 * Returns profileUrl (direct profile when we have slug+id, else search URL) and raw id/slug.
 */
export function usePlayerTransfermarkt(playerId, webName) {
  const { data: row, isLoading } = useQuery({
    queryKey: ['player-transfermarkt', playerId],
    queryFn: async () => {
      if (playerId == null) return null
      const { data, error } = await supabase
        .from('player_transfermarkt')
        .select('transfermarkt_player_id, transfermarkt_slug')
        .eq('fpl_player_id', playerId)
        .maybeSingle()
      if (error) {
        if (error.code === 'PGRST204' || error.message?.includes('does not exist')) return null
        throw error
      }
      return data
    },
    enabled: playerId != null,
    staleTime: 10 * 60 * 1000,
  })

  const profileUrl = useMemo(() => {
    if (!row?.transfermarkt_player_id || !row?.transfermarkt_slug) {
      const name = (webName || '').trim() || 'player'
      return `${TM_SEARCH}?query=${encodeURIComponent(name)}`
    }
    return `${TM_BASE}/${row.transfermarkt_slug}/profil/spieler/${row.transfermarkt_player_id}`
  }, [row, webName])

  return {
    profileUrl,
    transfermarktPlayerId: row?.transfermarkt_player_id ?? null,
    transfermarktSlug: row?.transfermarkt_slug ?? null,
    loading: isLoading,
  }
}
