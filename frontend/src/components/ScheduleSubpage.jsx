import { useState, useRef, useEffect, useMemo } from 'react'
import { useAxisLockedScroll } from '../hooks/useAxisLockedScroll'
import { createPortal } from 'react-dom'
import { ClockFading, Filter, Info } from 'lucide-react'
import { useScheduleData } from '../hooks/useScheduleData'
import { useLastH2H, pairKey } from '../hooks/useLastH2H'
import { useConfiguration } from '../contexts/ConfigurationContext'
import { useFixturePlayerStats } from '../hooks/useFixturePlayerStats'
import { useToast } from '../contexts/ToastContext'
import { abbreviateTeamName } from '../utils/formatDisplay'
import { MatchPlayerTable } from './MatchesSubpage'
import './MatchesSubpage.css'
import './ScheduleSubpage.css'

function getEffectiveStrength(apiStrength, overrides, teamId) {
  const override = overrides && teamId != null ? overrides[String(teamId)] ?? overrides[teamId] : undefined
  const raw = override != null ? Number(override) : apiStrength
  if (raw == null || Number.isNaN(raw)) return null
  return Math.min(5, Math.max(1, raw))
}

function getBaseDifficultyByDimension(opponent, dimension) {
  if (dimension === 'attack') return opponent.attackDifficulty ?? opponent.strength
  if (dimension === 'defence') return opponent.defenceDifficulty ?? opponent.strength
  return opponent.difficulty ?? opponent.strength
}

function getOverridesByDimension(overridesMap, dimension) {
  if (dimension === 'attack') return overridesMap?.attack ?? null
  if (dimension === 'defence') return overridesMap?.defence ?? null
  return overridesMap?.overall ?? null
}

function OpponentCell({ rowTeamId, opponent, lastH2H, showReverseScores, onMatchupClick, difficultyOverridesByDimension, useCustomDifficulty, difficultyDimension, compact, colSpan }) {
  if (!opponent) return <td colSpan={colSpan} className={`schedule-cell schedule-cell-empty${compact ? ' schedule-cell--compact' : ''}`}>—</td>
  const short = opponent.short_name ?? '?'
  const display = opponent.isHome ? (short || '?').toUpperCase() : (short || '?').toLowerCase()
  const baseDifficulty = getBaseDifficultyByDimension(opponent, difficultyDimension)
  const overrides = getOverridesByDimension(difficultyOverridesByDimension, difficultyDimension)
  const strength = useCustomDifficulty
    ? getEffectiveStrength(baseDifficulty, overrides, opponent.team_id)
    : (baseDifficulty != null ? Math.min(5, Math.max(1, baseDifficulty)) : null)
  const difficultyPillClass =
    strength != null && strength >= 1 && strength <= 5
      ? `schedule-cell-difficulty-pill schedule-cell-difficulty-pill--${strength}`
      : ''
  const canShowReverse = lastH2H && lastH2H.home_score != null && lastH2H.away_score != null
  const scoreline = lastH2H ? `${lastH2H.home_score ?? '–'}–${lastH2H.away_score ?? '–'}` : ''
  const rowWasHome = lastH2H && lastH2H.home_team_id === rowTeamId
  const rowScore = lastH2H && rowWasHome ? lastH2H.home_score : lastH2H?.away_score
  const oppScore = lastH2H && rowWasHome ? lastH2H.away_score : lastH2H?.home_score
  const resultClass =
    showReverseScores && canShowReverse && rowScore != null && oppScore != null
      ? rowScore > oppScore
        ? 'schedule-cell-reverse-win'
        : rowScore < oppScore
          ? 'schedule-cell-reverse-loss'
          : 'schedule-cell-reverse-draw'
      : ''

  /* Popup only opens when "Show last H2H" toggle is on. */
  const canOpenPopup = !!onMatchupClick && showReverseScores
  const handleClick = (e) => {
    if (!canOpenPopup) return
    e.preventDefault()
    e.stopPropagation()
    onMatchupClick(rowTeamId, opponent.team_id)
  }

  return (
    <td
      colSpan={colSpan}
      className={`schedule-cell schedule-cell-abbr-only ${opponent.isHome ? 'schedule-cell-home' : 'schedule-cell-away'} ${resultClass} ${canOpenPopup ? 'schedule-cell-clickable' : ''}${compact ? ' schedule-cell--compact' : ''}`}
      title={opponent.team_name ?? short}
      role={canOpenPopup ? 'button' : undefined}
      tabIndex={canOpenPopup ? 0 : undefined}
      onClick={canOpenPopup ? handleClick : undefined}
      onKeyDown={canOpenPopup ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(e) } } : undefined}
      aria-label={canOpenPopup ? (canShowReverse ? `View last meeting: ${short}` : `View matchup: ${short}`) : undefined}
    >
      <span className="schedule-cell-opponent-content">
        <span className={`schedule-cell-opponent-inner${difficultyPillClass ? ` ${difficultyPillClass}` : ''}`}>
          <span className="schedule-cell-abbr-display">{display}</span>
          {opponent.isHome && (
            <svg className="schedule-cell-home-indicator" width="10" height="10" viewBox="0 0 48 48" fill="currentColor" aria-label="Home" title="Home">
              <path d="M39.5,43h-9c-1.381,0-2.5-1.119-2.5-2.5v-9c0-1.105-0.895-2-2-2h-4c-1.105,0-2,0.895-2,2v9c0,1.381-1.119,2.5-2.5,2.5h-9C7.119,43,6,41.881,6,40.5V21.413c0-2.299,1.054-4.471,2.859-5.893L23.071,4.321c0.545-0.428,1.313-0.428,1.857,0L39.142,15.52C40.947,16.942,42,19.113,42,21.411V40.5C42,41.881,40.881,43,39.5,43z" />
            </svg>
          )}
        </span>
        {showReverseScores && canShowReverse && (
          <span className="schedule-cell-reverse-score" aria-live="polite">
            {scoreline}
          </span>
        )}
      </span>
    </td>
  )
}

export default function ScheduleSubpage() {
  const { scheduleMatrix, gameweeks, loading, teamMap, nextGwId } = useScheduleData()
  const { config, saveTeamStrengthOverrides, saveTeamAttackOverrides, saveTeamDefenceOverrides, resetTeamStrengthOverrides, resetTeamAttackOverrides, resetTeamDefenceOverrides } = useConfiguration()
  const { teamIds, getOpponents, slotsPerGw } = scheduleMatrix
  const mapForRow = teamMap || {}
  const difficultyOverridesByDimension = useMemo(() => ({
    overall: config?.teamStrengthOverrides ?? null,
    attack: config?.teamAttackOverrides ?? null,
    defence: config?.teamDefenceOverrides ?? null,
  }), [config?.teamStrengthOverrides, config?.teamAttackOverrides, config?.teamDefenceOverrides])
  const { lastH2HMap, isSecondHalf, loading: lastH2HLoading } = useLastH2H(nextGwId ?? undefined)
  const { toast } = useToast()
  const [difficultySource, setDifficultySource] = useState('fpl')
  const [difficultyDimension, setDifficultyDimension] = useState('overall')
  const [showReverseScores, setShowReverseScores] = useState(false)
  const [filterPopoverOpen, setFilterPopoverOpen] = useState(false)
  const [legendOpen, setLegendOpen] = useState(false)
  const [popupCell, setPopupCell] = useState(null)
  const filterPopoverRef = useRef(null)
  const legendPopoverRef = useRef(null)
  const useCustomDifficulty = difficultySource === 'custom'

  const popupLastH2H = popupCell ? lastH2HMap[pairKey(popupCell.rowTeamId, popupCell.opponentTeamId)] ?? null : null
  const reverseFixtureId = popupLastH2H?.fpl_fixture_id ?? null
  const reverseGameweek = popupLastH2H?.gameweek ?? null
  const reverseHomeId = popupLastH2H?.home_team_id ?? null
  const reverseAwayId = popupLastH2H?.away_team_id ?? null
  const { homePlayers, awayPlayers, loading: statsLoading } = useFixturePlayerStats(
    reverseFixtureId,
    reverseGameweek,
    reverseHomeId,
    reverseAwayId,
    !!popupCell && !!reverseFixtureId && !!reverseGameweek
  )

  const popupRef = useRef(null)
  const scheduleScrollRef = useRef(null)
  useAxisLockedScroll(scheduleScrollRef)
  const homeTeam = reverseHomeId != null ? mapForRow[reverseHomeId] : null
  const awayTeam = reverseAwayId != null ? mapForRow[reverseAwayId] : null
  const mergedPopupPlayers = useMemo(() => {
    if (!homePlayers?.length && !awayPlayers?.length) return []
    const merged = [...(homePlayers ?? []), ...(awayPlayers ?? [])]
    const seen = new Set()
    const deduped = merged.filter((p) => {
      const id = p.player_id != null ? Number(p.player_id) : null
      if (id == null || seen.has(id)) return false
      seen.add(id)
      return true
    })
    return deduped.sort((a, b) => (b.points ?? 0) - (a.points ?? 0))
  }, [homePlayers, awayPlayers])

  useEffect(() => {
    if (!popupCell) return
    const handleClickOutside = (e) => {
      if (popupRef.current && !popupRef.current.contains(e.target)) setPopupCell(null)
    }
    const t = setTimeout(() => document.addEventListener('mousedown', handleClickOutside), 0)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', handleClickOutside)
      document.body.style.overflow = prevOverflow
    }
  }, [popupCell])

  useEffect(() => {
    if (!filterPopoverOpen) return
    const handleClickOutside = (e) => {
      if (
        filterPopoverRef.current && !filterPopoverRef.current.contains(e.target) &&
        !e.target.closest('.schedule-filter-icon-btn')
      ) {
        setFilterPopoverOpen(false)
      }
      if (
        legendPopoverRef.current && !legendPopoverRef.current.contains(e.target) &&
        !e.target.closest('.schedule-legend-icon-btn')
      ) {
        setLegendOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [filterPopoverOpen, legendOpen])

  const handleMatchupClick = (rowTeamId, opponentTeamId) => {
    setPopupCell({ rowTeamId, opponentTeamId })
  }

  if (loading) {
    return (
      <div className="schedule-subpage">
        <div className="schedule-header-with-filter">
          <header className="schedule-subpage-header research-page-card-header">
            <span className="research-page-card-title bento-card-label schedule-subpage-title">Schedule</span>
            <button
              type="button"
              className="schedule-filter-icon-btn"
              disabled
              aria-label="Schedule view options (unavailable while loading)"
            >
              <Filter className="schedule-header-icon-svg" size={11} strokeWidth={1.5} aria-hidden />
            </button>
          </header>
        </div>
        <div className="schedule-loading">Loading schedule…</div>
      </div>
    )
  }

  if (!gameweeks?.length) {
    return (
      <div className="schedule-subpage">
        <div className="schedule-header-with-filter">
          <header className="schedule-subpage-header research-page-card-header">
            <span className="research-page-card-title bento-card-label schedule-subpage-title">Schedule</span>
            <button
              type="button"
              className="schedule-filter-icon-btn"
              aria-label="Schedule view options"
              aria-expanded={false}
            >
              <Filter className="schedule-header-icon-svg" size={11} strokeWidth={1.5} aria-hidden />
            </button>
          </header>
        </div>
        <div className="schedule-empty">No upcoming gameweeks (is_next and beyond).</div>
      </div>
    )
  }

  const hasActiveScheduleFilters = difficultySource !== 'fpl' || difficultyDimension !== 'overall' || showReverseScores

  return (
    <div className="schedule-subpage">
      <div className="schedule-header-with-filter">
        <header className="schedule-subpage-header research-page-card-header">
          <span className="research-page-card-title bento-card-label schedule-subpage-title">Schedule</span>
          <div className="schedule-header-icon-group" aria-hidden>
            <button
              type="button"
              className={`schedule-legend-icon-btn ${legendOpen ? 'schedule-legend-icon-btn--active' : ''}`}
              onClick={() => setLegendOpen((open) => !open)}
              aria-label="Opponent difficulty legend"
              aria-expanded={legendOpen}
              aria-haspopup="dialog"
            >
              <Info className="schedule-header-icon-svg" size={11} strokeWidth={1.5} aria-hidden />
            </button>
            <button
              type="button"
              className={`schedule-filter-icon-btn ${filterPopoverOpen || hasActiveScheduleFilters ? 'schedule-filter-icon-btn--active' : ''}`}
              onClick={() => setFilterPopoverOpen((open) => !open)}
              aria-label="Schedule view options"
              aria-expanded={filterPopoverOpen}
              aria-haspopup="dialog"
            >
              <Filter className="schedule-header-icon-svg" size={11} strokeWidth={1.5} aria-hidden />
            </button>
          </div>
        </header>
        {legendOpen && (
          <div className="schedule-legend-popover" ref={legendPopoverRef} role="dialog" aria-label="Opponent difficulty legend">
            <div className="schedule-legend-title">Opponent difficulty</div>
            <div className="schedule-legend-items">
              {[1, 2, 3, 4, 5].map((d) => (
                <div key={d} className="schedule-legend-row">
                  <span className={`schedule-cell-difficulty-pill schedule-cell-difficulty-pill--${d}`}>
                    <span className="schedule-cell-abbr-display">{d === 1 ? '1' : d === 5 ? '5' : String(d)}</span>
                  </span>
                  <span className="schedule-legend-label">
                    {d === 1 ? 'Easiest' : d === 5 ? 'Hardest' : d === 3 ? 'Medium' : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {filterPopoverOpen && (
          <div className="schedule-filter-popover" ref={filterPopoverRef} role="dialog" aria-label="Schedule view options">
            <div className="schedule-filter-popover-section">
              <span className="schedule-filter-popover-label">Difficulty source</span>
              <div className="schedule-filter-popover-buttons">
                <button
                  type="button"
                  className={`schedule-filter-btn ${difficultySource === 'fpl' ? 'schedule-filter-btn--active' : ''}`}
                  onClick={() => setDifficultySource('fpl')}
                  aria-pressed={difficultySource === 'fpl'}
                  aria-label="FPL difficulty"
                >
                  FPL
                </button>
                <button
                  type="button"
                  className={`schedule-filter-btn ${difficultySource === 'custom' ? 'schedule-filter-btn--active' : ''}`}
                  onClick={() => setDifficultySource('custom')}
                  aria-pressed={difficultySource === 'custom'}
                  aria-label="Custom difficulty"
                >
                  Custom
                </button>
              </div>
            </div>
            <div className="schedule-filter-popover-section">
              <span className="schedule-filter-popover-label">Dimension</span>
              <div className="schedule-filter-popover-buttons">
                <button
                  type="button"
                  className={`schedule-filter-btn ${difficultyDimension === 'overall' ? 'schedule-filter-btn--active' : ''}`}
                  onClick={() => setDifficultyDimension('overall')}
                  aria-pressed={difficultyDimension === 'overall'}
                >
                  Overall
                </button>
                <button
                  type="button"
                  className={`schedule-filter-btn ${difficultyDimension === 'attack' ? 'schedule-filter-btn--active' : ''}`}
                  onClick={() => setDifficultyDimension('attack')}
                  aria-pressed={difficultyDimension === 'attack'}
                >
                  Attack
                </button>
                <button
                  type="button"
                  className={`schedule-filter-btn ${difficultyDimension === 'defence' ? 'schedule-filter-btn--active' : ''}`}
                  onClick={() => setDifficultyDimension('defence')}
                  aria-pressed={difficultyDimension === 'defence'}
                >
                  Defence
                </button>
              </div>
            </div>
            {isSecondHalf && (
              <div className="schedule-filter-popover-section">
                <span className="schedule-filter-popover-label">Last H2H</span>
                <div className="schedule-filter-popover-buttons">
                  <button
                    type="button"
                    className={`schedule-filter-btn schedule-filter-btn-icon ${showReverseScores ? 'schedule-filter-btn--active' : ''}`}
                    onClick={() => {
                      const next = !showReverseScores
                      setShowReverseScores(next)
                      setTimeout(() => toast(next ? 'Showing last H2H' : 'Hiding last H2H'), 0)
                    }}
                    aria-pressed={showReverseScores}
                    aria-label={showReverseScores ? 'Hide reverse fixture scores' : 'Show reverse fixture scores'}
                    title={showReverseScores ? 'Hide reverse fixture scores' : 'Show reverse fixture scores'}
                  >
                    <ClockFading size={11} strokeWidth={1.5} aria-hidden />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="research-schedule-content">
      <div ref={scheduleScrollRef} className="schedule-scroll-wrap">
        <table className="schedule-table">
          <thead>
            <tr>
              <th className="schedule-th schedule-th-team">Team</th>
              {gameweeks.flatMap((gw) => {
                const slots = slotsPerGw[gw.id] ?? 1
                return Array.from({ length: slots }, (_, slotIndex) => (
                  <th
                    key={slots > 1 ? `${gw.id}-${slotIndex}` : gw.id}
                    className={`schedule-th schedule-th-gw${slots > 1 ? ' schedule-th-gw--compact' : ''}`}
                    scope="col"
                    title={slots > 1 ? `GW${gw.id} fixture ${slotIndex + 1}` : undefined}
                  >
                    {slotIndex === 0 ? gw.id : ''}
                  </th>
                ))
              })}
            </tr>
          </thead>
          <tbody>
            {teamIds.map((teamId) => {
              const team = mapForRow[teamId]
              const short = team?.short_name ?? '?'
              return (
                <tr key={teamId} className="schedule-row">
                  <td className="schedule-cell schedule-cell-team schedule-cell-sticky">
                    <span className="schedule-cell-opponent">
                      <span className="schedule-cell-badge-slot">
                        {short && short !== '?' ? (
                          <img
                            src={`/badges/${short}.svg`}
                            alt=""
                            className="schedule-cell-badge"
                            onError={(e) => {
                              e.target.style.display = 'none'
                            }}
                          />
                        ) : (
                          <span className="schedule-cell-badge-placeholder" aria-hidden />
                        )}
                      </span>
                      <span className="schedule-cell-team-name">{team?.team_name ?? short}</span>
                    </span>
                  </td>
                  {gameweeks.flatMap((gw) => {
                    const opponents = getOpponents(teamId, gw.id)
                    const slots = slotsPerGw[gw.id] ?? 1
                    const singleFixtureMerge = slots > 1 && opponents.length <= 1
                    if (singleFixtureMerge) {
                      const opponent = opponents[0] ?? null
                      const lastH2H = opponent ? lastH2HMap[pairKey(teamId, opponent.team_id)] ?? null : null
                      return (
                        <OpponentCell
                          key={gw.id}
                          rowTeamId={teamId}
                          opponent={opponent}
                          lastH2H={lastH2H}
                          showReverseScores={showReverseScores}
                          onMatchupClick={handleMatchupClick}
                          difficultyOverridesByDimension={difficultyOverridesByDimension}
                          useCustomDifficulty={useCustomDifficulty}
                          difficultyDimension={difficultyDimension}
                          compact={false}
                          colSpan={slots}
                        />
                      )
                    }
                    return Array.from({ length: slots }, (_, slotIndex) => {
                      const opponent = opponents[slotIndex] ?? null
                      const lastH2H = opponent ? lastH2HMap[pairKey(teamId, opponent.team_id)] ?? null : null
                      return (
                        <OpponentCell
                          key={slots > 1 ? `${gw.id}-${slotIndex}` : gw.id}
                          rowTeamId={teamId}
                          opponent={opponent}
                          lastH2H={lastH2H}
                          showReverseScores={showReverseScores}
                          onMatchupClick={handleMatchupClick}
                          difficultyOverridesByDimension={difficultyOverridesByDimension}
                          useCustomDifficulty={useCustomDifficulty}
                          difficultyDimension={difficultyDimension}
                          compact={slots > 1}
                        />
                      )
                    })
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      </div>

      {popupCell && createPortal(
        <div
          className="schedule-matchup-popup-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Last meeting details"
          onClick={(e) => { if (e.target === e.currentTarget) setPopupCell(null) }}
        >
          <div ref={popupRef} className="schedule-matchup-popup" onClick={(e) => e.stopPropagation()}>
            <div className="schedule-matchup-popup-inner">
              {!popupLastH2H ? (
                <div className="schedule-matchup-popup-loading">
                  <div className="skeleton-text" />
                  <p className="schedule-matchup-popup-loading-text">{lastH2HLoading ? 'Loading last meeting…' : 'No previous meeting data.'}</p>
                  <button type="button" className="schedule-matchup-popup-close-btn" onClick={() => setPopupCell(null)}>Close</button>
                </div>
              ) : (
              <div className="matchup-card final matchup-card--expanded schedule-matchup-popup-card">
                <div className="matchup-card-main">
                  <div className="matchup-card-headline">
                    <span className="matchup-card-home">
                      {homeTeam?.short_name && (
                        <img src={`/badges/${homeTeam.short_name}.svg`} alt="" className="matchup-card-badge" onError={e => { e.target.style.display = 'none' }} />
                      )}
                      <span className="matchup-card-team-name" title={homeTeam?.team_name ?? ''}>{abbreviateTeamName(homeTeam?.team_name) ?? 'Home'}</span>
                      <span className="matchup-card-home-icon" aria-label="Home in last meeting">
                        <svg className="matchup-card-home-icon-svg" viewBox="0 0 48 48" width={14} height={14} fill="currentColor" aria-hidden>
                          <path d="M39.5,43h-9c-1.381,0-2.5-1.119-2.5-2.5v-9c0-1.105-0.895-2-2-2h-4c-1.105,0-2,0.895-2,2v9c0,1.381-1.119,2.5-2.5,2.5h-9C7.119,43,6,41.881,6,40.5V21.413c0-2.299,1.054-4.471,2.859-5.893L23.071,4.321c0.545-0.428,1.313-0.428,1.857,0L39.142,15.52C40.947,16.942,42,19.113,42,21.411V40.5C42,41.881,40.881,43,39.5,43z" />
                        </svg>
                      </span>
                    </span>
                    <span className="matchup-card-score">
                      <span className="matchup-card-score-num matchup-card-score-num--h2h">{popupLastH2H.home_score ?? '–'}</span>
                      <span className="matchup-card-score-sep">-</span>
                      <span className="matchup-card-score-num matchup-card-score-num--h2h">{popupLastH2H.away_score ?? '–'}</span>
                    </span>
                    <span className="matchup-card-away">
                      {awayTeam?.short_name && (
                        <img src={`/badges/${awayTeam.short_name}.svg`} alt="" className="matchup-card-badge" onError={e => { e.target.style.display = 'none' }} />
                      )}
                      <span className="matchup-card-team-name" title={awayTeam?.team_name ?? ''}>{abbreviateTeamName(awayTeam?.team_name) ?? 'Away'}</span>
                    </span>
                  </div>
                  <div className="matchup-card-status-row">
                    <div className="matchup-card-status matchup-card-status--h2h">
                      GW{popupLastH2H.gameweek}
                    </div>
                  </div>
                </div>
                <div className="matchup-card-details matchup-card-details--tables matchup-card-details--h2h">
                  {statsLoading ? (
                    <div className="matchup-detail-loading">
                      <div className="skeleton-text" />
                    </div>
                  ) : (
                    <div className="matchup-detail-tables matchup-detail-tables--merged">
                      <MatchPlayerTable
                        key={reverseFixtureId}
                        players={mergedPopupPlayers}
                        teamShortName={null}
                        teamName="Last meeting – by points"
                        top10ByStat={null}
                        hideHeader
                        useDashForDnp
                      />
                    </div>
                  )}
                </div>
              </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

    </div>
  )
}
