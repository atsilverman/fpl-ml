import { useFixtures } from './useFixtures'

export function useLiveGameweekStatus(gameweek) {
  const { fixtures } = useFixtures(gameweek)
  
  // Check if any fixtures are currently live (started but not finished)
  const hasLiveGames = fixtures.some(
    fixture => fixture.started && !fixture.finished
  )
  
  return { hasLiveGames }
}
