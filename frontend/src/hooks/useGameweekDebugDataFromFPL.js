import { useQuery } from '@tanstack/react-query'

// Use relative URLs so Vite dev proxy (/api/fpl -> FPL) works; prod needs same-origin proxy or CORS
const FPL_BOOTSTRAP_URL = '/api/fpl/bootstrap-static/'
const FPL_FIXTURES_URL = '/api/fpl/fixtures/'

/**
 * Fetches current gameweek + fixtures directly from FPL API for the debug modal.
 * Zero DB lag: use for validating GW debug and fixture state (started / finished / finished_provisional).
 */
export function useGameweekDebugDataFromFPL(isModalOpen = false) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['gameweek-debug-fpl'],
    queryFn: async () => {
      const [bootstrapRes, fixturesRes] = await Promise.all([
        fetch(FPL_BOOTSTRAP_URL),
        fetch(FPL_FIXTURES_URL)
      ])
      if (!bootstrapRes.ok) throw new Error(`Bootstrap: ${bootstrapRes.status}`)
      if (!fixturesRes.ok) throw new Error(`Fixtures: ${fixturesRes.status}`)
      const bootstrap = await bootstrapRes.json()
      const allFixtures = await fixturesRes.json()

      const events = bootstrap.events || []
      const currentEvent = events.find((e) => e.is_current === true)
      const gameweekRow = currentEvent
        ? {
            id: currentEvent.id,
            name: currentEvent.name ?? null,
            deadline_time: currentEvent.deadline_time ?? null,
            is_current: currentEvent.is_current ?? false,
            is_previous: currentEvent.is_previous ?? false,
            is_next: currentEvent.is_next ?? false,
            finished: currentEvent.finished ?? false,
            data_checked: currentEvent.data_checked ?? false,
            highest_score: currentEvent.highest_score ?? null,
            average_entry_score: currentEvent.average_entry_score ?? null,
            fpl_ranks_updated: null // Not in FPL API; N/A when using API source
          }
        : null

      const teams = bootstrap.teams || []
      const teamById = Object.fromEntries(
        teams.map((t) => [t.id, { short_name: t.short_name ?? '?' }])
      )

      const gameweek = gameweekRow?.id ?? null
      const gwFixtures = Array.isArray(allFixtures)
        ? allFixtures.filter((f) => f.event === gameweek)
        : []
      const fixtures = gwFixtures
        .sort((a, b) => {
          const tA = a.kickoff_time ? new Date(a.kickoff_time).getTime() : 0
          const tB = b.kickoff_time ? new Date(b.kickoff_time).getTime() : 0
          return tA - tB
        })
        .map((f) => ({
          fpl_fixture_id: f.id,
          gameweek: f.event,
          home_team_id: f.team_h,
          away_team_id: f.team_a,
          home_score: f.team_h_score ?? null,
          away_score: f.team_a_score ?? null,
          started: f.started ?? false,
          finished: f.finished ?? false,
          finished_provisional: f.finished_provisional ?? false,
          minutes: f.minutes ?? null,
          kickoff_time: f.kickoff_time ?? null,
          home_short: teamById[f.team_h]?.short_name ?? '?',
          away_short: teamById[f.team_a]?.short_name ?? '?',
          clock_minutes: f.minutes ?? null
        }))

      return { gameweekRow, fixtures }
    },
    enabled: isModalOpen,
    staleTime: 5000,
    refetchInterval: 10000 // 10s when modal open so debug stays in sync with FPL
  })

  return {
    gameweekRow: data?.gameweekRow ?? null,
    fixtures: data?.fixtures ?? [],
    loading: isLoading,
    error: error?.message ?? null
  }
}
