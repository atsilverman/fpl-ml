import { useSearchParams } from 'react-router-dom'
import PriceChangesSubpage from './PriceChangesSubpage'
import ScheduleSubpage from './ScheduleSubpage'
import CompareSubpage from './CompareSubpage'
import './HomePage.css'
import './ResearchPage.css'

const VALID_VIEWS = ['price-changes', 'schedule', 'compare']

export default function ResearchPage() {
  const [searchParams] = useSearchParams()
  const rawView = searchParams.get('view') || 'price-changes'
  const view = VALID_VIEWS.includes(rawView) ? rawView : 'price-changes'

  return (
    <div className="research-page">
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
