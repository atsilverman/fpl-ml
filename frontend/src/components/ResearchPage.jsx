import { useSearchParams } from 'react-router-dom'
import PriceChangesSubpage from './PriceChangesSubpage'
import ScheduleSubpage from './ScheduleSubpage'
import './HomePage.css'
import './ResearchPage.css'

const VALID_VIEWS = ['price-changes', 'schedule']

export default function ResearchPage() {
  const [searchParams] = useSearchParams()
  const rawView = searchParams.get('view') || 'price-changes'
  const view = VALID_VIEWS.includes(rawView) ? rawView : 'price-changes'

  return (
    <div className="research-page">
      {view === 'price-changes' && (
        <div className="research-card price-changes-card bento-card bento-card-animate bento-card-chart-2x4 bento-card-expanded">
          <header className="research-page-card-header">
            <span className="research-page-card-title">Price Changes</span>
            <a
              href="https://t.co/KBHo75dwC5"
              target="_blank"
              rel="noopener noreferrer"
              className="research-page-source"
              aria-label="Source: LiveFPL"
            >
              Source: <img src="/livefpl-logo.png" alt="LiveFPL" className="research-page-source-logo" />
            </a>
          </header>
          <PriceChangesSubpage showCard={false} />
        </div>
      )}

      {view === 'schedule' && (
        <div className="research-card research-schedule-card bento-card bento-card-animate bento-card-chart-2x4 bento-card-expanded">
          <ScheduleSubpage />
        </div>
      )}
    </div>
  )
}
