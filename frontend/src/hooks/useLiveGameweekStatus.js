import { useFixtures } from './useFixtures'

export function useLiveGameweekStatus(gameweek) {
  const { fixtures } = useFixtures(gameweek)
  
  // Live = started && !finished_provisional (matches backend LIVE_MATCHES; not just !finished)
  const hasLiveGames = fixtures.some(
    fixture => fixture.started && !fixture.finished_provisional
  )
  
  return { hasLiveGames }
}
