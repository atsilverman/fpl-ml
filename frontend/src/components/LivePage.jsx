import { useGameweekData } from '../hooks/useGameweekData'
import { useFixtures } from '../hooks/useFixtures'
import './LivePage.css'

export default function LivePage() {
  const { gameweek } = useGameweekData()
  const { fixtures, loading } = useFixtures(gameweek)

  // Helper function to determine fixture status
  const getFixtureStatus = (fixture) => {
    const { started, finished, finished_provisional, minutes } = fixture

    // FINAL: started=true, finished=true, finished_provisional=true, minutes=90
    if (started && finished && finished_provisional && minutes === 90) {
      return 'FINAL'
    }

    // PROVISIONAL: started=true, finished=false, finished_provisional=true, minutes=90
    if (started && !finished && finished_provisional && minutes === 90) {
      return 'PROVISIONAL'
    }

    // LIVE: started=true, finished=false, finished_provisional=false
    if (started && !finished && !finished_provisional) {
      return 'LIVE'
    }

    // SCHEDULED: started=false, finished=false, finished_provisional=false, minutes=0
    if (!started && !finished && !finished_provisional && minutes === 0) {
      return 'SCHEDULED'
    }

    // Default fallback
    return 'UNKNOWN'
  }

  // Filter fixtures by status
  const finalFixtures = fixtures.filter(f => getFixtureStatus(f) === 'FINAL')
  const provisionalFixtures = fixtures.filter(f => getFixtureStatus(f) === 'PROVISIONAL')
  const liveFixtures = fixtures.filter(f => getFixtureStatus(f) === 'LIVE')
  const scheduledFixtures = fixtures.filter(f => getFixtureStatus(f) === 'SCHEDULED')

  return (
    <div className="live-page">
      <h2>Live Matches - Gameweek {gameweek}</h2>
      
      {loading ? (
        <div className="loading-state">Loading matches...</div>
      ) : (
        <>
          {liveFixtures.length > 0 && (
            <section className="live-section">
              <h3>Live Now</h3>
              <div className="fixtures-grid">
                {liveFixtures.map(fixture => (
                  <div key={fixture.fpl_fixture_id} className="fixture-card live">
                    <div className="fixture-score">
                      <span>{fixture.home_score || 0}</span>
                      <span className="vs">vs</span>
                      <span>{fixture.away_score || 0}</span>
                    </div>
                    <div className="fixture-minutes">{fixture.minutes}'</div>
                    <div className="fixture-status">LIVE</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {provisionalFixtures.length > 0 && (
            <section className="finished-section">
              <h3>Finished (Provisional)</h3>
              <div className="fixtures-grid">
                {provisionalFixtures.map(fixture => (
                  <div key={fixture.fpl_fixture_id} className="fixture-card finished">
                    <div className="fixture-score">
                      <span>{fixture.home_score || 0}</span>
                      <span className="vs">vs</span>
                      <span>{fixture.away_score || 0}</span>
                    </div>
                    <div className="fixture-status">PROVISIONAL</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {finalFixtures.length > 0 && (
            <section className="finished-section">
              <h3>Finished (Final)</h3>
              <div className="fixtures-grid">
                {finalFixtures.map(fixture => (
                  <div key={fixture.fpl_fixture_id} className="fixture-card finished">
                    <div className="fixture-score">
                      <span>{fixture.home_score || 0}</span>
                      <span className="vs">vs</span>
                      <span>{fixture.away_score || 0}</span>
                    </div>
                    <div className="fixture-status">FINAL</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {scheduledFixtures.length > 0 && (
            <section className="scheduled-section">
              <h3>Scheduled</h3>
              <div className="fixtures-grid">
                {scheduledFixtures.map(fixture => (
                  <div key={fixture.fpl_fixture_id} className="fixture-card scheduled">
                    <div className="fixture-score">
                      <span>—</span>
                      <span className="vs">vs</span>
                      <span>—</span>
                    </div>
                    <div className="fixture-status">SCHEDULED</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {liveFixtures.length === 0 && 
           provisionalFixtures.length === 0 && 
           finalFixtures.length === 0 && 
           scheduledFixtures.length === 0 && (
            <div className="empty-state">No matches available</div>
          )}
        </>
      )}
    </div>
  )
}
