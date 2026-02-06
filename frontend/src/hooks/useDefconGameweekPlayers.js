import { useQuery } from '@tanstack/react-query'
import { useGameweekData } from './useGameweekData'
import { supabase } from '../lib/supabase'

/** DEFCON threshold by FPL position: 1=GK, 2=DEF, 3=MID, 4=FWD */
const DEFCON_THRESHOLD_BY_POSITION = {
  1: 999,  // GK: cannot earn
  2: 10,   // DEF
  3: 12,   // MID
  4: 12,   // FWD
}

/**
 * Fetches all players with gameweek stats for the current gameweek for the DEFCON page.
 * Returns player badge, name, defensive_contribution (numerator), threshold (denominator).
 */
export function useDefconGameweekPlayers() {
  const { gameweek, dataChecked, loading: gwLoading } = useGameweekData()

  const { data: rows = [], isLoading, error } = useQuery({
    queryKey: ['defcon-gameweek-players', gameweek, dataChecked],
    queryFn: async ({ queryKey }) => {
      const [, gw, gwDataChecked] = queryKey
      if (!gw) return []

      const { data: statsRows, error: statsError } = await supabase
        .from('player_gameweek_stats')
        .select('player_id, defensive_contribution, started, match_finished, match_finished_provisional')
        .eq('gameweek', gw)

      if (statsError) throw statsError
      if (!statsRows?.length) return []

      const playerIds = [...new Set(statsRows.map(r => r.player_id))]

      const { data: playerRows, error: playerError } = await supabase
        .from('players')
        .select('fpl_player_id, web_name, position, team_id, teams(short_name)')
        .in('fpl_player_id', playerIds)

      if (playerError) throw playerError

      const statsByPlayer = {}
      statsRows.forEach(r => {
        statsByPlayer[r.player_id] = {
          defcon: r.defensive_contribution ?? 0,
          started: r.started ?? false,
          match_finished: r.match_finished ?? false,
          match_finished_provisional: r.match_finished_provisional ?? false,
        }
      })

      const list = (playerRows || [])
        .filter(p => (p.position ?? 1) !== 1) // hide GK from DEFCON page
        .map(p => {
        const stat = statsByPlayer[p.fpl_player_id] ?? {}
        const defcon = stat.defcon ?? 0
        const position = p.position ?? 1
        const threshold = DEFCON_THRESHOLD_BY_POSITION[position] ?? 999
        const matchComplete = stat.match_finished === true || stat.match_finished_provisional === true
        const isLive = stat.started === true && !matchComplete
        // When gameweek is data_checked, treat all finished matches as final (green check, not grey)
        const matchProvisional = gwDataChecked ? false : (stat.match_finished_provisional === true)
        const matchConfirmed = stat.match_finished === true
        const percent = threshold >= 999 ? 0 : Math.min(100, Math.round((defcon / threshold) * 100))
        return {
          player_id: p.fpl_player_id,
          web_name: p.web_name ?? '',
          position,
          team_id: p.team_id ?? null,
          team_short_name: p.teams?.short_name ?? null,
          defcon,
          threshold,
          match_complete: matchComplete,
          match_provisional: matchProvisional,
          match_confirmed: matchConfirmed,
          is_live: isLive,
          percent,
        }
      })
      // Sort: outfield by % desc (closest to DEFCON first); then 0%
      list.sort((a, b) => {
        const aNoThreshold = a.threshold >= 999
        const bNoThreshold = b.threshold >= 999
        if (aNoThreshold !== bNoThreshold) return aNoThreshold ? 1 : -1
        return b.percent - a.percent || (a.web_name || '').localeCompare(b.web_name || '')
      })
      return list
    },
    enabled: !!gameweek && !gwLoading,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  })

  return { players: rows, loading: isLoading, error }
}
