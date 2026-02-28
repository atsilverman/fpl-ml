import { useSearchParams } from 'react-router-dom'
import { useRef } from 'react'
import { CirclePoundSterling, CalendarDays, ListOrdered } from 'lucide-react'
import PriceChangesSubpage from './PriceChangesSubpage'
import ScheduleSubpage from './ScheduleSubpage'
import StatsSubpage from './StatsSubpage'
import { useSubpageSwipe } from '../hooks/useSubpageSwipe'
import { useIsMobile } from '../hooks/useIsMobile'
import './HomePage.css'
import './ResearchPage.css'

const RESEARCH_VIEW_ORDER = ['stats', 'schedule', 'price-changes']
const RESEARCH_VIEW_LABELS = { 'price-changes': 'Price Changes', schedule: 'Fixtures', stats: 'Statistics' }
const RESEARCH_VIEW_ICONS = { 'price-changes': CirclePoundSterling, schedule: CalendarDays, stats: ListOrdered }
const VALID_VIEWS = ['stats', 'schedule', 'price-changes']

export default function ResearchPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const rawView = searchParams.get('view') || 'stats'
  const view = VALID_VIEWS.includes(rawView) ? rawView : 'stats'
  const viewIndex = RESEARCH_VIEW_ORDER.indexOf(view) >= 0 ? RESEARCH_VIEW_ORDER.indexOf(view) : 0
  const setView = (v) => setSearchParams({ view: v }, { replace: true })

  const subpageSwipeRef = useRef(null)
  const isMobile = useIsMobile()
  useSubpageSwipe(subpageSwipeRef, {
    currentIndex: viewIndex,
    totalPages: RESEARCH_VIEW_ORDER.length,
    onSwipeToIndex: (i) => setView(RESEARCH_VIEW_ORDER[i]),
    enabled: isMobile
  })

  return (
    <div className={`research-page ${view === 'schedule' ? 'research-page--schedule-view' : ''}`}>
      <div className="subpage-toolbar-wrap">
        <nav
          className="subpage-view-toggle"
          role="tablist"
          aria-label="Research view"
          data-options="3"
          style={{ '--slider-offset': viewIndex }}
        >
          <span className="subpage-view-toggle-slider" aria-hidden />
          {RESEARCH_VIEW_ORDER.map((viewId) => {
            const Icon = RESEARCH_VIEW_ICONS[viewId]
            return (
              <button
                key={viewId}
                type="button"
                role="tab"
                aria-selected={view === viewId}
                className={`subpage-view-toggle-button ${view === viewId ? 'active' : ''}`}
                onClick={() => setView(viewId)}
                aria-label={RESEARCH_VIEW_LABELS[viewId]}
                title={RESEARCH_VIEW_LABELS[viewId]}
              >
                {Icon && <Icon size={12} strokeWidth={2} className="subpage-view-toggle-icon" aria-hidden />}
                <span className="subpage-view-toggle-label">{RESEARCH_VIEW_LABELS[viewId]}</span>
              </button>
            )
          })}
        </nav>
      </div>
      <div ref={subpageSwipeRef} className="research-page-content">
        {view === 'price-changes' && <PriceChangesSubpage />}
        {view === 'schedule' && <ScheduleSubpage />}
        {view === 'stats' && <StatsSubpage />}
      </div>
    </div>
  )
}
