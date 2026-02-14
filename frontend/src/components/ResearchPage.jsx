import { useSearchParams } from 'react-router-dom'
import { CirclePoundSterling, CalendarDays, Scale } from 'lucide-react'
import PriceChangesSubpage from './PriceChangesSubpage'
import ScheduleSubpage from './ScheduleSubpage'
import CompareSubpage from './CompareSubpage'
import './HomePage.css'
import './ResearchPage.css'

const RESEARCH_VIEW_ORDER = ['price-changes', 'schedule', 'compare']
const RESEARCH_VIEW_LABELS = { 'price-changes': 'Changes', schedule: 'Schedule', compare: 'Compare' }
const RESEARCH_VIEW_ICONS = { 'price-changes': CirclePoundSterling, schedule: CalendarDays, compare: Scale }
const VALID_VIEWS = ['price-changes', 'schedule', 'compare']

export default function ResearchPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const rawView = searchParams.get('view') || 'price-changes'
  const view = VALID_VIEWS.includes(rawView) ? rawView : 'price-changes'
  const viewIndex = RESEARCH_VIEW_ORDER.indexOf(view) >= 0 ? RESEARCH_VIEW_ORDER.indexOf(view) : 0
  const setView = (v) => setSearchParams({ view: v }, { replace: true })

  return (
    <div className="research-page">
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
      {view === 'price-changes' && (
        <div className="research-card research-price-changes-card bento-card bento-card-animate bento-card-expanded">
          <header className="research-page-card-header research-price-changes-header">
            <span className="research-page-card-title">Price Changes</span>
          </header>
          <div className="research-price-changes-content">
            <PriceChangesSubpage showCard={false} />
          </div>
        </div>
      )}

      {view === 'schedule' && (
        <div className="research-card research-schedule-card bento-card bento-card-animate bento-card-chart-2x4 bento-card-expanded">
          <ScheduleSubpage />
        </div>
      )}

      {view === 'compare' && (
        <div className="research-card research-compare-card bento-card bento-card-animate bento-card-expanded">
          <header className="research-page-card-header research-compare-header">
            <span className="research-page-card-title">Compare</span>
          </header>
          <div className="research-compare-content">
            <CompareSubpage />
          </div>
        </div>
      )}
    </div>
  )
}
