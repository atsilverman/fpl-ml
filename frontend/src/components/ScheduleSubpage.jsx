import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useAxisLockedScroll } from '../hooks/useAxisLockedScroll'
import { createPortal } from 'react-dom'
import { Filter, X, SlidersHorizontal, Minimize2, MoveDiagonal, Info } from 'lucide-react'
import { useScheduleData } from '../hooks/useScheduleData'
import { useLastH2H, pairKey } from '../hooks/useLastH2H'
import { useConfiguration } from '../contexts/ConfigurationContext'
import { useFixturePlayerStats } from '../hooks/useFixturePlayerStats'
import { useToast } from '../contexts/ToastContext'
import { abbreviateTeamName } from '../utils/formatDisplay'
import { MatchPlayerTable } from './MatchesSubpage'
import ScheduleDifficultyCustomizer from './ScheduleDifficultyCustomizer'
import './MatchesSubpage.css'
import './StatsSubpage.css'
import './CustomizeModal.css'
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

function OpponentCell({ rowTeamId, opponent, lastH2H, showReverseScores, onMatchupClick, difficultyOverridesByDimension, useCustomDifficulty, difficultyDimension, compact, colSpan, hiddenDifficultyValues, onToggleDifficultyByValue }) {
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
  const isDifficultyHidden = strength != null && hiddenDifficultyValues?.has(strength)
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
  const handleCellClick = (e) => {
    if (!canOpenPopup) return
    e.preventDefault()
    e.stopPropagation()
    onMatchupClick(rowTeamId, opponent.team_id)
  }

  const handlePillClick = (e) => {
    if (onToggleDifficultyByValue && strength != null) {
      e.preventDefault()
      e.stopPropagation()
      onToggleDifficultyByValue(strength)
    }
  }

  const demoteClass = isDifficultyHidden ? ' schedule-cell-difficulty-demoted' : ''
  const canToggleByValue = strength != null && onToggleDifficultyByValue

  return (
    <td
      colSpan={colSpan}
      className={`schedule-cell schedule-cell-abbr-only ${opponent.isHome ? 'schedule-cell-home' : 'schedule-cell-away'} ${resultClass} ${canOpenPopup ? 'schedule-cell-clickable' : ''}${compact ? ' schedule-cell--compact' : ''}`}
      title={opponent.team_name ?? short}
      role={canOpenPopup ? 'button' : undefined}
      tabIndex={canOpenPopup ? 0 : undefined}
      onClick={canOpenPopup ? handleCellClick : undefined}
      onKeyDown={canOpenPopup ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCellClick(e) } } : undefined}
      aria-label={canOpenPopup ? (canShowReverse ? `View last meeting: ${short}` : `View matchup: ${short}`) : undefined}
    >
      <span className="schedule-cell-opponent-content">
        <span
          className={`schedule-cell-opponent-inner${difficultyPillClass ? ` ${difficultyPillClass}` : ''}${demoteClass}`}
          role={canToggleByValue ? 'button' : undefined}
          tabIndex={canToggleByValue ? 0 : undefined}
          onClick={canToggleByValue ? handlePillClick : undefined}
          onKeyDown={canToggleByValue ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handlePillClick(e) } } : undefined}
          aria-label={canToggleByValue ? (isDifficultyHidden ? `Show all difficulty ${strength} fixtures` : `Hide all difficulty ${strength} fixtures`) : undefined}
        >
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
  const { teamIds, getOpponents, getOpponent, slotsPerGw } = scheduleMatrix
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
  const [customizePopoverOpen, setCustomizePopoverOpen] = useState(false)
  const [popupCell, setPopupCell] = useState(null)
  const [hiddenDifficultyValues, setHiddenDifficultyValues] = useState(() => new Set())
  const [hasCustomizerChanges, setHasCustomizerChanges] = useState(false)
  const [recommendationsExpanded, setRecommendationsExpanded] = useState(false)
  const [showBuySellInfo, setShowBuySellInfo] = useState(false)
  const scheduleCustomizerRef = useRef(null)
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

  const handleMatchupClick = (rowTeamId, opponentTeamId) => {
    setPopupCell({ rowTeamId, opponentTeamId })
  }

  const hasActiveScheduleFilters = difficultySource !== 'fpl' || difficultyDimension !== 'overall' || showReverseScores
  const scheduleFilterSummaryText = useMemo(() => {
    const sourceLabel = difficultySource === 'fpl' ? 'FPL Difficulty' : 'Custom Difficulty'
    const dimensionLabel = difficultyDimension === 'overall' ? 'Overall Rating' : difficultyDimension === 'attack' ? 'Attacking Rating' : 'Defensive Rating'
    const parts = [sourceLabel, dimensionLabel]
    if (showReverseScores) parts.push('Last H2H')
    return parts.join(' · ')
  }, [difficultySource, difficultyDimension, showReverseScores])
  const handleResetScheduleFilters = useCallback(() => {
    setDifficultySource('fpl')
    setDifficultyDimension('overall')
    setShowReverseScores(false)
  }, [])

  const toggleDifficultyByValue = useCallback((value) => {
    setHiddenDifficultyValues((prev) => {
      const next = new Set(prev)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })
  }, [])
  const resetDifficultyVisibility = useCallback(() => {
    setHiddenDifficultyValues(new Set())
  }, [])

  const SHORT_TERM_GWS = 4
  const LONG_TERM_GWS = 10
  const TOP_N_PER_CELL = 4

  const scheduleRecommendations = useMemo(() => {
    if (!gameweeks?.length || !teamIds?.length || typeof getOpponent !== 'function') {
      return {
        summaryText: 'Buy: easiest run. Sell: hardest run (by avg Opponent Category 1-5).',
        buyShort: [],
        buyLong: [],
        sellShort: [],
        sellLong: [],
      }
    }
    const shortGwIds = gameweeks.slice(0, SHORT_TERM_GWS).map((gw) => gw.id)
    const longGwIds = gameweeks.slice(0, LONG_TERM_GWS).map((gw) => gw.id)
    const overrides = getOverridesByDimension(difficultyOverridesByDimension, difficultyDimension)

    function oppDifficulty(opponent) {
      if (!opponent) return null
      const base = getBaseDifficultyByDimension(opponent, difficultyDimension)
      return useCustomDifficulty
        ? getEffectiveStrength(base, overrides, opponent.team_id)
        : base != null
          ? Math.min(5, Math.max(1, base))
          : null
    }

    function avgOpponentDifficulty(teamId, gwIdsToUse) {
      let sum = 0
      let count = 0
      for (const gwId of gwIdsToUse) {
        const opp = getOpponent(teamId, gwId)
        const d = oppDifficulty(opp)
        if (d != null) {
          sum += d
          count += 1
        }
      }
      return count > 0 ? sum / count : null
    }

    const teamScores = teamIds.map((teamId) => {
      const avgShort = avgOpponentDifficulty(teamId, shortGwIds)
      const avgLong = avgOpponentDifficulty(teamId, longGwIds)
      return {
        teamId,
        avgShort: avgShort ?? 5,
        avgLong: avgLong ?? 5,
      }
    })

    // Target = easiest run (lowest aggregate opponent strength 1-5)
    const byTargetShort = [...teamScores].sort(
      (a, b) => a.avgShort - b.avgShort || a.teamId - b.teamId
    )
    const byTargetLong = [...teamScores].sort(
      (a, b) => a.avgLong - b.avgLong || a.teamId - b.teamId
    )
    // Avoid = hardest run (highest aggregate opponent strength 1-5)
    const byAvoidShort = [...teamScores].sort(
      (a, b) => b.avgShort - a.avgShort || a.teamId - b.teamId
    )
    const byAvoidLong = [...teamScores].sort(
      (a, b) => b.avgLong - a.avgLong || a.teamId - b.teamId
    )

    const buyShort = byTargetShort.slice(0, TOP_N_PER_CELL).map((t) => t.teamId)
    const buyLong = byTargetLong.slice(0, TOP_N_PER_CELL).map((t) => t.teamId)
    const sellShort = byAvoidShort.slice(0, TOP_N_PER_CELL).map((t) => t.teamId)
    const sellLong = byAvoidLong.slice(0, TOP_N_PER_CELL).map((t) => t.teamId)

    const topBuy = byTargetShort[0]
    const topSell = byAvoidShort[0]
    const topBuyName = topBuy && mapForRow[topBuy.teamId]?.short_name
    const topSellName = topSell && mapForRow[topSell.teamId]?.short_name
    let summaryText = 'Buy: easiest run. Sell: hardest run (by avg Opponent Category 1-5).'
    if (topBuyName && topSellName) {
      summaryText = `Buy: ${topBuyName} (easiest next ${SHORT_TERM_GWS} GWs). Sell: ${topSellName} (hardest run).`
    } else if (topBuyName) {
      summaryText = `Buy: ${topBuyName} — easiest run. ${summaryText}`
    } else if (topSellName) {
      summaryText = `Sell: ${topSellName} — hardest run. ${summaryText}`
    }

    return {
      summaryText,
      buyShort,
      buyLong,
      sellShort,
      sellLong,
    }
  }, [
    gameweeks,
    teamIds,
    getOpponent,
    mapForRow,
    difficultyOverridesByDimension,
    useCustomDifficulty,
    difficultyDimension,
  ])

  if (loading) {
    return (
      <div className="research-schedule-subpage">
        <div className="research-schedule-sticky-header">
          <div className="research-schedule-toolbar">
            <div className="schedule-header-icon-group">
              <button
                type="button"
                className="stats-filter-btn schedule-filter-btn"
                disabled
                aria-label="Customize difficulty (unavailable while loading)"
              >
                <SlidersHorizontal size={14} strokeWidth={2} />
                <span className="stats-toolbar-btn-label">Customize</span>
              </button>
            </div>
            <div className="schedule-header-icon-group schedule-header-icon-group--right">
              <button
                type="button"
                className="stats-filter-btn schedule-filter-btn"
                disabled
                aria-label="Schedule view options (unavailable while loading)"
              >
                <Filter size={14} strokeWidth={2} />
              </button>
            </div>
          </div>
        </div>
        <div className="research-schedule-card research-card">
          <div className="schedule-loading">Loading schedule…</div>
        </div>
      </div>
    )
  }

  if (!gameweeks?.length) {
    return (
      <div className="research-schedule-subpage">
        <div className="research-schedule-sticky-header">
<div className="research-schedule-toolbar">
              <div className="schedule-header-icon-group">
                <button
                  type="button"
                  className="stats-filter-btn schedule-filter-btn"
                  onClick={() => setCustomizePopoverOpen(true)}
                  aria-label="Customize difficulty"
                  aria-expanded={false}
                  aria-haspopup="dialog"
                >
                  <SlidersHorizontal size={14} strokeWidth={2} />
                  <span className="stats-toolbar-btn-label">Customize</span>
                </button>
              </div>
              <div className="schedule-header-icon-group schedule-header-icon-group--right">
                <button
                  type="button"
                  className="stats-filter-btn schedule-filter-btn"
                  aria-label="Show filters"
                  aria-expanded={false}
                >
                  <Filter size={14} strokeWidth={2} />
                </button>
              </div>
          </div>
        </div>
        <div className="research-schedule-card research-card bento-card bento-card-animate bento-card-expanded">
          <div className="schedule-empty">No upcoming gameweeks (is_next and beyond).</div>
        </div>
      </div>
    )
  }

  return (
    <div className="research-schedule-subpage">
      <div className="research-schedule-sticky-header">
        <div className="research-schedule-toolbar">
          <div className="schedule-header-icon-group">
            <button
              type="button"
              className={`stats-filter-btn schedule-filter-btn ${customizePopoverOpen ? 'stats-filter-btn-close' : ''} ${(config?.teamStrengthOverrides ?? config?.teamAttackOverrides ?? config?.teamDefenceOverrides) ? 'stats-compare-btn--active' : ''}`}
              onClick={() => setCustomizePopoverOpen((open) => !open)}
              aria-label={customizePopoverOpen ? 'Close customize' : 'Customize difficulty'}
              aria-expanded={customizePopoverOpen}
              aria-haspopup="dialog"
            >
              <SlidersHorizontal size={14} strokeWidth={2} />
              <span className="stats-toolbar-btn-label">Customize</span>
            </button>
          </div>
          <div className="schedule-header-icon-group schedule-header-icon-group--right">
            <button
              type="button"
              className={`stats-filter-btn schedule-filter-btn ${filterPopoverOpen ? 'stats-filter-btn-close' : ''} ${hasActiveScheduleFilters ? 'stats-compare-btn--active' : ''}`}
              onClick={() => setFilterPopoverOpen((open) => !open)}
              aria-label={filterPopoverOpen ? 'Close filters' : 'Show filters'}
              aria-expanded={filterPopoverOpen}
              aria-haspopup="dialog"
            >
              <Filter size={14} strokeWidth={2} />
            </button>
          </div>
        </div>
        <p className="research-stats-filter-summary" aria-live="polite">
          <span className="research-stats-filter-summary-viewing">Viewing:</span> {scheduleFilterSummaryText}
          {hiddenDifficultyValues.size > 0 && (
            <>
              {' · '}
              <button
                type="button"
                className="schedule-reset-difficulty-visibility-btn"
                onClick={resetDifficultyVisibility}
                aria-label="Show difficulty on all opponent cells again"
              >
                Reset difficulty
              </button>
            </>
          )}
        </p>
      </div>
      <div className={`schedule-recommendations-bento ${recommendationsExpanded ? 'schedule-recommendations-bento--expanded' : 'schedule-recommendations-bento--collapsed'}`}>
        <div className="schedule-recommendations-bento-content">
          <div
            className="schedule-recommendations-bento-header"
            role="button"
            tabIndex={0}
            onClick={() => setRecommendationsExpanded((v) => !v)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setRecommendationsExpanded((v) => !v); } }}
            aria-expanded={recommendationsExpanded}
            aria-label={recommendationsExpanded ? 'Collapse Buy / Sell' : 'Expand Buy / Sell'}
          >
            <span className="schedule-recommendations-bento-title">Buy / Sell</span>
            <span className="schedule-recommendations-bento-header-icons">
              <button
                type="button"
                className="schedule-recommendations-bento-info-btn"
                onClick={(e) => { e.stopPropagation(); setShowBuySellInfo((v) => !v); }}
                aria-label={showBuySellInfo ? 'Hide formula description' : 'How Buy / Sell is calculated'}
                aria-expanded={showBuySellInfo}
                title="How this is calculated"
              >
                <Info className="schedule-recommendations-bento-info-icon" size={14} strokeWidth={2} />
              </button>
              <span className="schedule-recommendations-bento-expand-icon" title={recommendationsExpanded ? 'Collapse' : 'Expand'} aria-hidden>
                {recommendationsExpanded ? (
                  <Minimize2 className="schedule-recommendations-bento-expand-icon-svg" size={11} strokeWidth={1.5} />
                ) : (
                  <MoveDiagonal className="schedule-recommendations-bento-expand-icon-svg" size={11} strokeWidth={1.5} />
                )}
              </span>
            </span>
          </div>
          {showBuySellInfo && recommendationsExpanded && (
            <p className="schedule-recommendations-bento-formula-desc">
              Average Opponent Category (1–5) over the next 4 or 10 gameweeks. Buy = lowest avg (easiest run). Sell = highest avg (hardest run).
            </p>
          )}
          {recommendationsExpanded && (
            <section className="research-schedule-recommendations" aria-live="polite" aria-label="Buy and sell teams by run">
              <div className="schedule-recommendations-grid">
                <div className="schedule-recommendations-corner" aria-hidden />
                <div className="schedule-recommendations-col-header">Short Term (4 GW)</div>
                <div className="schedule-recommendations-col-header">Long Term (10 GW)</div>
                <div className="schedule-recommendations-row-header">Buy</div>
                <div className="schedule-recommendations-panel schedule-recommendations-panel--buy">
                  <ul className="research-schedule-recommendations-list">
                    {scheduleRecommendations.buyShort.map((teamId) => {
                      const team = mapForRow[teamId]
                      const short = team?.short_name ?? '?'
                      return (
                        <li key={teamId} className="research-schedule-recommendations-item">
                          <img src={`/badges/${short}.svg`} alt="" className="research-schedule-recommendations-badge" />
                          <span className="research-schedule-recommendations-abbr">{short}</span>
                        </li>
                      )
                    })}
                  </ul>
                </div>
                <div className="schedule-recommendations-panel schedule-recommendations-panel--buy">
                  <ul className="research-schedule-recommendations-list">
                    {scheduleRecommendations.buyLong.map((teamId) => {
                      const team = mapForRow[teamId]
                      const short = team?.short_name ?? '?'
                      return (
                        <li key={teamId} className="research-schedule-recommendations-item">
                          <img src={`/badges/${short}.svg`} alt="" className="research-schedule-recommendations-badge" />
                          <span className="research-schedule-recommendations-abbr">{short}</span>
                        </li>
                      )
                    })}
                  </ul>
                </div>
                <div className="schedule-recommendations-row-header">Sell</div>
                <div className="schedule-recommendations-panel schedule-recommendations-panel--sell">
                  <ul className="research-schedule-recommendations-list">
                    {scheduleRecommendations.sellShort.map((teamId) => {
                      const team = mapForRow[teamId]
                      const short = team?.short_name ?? '?'
                      return (
                        <li key={teamId} className="research-schedule-recommendations-item">
                          <img src={`/badges/${short}.svg`} alt="" className="research-schedule-recommendations-badge" />
                          <span className="research-schedule-recommendations-abbr">{short}</span>
                        </li>
                      )
                    })}
                  </ul>
                </div>
                <div className="schedule-recommendations-panel schedule-recommendations-panel--sell">
                  <ul className="research-schedule-recommendations-list">
                    {scheduleRecommendations.sellLong.map((teamId) => {
                      const team = mapForRow[teamId]
                      const short = team?.short_name ?? '?'
                      return (
                        <li key={teamId} className="research-schedule-recommendations-item">
                          <img src={`/badges/${short}.svg`} alt="" className="research-schedule-recommendations-badge" />
                          <span className="research-schedule-recommendations-abbr">{short}</span>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
        {customizePopoverOpen && typeof document !== 'undefined' && createPortal(
          <div className="stats-filter-overlay" role="dialog" aria-modal="true" aria-label="Customize difficulty">
            <div className="stats-filter-overlay-backdrop" onClick={() => setCustomizePopoverOpen(false)} aria-hidden />
            <div className="stats-filter-overlay-panel stats-filter-overlay-panel--customize">
              <div className="schedule-filter-popover-header">
                <span className="schedule-filter-popover-title">Customize difficulty</span>
                <button type="button" className="schedule-filter-popover-close" onClick={() => setCustomizePopoverOpen(false)} aria-label="Close">
                  <X size={20} strokeWidth={2} />
                </button>
              </div>
              <div className="stats-filter-overlay-body stats-filter-overlay-body--customize">
                <div className="schedule-legend-inline schedule-legend-inline--popup" aria-label="Opponent difficulty: 1 easiest, 5 hardest">
                  <div className="schedule-legend-inline-pills">
                    {[1, 2, 3, 4, 5].map((d) => (
                      <span key={d} className={`schedule-cell-difficulty-pill schedule-cell-difficulty-pill--${d} schedule-legend-inline-pill`}>
                        <span className="schedule-cell-abbr-display">{d}</span>
                      </span>
                    ))}
                  </div>
                  <span className="schedule-legend-inline-label">Difficulty: Easy → Hard</span>
                </div>
                {loading ? (
                  <p className="customize-section-loading">Loading teams…</p>
                ) : (
                  <ScheduleDifficultyCustomizer
                    ref={scheduleCustomizerRef}
                    embedded
                    teamIds={scheduleMatrix?.teamIds ?? []}
                    teamMap={mapForRow}
                    savedOverridesByStat={{
                      strength: config?.teamStrengthOverrides ?? null,
                      attack: config?.teamAttackOverrides ?? null,
                      defence: config?.teamDefenceOverrides ?? null,
                    }}
                    onHasChangesChange={setHasCustomizerChanges}
                    onSave={({ strength, attack, defence }) => {
                      if (strength != null) saveTeamStrengthOverrides(strength)
                      if (attack != null) saveTeamAttackOverrides(attack)
                      if (defence != null) saveTeamDefenceOverrides(defence)
                      toast('Custom difficulty saved')
                      setHasCustomizerChanges(false)
                    }}
                    onResetStat={(statId) => {
                      if (statId === 'strength') resetTeamStrengthOverrides()
                      else if (statId === 'attack') resetTeamAttackOverrides()
                      else if (statId === 'defence') resetTeamDefenceOverrides()
                    }}
                  />
                )}
              </div>
              <div className="stats-filter-overlay-footer stats-filter-overlay-footer--customize">
                <button
                  type="button"
                  className={`stats-filter-overlay-save ${hasCustomizerChanges ? 'stats-filter-overlay-save--active' : ''}`}
                  onClick={() => scheduleCustomizerRef.current?.save()}
                  aria-label="Save difficulty changes"
                >
                  Save
                </button>
                <button type="button" className="stats-filter-overlay-done" onClick={() => setCustomizePopoverOpen(false)} aria-label="Done">
                  Done
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
        {filterPopoverOpen && typeof document !== 'undefined' && createPortal(
          <div className="stats-filter-overlay" role="dialog" aria-modal="true" aria-label="Schedule filters">
            <div className="stats-filter-overlay-backdrop" onClick={() => setFilterPopoverOpen(false)} aria-hidden />
            <div className="stats-filter-overlay-panel">
              <div className="schedule-filter-popover-header">
                <span className="schedule-filter-popover-title">Filters</span>
                <div className="schedule-filter-popover-header-actions">
                  {hasActiveScheduleFilters && (
                    <button
                      type="button"
                      className="schedule-filter-popover-reset"
                      onClick={handleResetScheduleFilters}
                      aria-label="Reset all filters to default"
                    >
                      Reset
                    </button>
                  )}
                  <button type="button" className="schedule-filter-popover-close" onClick={() => setFilterPopoverOpen(false)} aria-label="Close filters">
                    <X size={20} strokeWidth={2} />
                  </button>
                </div>
              </div>
              <div className="schedule-filter-popover-body">
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
              <span className="schedule-filter-popover-label">Opponent Category</span>
              <div className="schedule-filter-popover-buttons">
                <button
                  type="button"
                  className={`schedule-filter-btn ${difficultyDimension === 'overall' ? 'schedule-filter-btn--active' : ''}`}
                  onClick={() => setDifficultyDimension('overall')}
                  aria-pressed={difficultyDimension === 'overall'}
                  aria-label="Overall rating"
                >
                  Overall
                </button>
                <button
                  type="button"
                  className={`schedule-filter-btn ${difficultyDimension === 'attack' ? 'schedule-filter-btn--active' : ''}`}
                  onClick={() => setDifficultyDimension('attack')}
                  aria-pressed={difficultyDimension === 'attack'}
                  aria-label="Attacking rating"
                >
                  Attacking
                </button>
                <button
                  type="button"
                  className={`schedule-filter-btn ${difficultyDimension === 'defence' ? 'schedule-filter-btn--active' : ''}`}
                  onClick={() => setDifficultyDimension('defence')}
                  aria-pressed={difficultyDimension === 'defence'}
                  aria-label="Defensive rating"
                >
                  Defending
                </button>
              </div>
            </div>
            {isSecondHalf && (
              <div className="schedule-filter-popover-section">
                <span className="schedule-filter-popover-label">Last H2H</span>
                <div className="schedule-filter-popover-buttons">
                  <button
                    type="button"
                    className={`schedule-filter-btn ${showReverseScores ? 'schedule-filter-btn--active' : ''}`}
                    onClick={() => {
                      if (!showReverseScores) {
                        setShowReverseScores(true)
                        setTimeout(() => toast('Showing last H2H'), 0)
                      }
                    }}
                    aria-pressed={showReverseScores}
                    aria-label="Show reverse fixture scores"
                    title="Show reverse fixture scores"
                  >
                    Show
                  </button>
                  <button
                    type="button"
                    className={`schedule-filter-btn ${!showReverseScores ? 'schedule-filter-btn--active' : ''}`}
                    onClick={() => {
                      if (showReverseScores) {
                        setShowReverseScores(false)
                        setTimeout(() => toast('Hiding last H2H'), 0)
                      }
                    }}
                    aria-pressed={!showReverseScores}
                    aria-label="Hide reverse fixture scores"
                    title="Hide reverse fixture scores"
                  >
                    Hide
                  </button>
                </div>
              </div>
            )}
              </div>
              <div className="stats-filter-overlay-footer">
                <button type="button" className="stats-filter-overlay-done" onClick={() => setFilterPopoverOpen(false)} aria-label="Done">
                  Done
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
      <div className="research-schedule-card research-card bento-card bento-card-animate bento-card-expanded">
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
              const teamName = team?.team_name ?? short
              const displayName = teamName && teamName.length > 10 ? `${teamName.slice(0, 10)}..` : teamName
              return (
                <tr
                  key={`schedule-row-${teamId}`}
                  className="schedule-row"
                >
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
                      <span className="schedule-cell-team-name" title={teamName}>{displayName}</span>
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
                          hiddenDifficultyValues={hiddenDifficultyValues}
                          onToggleDifficultyByValue={toggleDifficultyByValue}
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
                          hiddenDifficultyValues={hiddenDifficultyValues}
                          onToggleDifficultyByValue={toggleDifficultyByValue}
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
