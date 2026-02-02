import PriceChangesSubpage from './PriceChangesSubpage'
import './ResearchPage.css'

export default function ResearchPage() {
  return (
    <div className="research-page">
      <div className="price-changes-card">
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
    </div>
  )
}
