import { useSearchParams, useOutletContext } from 'react-router-dom'
import DefconSubpage from './DefconSubpage'
import MatchesSubpage from './MatchesSubpage'
import './GameweekPage.css'

export default function GameweekPage() {
  const [searchParams] = useSearchParams()
  const outletContext = useOutletContext() ?? {}
  const { toggleBonus = false, showH2H = false, setShowH2H } = outletContext
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
        {(view === 'matches' || view === 'bonus') && (
          <div className={`gameweek-subpage ${view === 'bonus' ? 'gameweek-subpage-bonus' : 'gameweek-subpage-matches'}`}>
            <MatchesSubpage simulateStatuses={simulateStatuses} toggleBonus={view === 'bonus'} showH2H={showH2H} setShowH2H={setShowH2H} />
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
