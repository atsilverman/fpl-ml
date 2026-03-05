import { useMemo } from 'react'
import { useFixtures } from './useFixtures'

export function useLiveGameweekStatus(gameweek) {
  const { fixtures } = useFixtures(gameweek)

  const { hasLiveGames, liveFixtureCount } = useMemo(() => {
    const live = fixtures.filter(
      (f) => f.started && !f.finished_provisional
    )
    return {
      hasLiveGames: live.length > 0,
      liveFixtureCount: live.length
    }
  }, [fixtures])

  return { hasLiveGames, liveFixtureCount }
}
