import { useQuery } from '@tanstack/react-query'
import { useGameweekData } from './useGameweekData'
import { useRefreshState } from './useRefreshState'
import { supabase } from '../lib/supabase'

/** DEFCON threshold by FPL position: 1=GK, 2=DEF, 3=MID, 4=FWD */
const DEFCON_THRESHOLD_BY_POSITION = {
  1: 999,  // GK: cannot earn
  2: 10,   // DEF
  3: 12,   // MID
  4: 12,   // FWD
}

/**
 * Fetches DEFCON data for the current gameweek: one record per player per fixture (per game).
 * DGW players appear as separate rows for each match.
 */
export function useDefconGameweekPlayers() {
  const { gameweek, dataChecked, loading: gwLoading } = useGameweekData()
  const { state: refreshState } = useRefreshState()
  const isLive = refreshState === 'live_matches' || refreshState === 'bonus_pending'

  const { data: rows = [], isLoading, error } = useQuery({
    queryKey: ['defcon-gameweek-players', gameweek, dataChecked],
    queryFn: async ({ queryKey }) => {
      const [, gw, gwDataChecked] = queryKey
      if (!gw) return []

      const { data: statsRows, error: statsError } = await supabase
        .from('player_gameweek_stats')
        .select('player_id, fixture_id, defensive_contribution, started, match_finished, match_finished_provisional, opponent_team_id')
        .eq('gameweek', gw)

      if (statsError) throw statsError
      if (!statsRows?.length) return []

      const playerIds = [...new Set(statsRows.map(r => r.player_id))]

      const [playerResult, fixturesResult] = await Promise.all([
        supabase
          .from('players')
          .select('fpl_player_id, web_name, position, team_id, teams!fk_players_team(short_name)')
          .in('fpl_player_id', playerIds),
        supabase
          .from('fixtures')
          .select('fpl_fixture_id, finished, finished_provisional')
          .eq('gameweek', gw),
      ])
      const { data: playerRows, error: playerError } = playerResult
      const { data: fixtureRows, error: fixtureError } = fixturesResult

      if (playerError) throw playerError
      if (fixtureError) throw fixtureError

      const fixturesById = Object.fromEntries(
        (fixtureRows || []).map((f) => [f.fpl_fixture_id, f])
      )
      const playersById = Object.fromEntries((playerRows || []).map((p) => [p.fpl_player_id, p]))

      // One row per (player, fixture) — separate DEFCON record per game
      const list = []
      for (const r of statsRows) {
        const p = playersById[r.player_id]
        if (!p || (p.position ?? 1) === 1) continue // hide GK
        const fixture = r.fixture_id != null ? fixturesById[r.fixture_id] : null
        const matchFinished = fixture != null ? Boolean(fixture.finished) : (r.match_finished === true)
        const matchFinishedProvisional = fixture != null ? Boolean(fixture.finished_provisional) : (r.match_finished_provisional === true)
        const defcon = r.defensive_contribution ?? 0
        const position = p.position ?? 1
        const threshold = DEFCON_THRESHOLD_BY_POSITION[position] ?? 999
        const matchComplete = matchFinished || matchFinishedProvisional
        const isLive = r.started === true && !matchComplete
        const matchProvisional = gwDataChecked ? false : (matchFinishedProvisional && !matchFinished)
        const matchConfirmed = matchFinished
        const percent = threshold >= 999 ? 0 : Math.min(100, Math.round((defcon / threshold) * 100))
        list.push({
          player_id: p.fpl_player_id,
          fixture_id: r.fixture_id ?? null,
          opponent_team_id: r.opponent_team_id ?? null,
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
        })
      }
      // Sort: by % desc, then name, then fixture_id so same player's games stay together
      list.sort((a, b) => {
        const aNoThreshold = a.threshold >= 999
        const bNoThreshold = b.threshold >= 999
        if (aNoThreshold !== bNoThreshold) return aNoThreshold ? 1 : -1
        return b.percent - a.percent || (a.web_name || '').localeCompare(b.web_name || '') || (a.fixture_id ?? 0) - (b.fixture_id ?? 0)
      })
      return list
    },
    enabled: !!gameweek && !gwLoading,
    staleTime: isLive ? 25 * 1000 : 30 * 1000,
    refetchInterval: isLive ? 25 * 1000 : 60 * 1000,
    refetchIntervalInBackground: isLive
  })

  return { players: rows, loading: isLoading, error }
}
