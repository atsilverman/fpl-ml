import { useSearchParams, useOutletContext } from 'react-router-dom'
import DefconSubpage from './DefconSubpage'
import FeedSubpage from './FeedSubpage'
import MatchesSubpage from './MatchesSubpage'
import './GameweekPage.css'

const GAMEWEEK_VIEW_ORDER = ['matches', 'bonus', 'defcon', 'feed']
const viewToIndex = (v) => {
  const i = GAMEWEEK_VIEW_ORDER.indexOf(v)
  return i >= 0 ? i : GAMEWEEK_VIEW_ORDER.indexOf('defcon')
}

export default function GameweekPage() {
  const [searchParams] = useSearchParams()
  const outletContext = useOutletContext() ?? {}
  const { toggleBonus = false, showH2H = false, setShowH2H, setGameweekView } = outletContext
  const view = searchParams.get('view') || 'defcon'
  const simulateStatuses = searchParams.get('simulate') === '1' || searchParams.get('simulate') === 'status'

  const pageIndex = viewToIndex(view)

  /* Track is 400% wide (4 panels); translateX % is relative to track, so one panel = 25% */
  const percentPerPanel = 100 / 4
  const translatePercent = -(pageIndex * percentPerPanel)

  return (
    <div className="gameweek-page">
      {simulateStatuses && (
        <div className="gameweek-simulate-banner" role="status">
          Simulating statuses: fixture 1 = Scheduled, 2 = Live, 3 = Finished (provisional), 4 = Final. Remove <code>?simulate=1</code> from URL to use real data.
        </div>
      )}
      <div className="gameweek-page-content gameweek-swipe-container" style={{ touchAction: 'pan-y' }}>
        <div
          className="gameweek-swipe-track"
          style={{ transform: `translateX(${translatePercent}%)` }}
        >
          <div className={`gameweek-subpage gameweek-subpage-matches`}>
            <MatchesSubpage simulateStatuses={simulateStatuses} toggleBonus={false} showH2H={showH2H} setShowH2H={setShowH2H} />
          </div>
          <div className={`gameweek-subpage gameweek-subpage-bonus`}>
            <MatchesSubpage simulateStatuses={simulateStatuses} toggleBonus={true} showH2H={showH2H} setShowH2H={setShowH2H} />
          </div>
          <div className="gameweek-subpage gameweek-subpage-defcon">
            <DefconSubpage isActive={view === 'defcon'} />
          </div>
          <div className="gameweek-subpage gameweek-subpage-feed">
            <FeedSubpage isActive={view === 'feed'} />
          </div>
        </div>
      </div>
    </div>
  )
}
