import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

/**
 * Fetches the fixture for a player's team in a given gameweek.
 * Used to show kickoff time (scheduled) or infer DNP when match finished and 0 points.
 * @param {number|null} teamId - Player's team_id (preferred)
 * @param {number|null} gameweek - Gameweek id
 * @param {number|null} playerId - When teamId is null, fetch team_id from players by player_id
 * @returns {{ fixture: { kickoff_time, started, finished, finished_provisional }|null, loading: boolean }}
 */
export function usePlayerFixtureForGameweek(teamId, gameweek, playerId = null) {
  const { data, isLoading } = useQuery({
    queryKey: ['player-fixture-for-gw', teamId ?? playerId, gameweek],
    queryFn: async () => {
      let resolvedTeamId = teamId
      if (resolvedTeamId == null && playerId != null && gameweek != null) {
        const { data: player, error: playerErr } = await supabase
          .from('players')
          .select('team_id')
          .eq('fpl_player_id', playerId)
          .single()
        if (playerErr || !player?.team_id) return null
        resolvedTeamId = player.team_id
      }
      if (resolvedTeamId == null || gameweek == null) return null
      const { data: rows, error } = await supabase
        .from('fixtures')
        .select('fpl_fixture_id, kickoff_time, started, finished, finished_provisional')
        .eq('gameweek', gameweek)
        .or(`home_team_id.eq.${resolvedTeamId},away_team_id.eq.${resolvedTeamId}`)
        .order('kickoff_time', { ascending: true })
        .limit(1)

      if (error) throw error
      return rows?.[0] ?? null
    },
    enabled: (teamId != null || playerId != null) && gameweek != null,
    staleTime: 60_000,
  })

  return { fixture: data ?? null, loading: isLoading }
}
