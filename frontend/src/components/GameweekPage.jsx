import { useSearchParams } from 'react-router-dom'
import DefconSubpage from './DefconSubpage'
import MatchesSubpage from './MatchesSubpage'
import BonusSubpage from './BonusSubpage'
import './GameweekPage.css'

export default function GameweekPage() {
  const [searchParams] = useSearchParams()
  const view = searchParams.get('view') || 'defcon'
  const simulateStatuses = searchParams.get('simulate') === '1' || searchParams.get('simulate') === 'status'

  return (
    <div className="gameweek-page">
      {simulateStatuses && (
        <div className="gameweek-simulate-banner" role="status">
          Simulating statuses: fixture 1 = Scheduled, 2 = Live, 3 = Finished (provisional), 4 = Final. Remove <code>?simulate=1</code> from URL to use real data.
        </div>
      )}
      <div className="gameweek-page-content">
        {view === 'matches' && (
          <div className="gameweek-subpage gameweek-subpage-matches">
            <MatchesSubpage simulateStatuses={simulateStatuses} />
          </div>
        )}
        {view === 'bonus' && (
          <div className="gameweek-subpage gameweek-subpage-bonus">
            <BonusSubpage simulateStatuses={simulateStatuses} />
          </div>
        )}
        {view === 'defcon' && (
          <div className="gameweek-subpage gameweek-subpage-defcon">
            <DefconSubpage />
          </div>
        )}
      </div>
    </div>
  )
}
