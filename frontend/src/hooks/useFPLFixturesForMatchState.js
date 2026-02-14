import { useQuery } from '@tanstack/react-query'

const FPL_FIXTURES_URL = '/api/fpl/fixtures/'

/**
 * Fetches current-gameweek fixtures from FPL API for match state (live vs provisional).
 * Use when GW points card is expanded so player-level dots match FPL reality.
 * Requires dev proxy (Vite) or prod serverless proxy at /api/fpl.
 */
export function useFPLFixturesForMatchState(gameweek, enabled) {
  const { data: fixtures = [], isLoading, error } = useQuery({
    queryKey: ['fpl-fixtures-match-state', gameweek],
    queryFn: async () => {
      const res = await fetch(FPL_FIXTURES_URL)
      if (!res.ok) throw new Error(`Fixtures: ${res.status}`)
      const all = await res.json()
      if (!Array.isArray(all)) return []
      const gw = all.filter((f) => f.event === gameweek)
      gw.sort((a, b) => {
        const tA = a.kickoff_time ? new Date(a.kickoff_time).getTime() : 0
        const tB = b.kickoff_time ? new Date(b.kickoff_time).getTime() : 0
        return tA - tB
      })
      return gw.map((f) => ({
        fpl_fixture_id: f.id,
        gameweek: f.event,
        home_team_id: f.team_h,
        away_team_id: f.team_a,
        started: f.started ?? false,
        finished: f.finished ?? false,
        finished_provisional: f.finished_provisional ?? false,
        minutes: f.minutes ?? null,
        kickoff_time: f.kickoff_time ?? null
      }))
    },
    enabled: Boolean(enabled && gameweek),
    staleTime: 5000,
    refetchInterval: 10000
  })

  return { fixtures, loading: isLoading, error: error?.message ?? null }
}
