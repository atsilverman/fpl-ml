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
        .select('player_id, fixture_id, defensive_contribution, started, match_finished, match_finished_provisional')
        .eq('gameweek', gw)

      if (statsError) throw statsError
      if (!statsRows?.length) return []

      const playerIds = [...new Set(statsRows.map(r => r.player_id))]

      const [playerResult, fixturesResult] = await Promise.all([
        supabase
          .from('players')
          .select('fpl_player_id, web_name, position, team_id, teams(short_name)')
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

      // Aggregate per player (DGW = multiple rows per player): sum defcon, merge match status from any row
      const statsByPlayer = {}
      statsRows.forEach(r => {
        const pid = r.player_id
        const existing = statsByPlayer[pid]
        const defcon = r.defensive_contribution ?? 0
        const started = r.started ?? false
        const matchFinished = r.match_finished === true
        const matchProvisional = r.match_finished_provisional === true
        const rowIsLive = started && !matchFinished && !matchProvisional
        if (!existing) {
          statsByPlayer[pid] = {
            fixture_id: r.fixture_id ?? null,
            defcon,
            started,
            match_finished: matchFinished,
            match_finished_provisional: matchProvisional,
            is_live: rowIsLive,
          }
        } else {
          existing.defcon += defcon
          existing.started = existing.started || started
          existing.match_finished = existing.match_finished && matchFinished
          existing.match_finished_provisional = existing.match_finished_provisional || matchProvisional
          existing.is_live = existing.is_live || rowIsLive
        }
      })

      const list = (playerRows || [])
        .filter(p => (p.position ?? 1) !== 1) // hide GK from DEFCON page
        .map(p => {
        const stat = statsByPlayer[p.fpl_player_id] ?? {}
        const fixture = stat.fixture_id != null ? fixturesById[stat.fixture_id] : null
        // Use fixture table when available (same source as GameweekPointsView / debug panel) so status matches "game finished"
        const matchFinished = fixture != null ? Boolean(fixture.finished) : (stat.match_finished === true)
        const matchFinishedProvisional = fixture != null ? Boolean(fixture.finished_provisional) : (stat.match_finished_provisional === true)
        const defcon = stat.defcon ?? 0
        const position = p.position ?? 1
        const threshold = DEFCON_THRESHOLD_BY_POSITION[position] ?? 999
        const matchComplete = matchFinished || matchFinishedProvisional
        const isLive = stat.is_live === true || (stat.started === true && !matchComplete)
        // When gameweek is data_checked, treat all finished matches as final (green check, not grey)
        const matchProvisional = gwDataChecked ? false : (matchFinishedProvisional && !matchFinished)
        const matchConfirmed = matchFinished
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
