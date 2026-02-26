import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export function normalizePlayerName(name) {
  return (name || '').trim().toLowerCase()
}

/**
 * Returns a lookup for player display name (normalized) -> team_short_name for badge resolution.
 * Used to resolve team badge when OCR doesn't provide team_short_name (e.g. Price Changes subpage).
 */
export function usePlayerTeamMap() {
  const { data: map = {}, isLoading, error } = useQuery({
    queryKey: ['player-team-map'],
    queryFn: async () => {
      const { data, error: err } = await supabase
        .from('players')
        .select('web_name, teams!fk_players_team(short_name)')

      if (err) throw err

      const out = {}
      for (const row of data || []) {
        const name = row.web_name?.trim()
        const shortName = row.teams?.short_name ?? null
        if (name) out[normalizePlayerName(name)] = shortName
      }
      return out
    },
    staleTime: 5 * 60 * 1000,
  })

  return {
    getTeamForPlayer: (playerName) => map[normalizePlayerName(playerName)] ?? null,
    loading: isLoading,
    error,
  }
}
