import { useSearchParams, useOutletContext } from 'react-router-dom'
import { useState, useEffect, useRef } from 'react'
import { Swords, UserStar, ShieldCheck, Radio } from 'lucide-react'
import DefconSubpage from './DefconSubpage'
import FeedSubpage from './FeedSubpage'
import MatchesSubpage from './MatchesSubpage'
import './GameweekPage.css'

const GAMEWEEK_VIEW_ORDER = ['matches', 'bonus', 'defcon', 'feed']
const GAMEWEEK_VIEW_LABELS = { matches: 'Matches', bonus: 'Bonus', defcon: 'DEFCON', feed: 'Feed' }
const GAMEWEEK_VIEW_ICONS = { matches: Swords, bonus: UserStar, defcon: ShieldCheck, feed: Radio }
const viewToIndex = (v) => {
  const i = GAMEWEEK_VIEW_ORDER.indexOf(v)
  return i >= 0 ? i : 0
}

export default function GameweekPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const outletContext = useOutletContext() ?? {}
  const { toggleBonus = false, showH2H = false, setShowH2H } = outletContext
  const view = searchParams.get('view') || 'matches'
  const simulateStatuses = searchParams.get('simulate') === '1' || searchParams.get('simulate') === 'status'

  const prevViewRef = useRef(view)
  const [bonusAnimationKey, setBonusAnimationKey] = useState(0)
  useEffect(() => {
    if (view === 'bonus' && prevViewRef.current !== 'bonus') {
      setBonusAnimationKey((k) => k + 1)
    }
    prevViewRef.current = view
  }, [view])

  const pageIndex = viewToIndex(view)
  const setView = (v) => setSearchParams({ ...Object.fromEntries(searchParams.entries()), view: v }, { replace: true })

  /* Track is 400% wide (4 panels); translateX % is relative to track, so one panel = 25% */
  const percentPerPanel = 100 / 4
  const translatePercent = -(pageIndex * percentPerPanel)

  return (
    <div className="gameweek-page">
      <div className="subpage-toolbar-wrap">
        <nav
          className="subpage-view-toggle"
          role="tablist"
          aria-label="Gameweek view"
          data-options="4"
          style={{ '--slider-offset': pageIndex }}
        >
          <span className="subpage-view-toggle-slider" aria-hidden />
          {GAMEWEEK_VIEW_ORDER.map((viewId) => {
            const Icon = GAMEWEEK_VIEW_ICONS[viewId]
            return (
              <button
                key={viewId}
                type="button"
                role="tab"
                aria-selected={view === viewId}
                className={`subpage-view-toggle-button ${view === viewId ? 'active' : ''}`}
                onClick={() => setView(viewId)}
                aria-label={GAMEWEEK_VIEW_LABELS[viewId]}
                title={GAMEWEEK_VIEW_LABELS[viewId]}
              >
                {Icon && <Icon size={12} strokeWidth={2} className="subpage-view-toggle-icon" aria-hidden />}
                <span className="subpage-view-toggle-label">{GAMEWEEK_VIEW_LABELS[viewId]}</span>
              </button>
            )
          })}
        </nav>
      </div>
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
            <MatchesSubpage simulateStatuses={simulateStatuses} toggleBonus={true} showH2H={showH2H} setShowH2H={setShowH2H} bonusAnimationKey={view === 'bonus' ? bonusAnimationKey : 0} />
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
