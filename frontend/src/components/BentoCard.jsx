import './BentoCard.css'
import { useState, useRef, useEffect } from 'react'
import { formatNumber } from '../utils/formatNumbers'
import PerformanceChart from './PerformanceChart'
import TeamValueChart from './TeamValueChart'
import PlayerPerformanceChart from './PlayerPerformanceChart'
import GameweekPointsView from './GameweekPointsView'
import { useTheme } from '../contexts/ThemeContext'
import { Sun, Moon, Laptop, Settings, MoveDiagonal, X, Info, CircleArrowUp, CircleArrowDown, ChevronUp, ChevronDown, ChevronsUp, ChevronsDown } from 'lucide-react'

const FIRST_HALF_CHIP_COLUMNS = [
  { key: 'wc1', label: 'WC', color: '#8b5cf6' },
  { key: 'fh', label: 'FH', color: '#3b82f6' },
  { key: 'bb', label: 'BB', color: '#06b6d4' },
  { key: 'tc', label: 'TC', color: '#f97316' }
]
const SECOND_HALF_CHIP_COLUMNS = [
  { key: 'wc2', label: 'WC2', color: '#8b5cf6' },
  { key: 'fh2', label: 'FH2', color: '#3b82f6' },
  { key: 'bb2', label: 'BB2', color: '#06b6d4' },
  { key: 'tc2', label: 'TC2', color: '#f97316' }
]

export default function BentoCard({
  id,
  label,
  value,
  subtext,
  change,
  loading = false,
  className = '',
  isChart = false,
  isChips = false,
  isSettings = false,
  isStale = false,
  style = {},
  onConfigureClick,
  chartData = null,
  chartComparisonData = null,
  chartFilter = 'all',
  showChartComparison = false,
  onChartFilterChange = null,
  chipUsage = null,
  isTransfers = false,
  transfersSummary = null,
  leagueTopTransfersOut = null,
  leagueTopTransfersIn = null,
  leagueTopTransfersLoading = false,
  transfersGameweek = null,
  isExpanded = false,
  onExpandClick = null,
  onCollapseClick = null,
  playerChartData = null,
  playerChartFilter = 'all',
  onPlayerChartFilterChange = null,
  currentGameweekPlayersData = null,
  top10ByStat = null,
  gameweek = null,
  leagueChipData = null,
  leagueChipsLoading = false,
  leagueStandings = null,
  leagueStandingsLoading = false,
  currentManagerId = null,
  captainName = null,
  viceCaptainName = null,
  leagueCaptainData = null,
  leagueCaptainLoading = false
}) {
  const isSecondHalf = gameweek != null && gameweek > 19
  // Page 0 = first half chips, page 1 = second half; default to "other" half of season
  const [chipsPage, setChipsPage] = useState(() => (isSecondHalf ? 0 : 1))
  const chipColumns = chipsPage === 0 ? FIRST_HALF_CHIP_COLUMNS : SECOND_HALF_CHIP_COLUMNS
  const collapsedChipItemsFirst = FIRST_HALF_CHIP_COLUMNS.map(({ key, label, color }) => ({
    key,
    label,
    color,
    gameweek: chipUsage?.[key] ?? null
  }))
  const collapsedChipItemsSecond = SECOND_HALF_CHIP_COLUMNS.map(({ key, label, color }) => ({
    key,
    label,
    color,
    gameweek: chipUsage?.[key] ?? null
  }))

  const swipeStartRef = useRef(null)
  const gwExpandIconsRef = useRef(null)
  const [showGwLegendPopup, setShowGwLegendPopup] = useState(false)
  const SWIPE_THRESHOLD = 40

  useEffect(() => {
    if (id === 'gw-points' && !isExpanded) {
      setShowGwLegendPopup(false)
    }
  }, [id, isExpanded])

  useEffect(() => {
    if (!showGwLegendPopup || id !== 'gw-points' || !isExpanded) return
    const handleClickOutside = (e) => {
      if (gwExpandIconsRef.current && !gwExpandIconsRef.current.contains(e.target)) {
        setShowGwLegendPopup(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showGwLegendPopup, id, isExpanded])

  const handleChipsSwipeStart = (clientX) => {
    swipeStartRef.current = clientX
  }
  const handleChipsSwipeEnd = (clientX) => {
    const start = swipeStartRef.current
    if (start == null) return
    swipeStartRef.current = null
    const delta = clientX - start
    if (delta < -SWIPE_THRESHOLD) setChipsPage((p) => Math.min(1, p + 1))
    else if (delta > SWIPE_THRESHOLD) setChipsPage((p) => Math.max(0, p - 1))
  }

  const { themeMode, cycleTheme } = useTheme()
  const cardClasses = `bento-card bento-card-animate ${className}${isExpanded ? ' bento-card-expanded' : ''}`.trim()

  const getThemeLabel = () => {
    if (themeMode === 'light') return 'Light'
    if (themeMode === 'dark') return 'Dark'
    return 'System'
  }

  const getThemeIcon = () => {
    if (themeMode === 'light') {
      return <Sun className="settings-icon" size={11} strokeWidth={1.5} />
    }
    if (themeMode === 'dark') {
      return <Moon className="settings-icon" size={11} strokeWidth={1.5} />
    }
    // System/auto icon
    return <Laptop className="settings-icon" size={11} strokeWidth={1.5} />
  }

  const handleIconClick = (e) => {
    e.stopPropagation()
    if (isExpanded && onCollapseClick) {
      onCollapseClick()
    } else if (!isExpanded && onExpandClick) {
      onExpandClick()
    }
  }

  const renderChipItems = (items) => {
    const hexToRgba = (hex, opacity) => {
      const r = parseInt(hex.slice(1, 3), 16)
      const g = parseInt(hex.slice(3, 5), 16)
      const b = parseInt(hex.slice(5, 7), 16)
      return `rgba(${r}, ${g}, ${b}, ${opacity})`
    }
    return items.map(({ key, label, gameweek: gw, color }) => (
      <div
        key={key}
        className={`chip-item ${gw ? 'chip-used' : ''}`}
        style={gw ? {
          background: hexToRgba(color, 0.05),
          borderColor: color,
          borderWidth: '2px',
          color: color
        } : {}}
        title={gw ? `Used in Gameweek ${gw}` : 'Not used'}
      >
        <div className="chip-label">{label}</div>
        {gw && <div className="chip-gameweek">GW{gw}</div>}
      </div>
    ))
  }

  const chipsPageDots = (
    <div className="chips-page-dots" role="tablist" aria-label="Chips half">
      {[0, 1].map((index) => (
        <button
          key={index}
          type="button"
          role="tab"
          aria-selected={chipsPage === index}
          className={`chips-page-dot ${chipsPage === index ? 'chips-page-dot--active' : ''}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); setChipsPage(index) }}
          title={index === 0 ? 'First half chips' : 'Second half chips'}
        />
      ))}
    </div>
  )

  const handleGwLegendClick = (e) => {
    e.stopPropagation()
    setShowGwLegendPopup((v) => !v)
  }

  const isGwPointsExpanded = id === 'gw-points' && isExpanded
  const showExpandIcon = id === 'overall-rank' || id === 'team-value' || id === 'total-points' || id === 'gw-points' || id === 'transfers' || id === 'chips' || id === 'league-rank' || id === 'captain'

  return (
    <div className={cardClasses} style={style}>
      {showExpandIcon && (
        isGwPointsExpanded ? (
          <div className="bento-card-expand-icons" ref={gwExpandIconsRef}>
            <div
              className="bento-card-info-icon"
              title="Legend"
              onClick={handleGwLegendClick}
              role="button"
              aria-expanded={showGwLegendPopup}
              aria-haspopup="dialog"
            >
              <Info className="bento-card-expand-icon-svg" size={10} strokeWidth={1.5} />
            </div>
            {showGwLegendPopup && (
              <div className="gw-legend-popup" role="dialog" aria-label="GW points legend">
                <div className="gw-legend-popup-title">Legend</div>
                <div className="gw-legend-popup-row">
                  <span className="gameweek-points-legend-badge rank-highlight">x</span>
                  <span className="gw-legend-popup-text">Top 10 in GW</span>
                </div>
                <div className="gw-legend-popup-row">
                  <span className="bento-card-captain-badge gw-legend-popup-badge-c">C</span>
                  <span className="gw-legend-popup-text">Captain</span>
                </div>
                <div className="gw-legend-popup-row">
                  <span className="bento-card-captain-vice-badge gw-legend-popup-badge-v">V</span>
                  <span className="gw-legend-popup-text">Vice captain</span>
                </div>
                <div className="gw-legend-popup-row">
                  <span className="gw-legend-popup-dnp">DNP</span>
                  <span className="gw-legend-popup-text">Did not play</span>
                </div>
                <div className="gw-legend-popup-row">
                  <span className="gameweek-points-legend-badge defcon-achieved">x</span>
                  <span className="gw-legend-popup-text">Defcon achieved</span>
                </div>
              </div>
            )}
            <div
              className={`bento-card-expand-icon bento-card-expand-icon--collapse${showGwLegendPopup ? ' bento-card-expand-icon--legend-open' : ''}`}
              title={showGwLegendPopup ? undefined : 'Collapse'}
              onClick={handleIconClick}
            >
              <X className="bento-card-expand-icon-svg bento-card-collapse-x" size={10} strokeWidth={1.5} />
            </div>
          </div>
        ) : (
          <div
            className={`bento-card-expand-icon${isExpanded ? ' bento-card-expand-icon--collapse' : ''}`}
            title={isExpanded ? "Collapse" : "Expand"}
            onClick={handleIconClick}
          >
            {isExpanded ? (
              <X className="bento-card-expand-icon-svg bento-card-collapse-x" size={10} strokeWidth={1.5} />
            ) : (
              <MoveDiagonal className="bento-card-expand-icon-svg" size={10} strokeWidth={1.5} />
            )}
          </div>
        )
      )}
      <div className="bento-card-label">
        {label}
        {id === 'gw-points' && isExpanded && subtext && (
          <span className="bento-card-label-suffix">| {subtext}</span>
        )}
      </div>
      
      {loading ? (
        <div className="bento-card-value loading">
          <div className="skeleton-text"></div>
        </div>
      ) : id === 'captain' && !isExpanded ? (
        <div className="bento-card-captain-collapsed">
          <div className="bento-card-value bento-card-captain-row">
            <span className="bento-card-captain-name">{captainName ?? '—'}</span>
            <span className="bento-card-captain-badge">C</span>
          </div>
          <div className="bento-card-captain-vice-row">
            <span className="bento-card-captain-vice-name">{viceCaptainName ?? '—'}</span>
            <span className="bento-card-captain-vice-badge">V</span>
          </div>
        </div>
      ) : isTransfers && value !== undefined && !isExpanded ? (
        <div className="bento-card-transfers-row">
          <div className="bento-card-value bento-card-transfers-value">{value}</div>
          {transfersSummary?.transfers?.length > 0 ? (
            <div className="bento-card-transfers-list">
              {transfersSummary.transfers.map((t, i) => (
                <div key={i} className="bento-card-transfer-item">
                  <span className="bento-card-transfer-out">{t.playerOutName}</span>
                  <span className="bento-card-transfer-arrow">→</span>
                  <span className="bento-card-transfer-in">{t.playerInName}</span>
                  {t.pointImpact != null && (
                    <span className={`bento-card-transfer-delta ${t.pointImpact >= 0 ? 'positive' : 'negative'}`}>
                      {t.pointImpact >= 0 ? '+' : ''}{t.pointImpact}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : value !== undefined ? (
        <>
          {!(id === 'league-rank' && isExpanded) && (
            <div className={`bento-card-value ${id === 'league-rank' ? 'bento-card-value-with-inline-change' : ''}`}>
              {value}
              {isStale && <span className="stale-indicator" title="Data may be out of date during live games">!</span>}
            </div>
          )}
          {id !== 'league-rank' && change !== undefined && change !== 0 && (
            <div className={`bento-card-change ${change > 0 ? 'positive' : 'negative'}`}>
              {change > 0 ? <CircleArrowUp size={14} /> : <CircleArrowDown size={14} />} {formatNumber(Math.abs(change))}
            </div>
          )}
          {id === 'league-rank' && !isExpanded && change !== undefined && change !== 0 && (
            <div className="bento-card-change-in-subtext">
              <span className={`bento-card-change-inline ${change > 0 ? 'positive' : 'negative'}`}>
                {change > 0 ? <CircleArrowUp size={14} /> : <CircleArrowDown size={14} />} {formatNumber(Math.abs(change))}
              </span>
            </div>
          )}
        </>
      ) : null}
      
      {subtext && !(id === 'gw-points' && isExpanded) && (
        id === 'gw-points' ? (
          <div className="bento-card-subtext-row">
            <div className="bento-card-subtext">{subtext}</div>
          </div>
        ) : (
          <div className="bento-card-subtext">{subtext}</div>
        )
      )}
      
      {isChart && (
        <div className="bento-card-chart">
          {id === 'team-value' ? (
            <TeamValueChart
              data={chartData || []}
              comparisonData={chartComparisonData}
              filter={chartFilter}
              showComparison={showChartComparison}
              loading={loading}
              onFilterChange={onChartFilterChange}
            />
          ) : (
            <PerformanceChart
              data={chartData || []}
              comparisonData={chartComparisonData}
              filter={chartFilter}
              showComparison={showChartComparison}
              loading={loading}
              onFilterChange={onChartFilterChange}
            />
          )}
        </div>
      )}
      
      {isExpanded && id === 'total-points' && (
        <div className="bento-card-chart">
          <PlayerPerformanceChart
            data={playerChartData || []}
            loading={loading}
            filter={playerChartFilter}
            onFilterChange={onPlayerChartFilterChange}
          />
        </div>
      )}
      
      {isExpanded && id === 'gw-points' && (
        <div className="bento-card-chart">
          <GameweekPointsView
            data={currentGameweekPlayersData || []}
            loading={loading}
            top10ByStat={top10ByStat}
          />
        </div>
      )}
      
      {isExpanded && id === 'transfers' && (
        <div className="transfers-summary-card">
          <div className="transfers-summary-content">
            <div className="transfers-summary-columns-wrapper">
              <div className="transfers-summary-column transfers-summary-column-out">
                <div className="transfers-summary-column-header">
                  <span className="transfers-summary-column-title transfers-summary-column-title-out">→OUT</span>
                </div>
                {leagueTopTransfersLoading ? (
                  <div className="transfers-summary-loading">Loading...</div>
                ) : (leagueTopTransfersOut?.length ?? 0) === 0 ? (
                  <div className="transfers-summary-empty">No data</div>
                ) : (
                  <div className="transfers-summary-column-list">
                    {(leagueTopTransfersOut || []).map((row, i) => (
                      <div key={i} className="transfers-summary-column-item">
                        <span className="transfers-summary-badge-slot">
                          {row.teamShortName ? (
                            <img
                              src={`/badges/${row.teamShortName}.svg`}
                              alt=""
                              className="transfers-summary-badge"
                            />
                          ) : (
                            <span className="transfers-summary-badge-placeholder" aria-hidden />
                          )}
                        </span>
                        <span className="transfers-summary-column-name">{row.playerName}</span>
                        <span className="transfers-summary-column-count">{row.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="transfers-summary-column transfers-summary-column-in">
                <div className="transfers-summary-column-header">
                  <span className="transfers-summary-column-title transfers-summary-column-title-in">←IN</span>
                </div>
                {leagueTopTransfersLoading ? (
                  <div className="transfers-summary-loading">Loading...</div>
                ) : (leagueTopTransfersIn?.length ?? 0) === 0 ? (
                  <div className="transfers-summary-empty">No data</div>
                ) : (
                  <div className="transfers-summary-column-list">
                    {(leagueTopTransfersIn || []).map((row, i) => (
                      <div key={i} className="transfers-summary-column-item">
                        <span className="transfers-summary-badge-slot">
                          {row.teamShortName ? (
                            <img
                              src={`/badges/${row.teamShortName}.svg`}
                              alt=""
                              className="transfers-summary-badge"
                            />
                          ) : (
                            <span className="transfers-summary-badge-placeholder" aria-hidden />
                          )}
                        </span>
                        <span className="transfers-summary-column-name">{row.playerName}</span>
                        <span className="transfers-summary-column-count">{row.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      
      {isChips && !isExpanded && (
        <div
          className="chips-pages-wrapper"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            handleChipsSwipeStart(e.clientX)
          }}
          onPointerUp={(e) => handleChipsSwipeEnd(e.clientX)}
          onTouchStart={(e) => handleChipsSwipeStart(e.touches[0].clientX)}
          onTouchEnd={(e) => e.changedTouches[0] && handleChipsSwipeEnd(e.changedTouches[0].clientX)}
        >
          <div
            className="chips-pages-track"
            style={{ transform: `translateX(-${chipsPage * 50}%)` }}
          >
            <div className="chips-page">
              <div className="chips-grid chips-grid-collapsed">
                {renderChipItems(collapsedChipItemsFirst)}
              </div>
            </div>
            <div className="chips-page">
              <div className="chips-grid chips-grid-collapsed">
                {renderChipItems(collapsedChipItemsSecond)}
              </div>
            </div>
          </div>
          {chipsPageDots}
        </div>
      )}

      {isExpanded && id === 'chips' && (
        <div
          className="chips-pages-wrapper chips-pages-wrapper--expanded"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            handleChipsSwipeStart(e.clientX)
          }}
          onPointerUp={(e) => handleChipsSwipeEnd(e.clientX)}
          onTouchStart={(e) => handleChipsSwipeStart(e.touches[0].clientX)}
          onTouchEnd={(e) => e.changedTouches[0] && handleChipsSwipeEnd(e.changedTouches[0].clientX)}
        >
          <div className="league-standings-bento chips-standings-bento">
            <div className="league-standings-bento-table-wrapper">
              {leagueChipsLoading ? (
                <div className="league-standings-bento-loading">Loading league chips…</div>
              ) : !leagueChipData?.length ? (
                <div className="league-standings-bento-empty">No managers in this league</div>
              ) : (
                <>
                  <div className="chips-status-header">
                    <div className="chips-status-cell chips-status-rank">Rank</div>
                    <div className="chips-status-cell chips-status-manager">Manager</div>
                    {chipColumns.map(({ key, label }) => (
                      <div key={key} className="chips-status-cell chips-status-chip-col">
                        {label}
                      </div>
                    ))}
                  </div>
                  <div className="chips-status-list">
                    {leagueChipData.map(({ manager_id, manager_name, rank, chipUsage: usage }) => {
                      const isCurrentUser = currentManagerId != null && manager_id === currentManagerId
                      return (
                      <div key={manager_id} className={`chips-status-row${isCurrentUser ? ' chips-status-row-you' : ''}`}>
                        <div className="chips-status-cell chips-status-rank">
                          {rank != null ? rank : '—'}
                        </div>
                        <div className="chips-status-cell chips-status-manager" title={manager_name}>
                          {manager_name}
                        </div>
                        {chipColumns.map(({ key }) => {
                          const gw = usage?.[key]
                          return (
                            <div key={key} className="chips-status-cell chips-status-chip-col">
                              {gw ? <span className="chips-status-played">GW{gw}</span> : <span className="chips-status-left">—</span>}
                            </div>
                          )
                        })}
                      </div>
                    )
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
          {chipsPageDots}
        </div>
      )}

      {isExpanded && id === 'league-rank' && (
        <div className="league-standings-bento">
          <div className="league-standings-bento-table-wrapper">
            {leagueStandingsLoading ? (
              <div className="league-standings-bento-loading">Loading standings…</div>
            ) : !leagueStandings?.length ? (
              <div className="league-standings-bento-empty">No league configured or no standings</div>
            ) : (
              <table className="league-standings-bento-table">
                <thead>
                  <tr>
                    <th className="league-standings-bento-rank">Rank</th>
                    <th className="league-standings-bento-team">Manager</th>
                    <th className="league-standings-bento-total">Total</th>
                    <th className="league-standings-bento-gw">GW</th>
                  </tr>
                </thead>
                <tbody>
                  {leagueStandings.map((s, index) => {
                    const rank = s.mini_league_rank != null ? s.mini_league_rank : (index + 1)
                    const change = s.mini_league_rank_change != null ? s.mini_league_rank_change : null
                    const displayName = (s.manager_team_name && s.manager_team_name.trim()) ? s.manager_team_name : (s.manager_name || `Manager ${s.manager_id}`)
                    const isCurrentUser = currentManagerId != null && s.manager_id === currentManagerId
                    return (
                      <tr key={s.manager_id} className={isCurrentUser ? 'league-standings-bento-row-you' : ''}>
                        <td className="league-standings-bento-rank">
                          <span className="league-standings-bento-rank-inner">
                            <span className="league-standings-bento-rank-value">{rank}</span>
                            {change !== null && change !== 0 ? (
                              <span className={`league-standings-bento-change-badge ${change > 0 ? 'positive' : 'negative'}`}>
                                {Math.abs(change) >= 2
                                  ? (change > 0 ? <ChevronsUp size={12} /> : <ChevronsDown size={12} />)
                                  : (change > 0 ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}{' '}
                                {Math.abs(change)}
                              </span>
                            ) : null}
                          </span>
                        </td>
                        <td className="league-standings-bento-team" title={displayName}>{displayName}</td>
                        <td className={`league-standings-bento-total ${(s.total_points ?? null) === 0 ? 'league-standings-bento-cell-muted' : ''}`}>{s.total_points ?? '—'}</td>
                        <td className={`league-standings-bento-gw ${(s.gameweek_points ?? null) === 0 ? 'league-standings-bento-cell-muted' : ''}`}>{s.gameweek_points ?? '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {isExpanded && id === 'captain' && (
        <div className="league-standings-bento captain-standings-bento">
          <div className="league-standings-bento-table-wrapper">
            {leagueCaptainLoading ? (
              <div className="league-standings-bento-loading">Loading captain picks…</div>
            ) : !leagueCaptainData?.length ? (
              <div className="league-standings-bento-empty">No league configured or no captain data</div>
            ) : (
              <table className="league-standings-bento-table captain-standings-bento-table">
                <thead>
                  <tr>
                    <th className="league-standings-bento-rank">Rank</th>
                    <th className="league-standings-bento-team">Manager</th>
                    <th className="captain-standings-bento-captain">
                      <span className="captain-standings-bento-header-cell">
                        Captain <span className="captain-standings-bento-badge-c">C</span>
                      </span>
                    </th>
                    <th className="captain-standings-bento-vice">
                      <span className="captain-standings-bento-header-cell">
                        Vice <span className="captain-standings-bento-badge-v">V</span>
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {leagueCaptainData.map((row) => {
                    const isCurrentUser = currentManagerId != null && row.manager_id === currentManagerId
                    return (
                      <tr key={row.manager_id} className={isCurrentUser ? 'league-standings-bento-row-you' : ''}>
                        <td className="league-standings-bento-rank">{row.rank ?? '—'}</td>
                        <td className="league-standings-bento-team" title={row.manager_team_name}>{row.manager_team_name}</td>
                        <td className="captain-standings-bento-captain" title={row.captain_name}>{row.captain_name}</td>
                        <td className="captain-standings-bento-vice" title={row.vice_captain_name}>{row.vice_captain_name}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
      
      {isSettings && (
        <div className="settings-bento-content">
          <button className="settings-bento-button" onClick={cycleTheme} title={`Theme: ${getThemeLabel()}`}>
            {getThemeIcon()}
            {getThemeLabel()}
          </button>
          <button className="settings-bento-button configure-bento-button" onClick={onConfigureClick}>
            <Settings className="settings-icon" size={11} strokeWidth={1.5} />
            Configure
          </button>
        </div>
      )}
    </div>
  )
}
