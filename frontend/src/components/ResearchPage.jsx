import { useSearchParams } from 'react-router-dom'
import { CirclePoundSterling, CalendarDays, Scale, ListOrdered } from 'lucide-react'
import PriceChangesSubpage from './PriceChangesSubpage'
import ScheduleSubpage from './ScheduleSubpage'
import CompareSubpage from './CompareSubpage'
import StatsSubpage from './StatsSubpage'
import './HomePage.css'
import './ResearchPage.css'

const RESEARCH_VIEW_ORDER = ['stats', 'schedule', 'compare', 'price-changes']
const RESEARCH_VIEW_LABELS = { 'price-changes': 'Changes', schedule: 'Schedule', compare: 'Compare', stats: 'Stats' }
const RESEARCH_VIEW_ICONS = { 'price-changes': CirclePoundSterling, schedule: CalendarDays, compare: Scale, stats: ListOrdered }
const VALID_VIEWS = ['stats', 'schedule', 'compare', 'price-changes']

export default function ResearchPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const rawView = searchParams.get('view') || 'stats'
  const view = VALID_VIEWS.includes(rawView) ? rawView : 'stats'
  const viewIndex = RESEARCH_VIEW_ORDER.indexOf(view) >= 0 ? RESEARCH_VIEW_ORDER.indexOf(view) : 0
  const setView = (v) => setSearchParams({ view: v }, { replace: true })

  return (
    <div className="research-page">
      <div className="subpage-toolbar-wrap">
        <nav
          className="subpage-view-toggle"
          role="tablist"
          aria-label="Research view"
          data-options="4"
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
      {view === 'price-changes' && <PriceChangesSubpage />}
      {view === 'schedule' && <ScheduleSubpage />}
      {view === 'compare' && <CompareSubpage />}

      {view === 'stats' && <StatsSubpage />}
    </div>
  )
}
