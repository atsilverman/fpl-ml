import { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { ClockFading } from 'lucide-react'
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

function OpponentCell({ rowTeamId, opponent, lastH2H, showReverseScores, onMatchupClick, difficultyOverridesByDimension, useCustomDifficulty, difficultyDimension }) {
  if (!opponent) return <td className="schedule-cell schedule-cell-empty">—</td>
  const short = opponent.short_name ?? '?'
  const display = opponent.isHome ? (short || '?').toUpperCase() : (short || '?').toLowerCase()
  const baseDifficulty = getBaseDifficultyByDimension(opponent, difficultyDimension)
  const overrides = getOverridesByDimension(difficultyOverridesByDimension, difficultyDimension)
  const strength = useCustomDifficulty
    ? getEffectiveStrength(baseDifficulty, overrides, opponent.team_id)
    : (baseDifficulty != null ? Math.min(5, Math.max(1, baseDifficulty)) : null)
  const difficultyClass =
    strength != null && strength >= 1 && strength <= 5
      ? `schedule-cell-difficulty-${strength}`
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
      className={`schedule-cell schedule-cell-abbr-only ${opponent.isHome ? 'schedule-cell-home' : 'schedule-cell-away'} ${difficultyClass} ${resultClass} ${canOpenPopup ? 'schedule-cell-clickable' : ''}`}
      title={opponent.team_name ?? short}
      role={canOpenPopup ? 'button' : undefined}
      tabIndex={canOpenPopup ? 0 : undefined}
      onClick={canOpenPopup ? handleClick : undefined}
      onKeyDown={canOpenPopup ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(e) } } : undefined}
      aria-label={canOpenPopup ? (canShowReverse ? `View last meeting: ${short}` : `View matchup: ${short}`) : undefined}
    >
      <span className="schedule-cell-opponent-content">
        <span className="schedule-cell-opponent-inner">
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
  const { teamIds, getOpponent } = scheduleMatrix
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
  const [popupCell, setPopupCell] = useState(null)
  const useCustomDifficulty = difficultySource === 'custom'
  const POPUP_MOBILE_BREAKPOINT = 640
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth <= POPUP_MOBILE_BREAKPOINT)

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
  const homeTeam = reverseHomeId != null ? mapForRow[reverseHomeId] : null
  const awayTeam = reverseAwayId != null ? mapForRow[reverseAwayId] : null
  const mergedPopupPlayers = useMemo(() => {
    if (!isMobile || (!homePlayers?.length && !awayPlayers?.length)) return []
    const merged = [...(homePlayers ?? []), ...(awayPlayers ?? [])]
    const seen = new Set()
    const deduped = merged.filter((p) => {
      const id = p.player_id != null ? Number(p.player_id) : null
      if (id == null || seen.has(id)) return false
      seen.add(id)
      return true
    })
    return deduped.sort((a, b) => (b.points ?? 0) - (a.points ?? 0))
  }, [isMobile, homePlayers, awayPlayers])

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${POPUP_MOBILE_BREAKPOINT}px)`)
    const handle = () => setIsMobile(mql.matches)
    mql.addEventListener('change', handle)
    handle()
    return () => mql.removeEventListener('change', handle)
  }, [])

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

  const handleMatchupClick = (rowTeamId, opponentTeamId) => {
    setPopupCell({ rowTeamId, opponentTeamId })
  }

  if (loading) {
    return (
      <div className="schedule-subpage">
        <header className="schedule-subpage-header research-page-card-header">
          <span className="research-page-card-title bento-card-label schedule-subpage-title">Schedule</span>
        </header>
        <div className="schedule-loading">Loading schedule…</div>
      </div>
    )
  }

  if (!gameweeks?.length) {
    return (
      <div className="schedule-subpage">
        <header className="schedule-subpage-header research-page-card-header">
          <span className="research-page-card-title bento-card-label schedule-subpage-title">Schedule</span>
        </header>
        <div className="schedule-empty">No upcoming gameweeks (is_next and beyond).</div>
      </div>
    )
  }

  return (
    <div className="schedule-subpage">
      <header className="schedule-subpage-header research-page-card-header">
        <span className="research-page-card-title bento-card-label schedule-subpage-title">Schedule</span>
        <div className="schedule-header-filters-wrap">
          <div className="schedule-filter-row" role="group" aria-label="Schedule filters">
            <div className="schedule-filter-group-with-label">
              <div className="schedule-filter-group" role="group" aria-label="Difficulty source">
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
            <span className="schedule-filter-sep" aria-hidden />
            <div className="schedule-filter-group-with-label">
              <div className="schedule-filter-group" role="group" aria-label="Difficulty dimension">
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
              <>
                <span className="schedule-filter-sep" aria-hidden />
                <div className="schedule-filter-actions">
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
              </>
            )}
          </div>
        </div>
      </header>
      <div className="research-schedule-content">
      <div className="schedule-scroll-wrap">
        <table className="schedule-table">
          <thead>
            <tr>
              <th className="schedule-th schedule-th-team">Team</th>
              {gameweeks.map((gw) => (
                <th key={gw.id} className="schedule-th schedule-th-gw">
                  {gw.id}
                </th>
              ))}
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
                  {gameweeks.map((gw) => {
                    const opponent = getOpponent(teamId, gw.id)
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
                      />
                    )
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
                  ) : isMobile ? (
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
                  ) : (
                    <div className="matchup-detail-tables">
                      <MatchPlayerTable
                        key={`${reverseFixtureId}-home`}
                        players={homePlayers}
                        teamShortName={homeTeam?.short_name}
                        teamName={homeTeam?.team_name}
                        top10ByStat={null}
                        ownedPlayerIds={null}
                        useDashForDnp
                      />
                      <MatchPlayerTable
                        key={`${reverseFixtureId}-away`}
                        players={awayPlayers}
                        teamShortName={awayTeam?.short_name}
                        teamName={awayTeam?.team_name}
                        top10ByStat={null}
                        ownedPlayerIds={null}
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
