import { useMemo, useRef, useLayoutEffect, useState, useEffect } from 'react'
import './BpsLeadersChart.css'

const MAX_NAME_LENGTH = 10

/** Parse computed backgroundColor to R,G,B 0–1 and optional alpha 0–1. */
function parseRgba(computed) {
  if (!computed || computed === 'transparent' || computed === 'rgba(0, 0, 0, 0)') return null
  const rgba = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/)
  if (!rgba) return null
  const r = Number(rgba[1]) / 255
  const g = Number(rgba[2]) / 255
  const b = Number(rgba[3]) / 255
  const a = rgba[4] != null ? Number(rgba[4]) : 1
  return { r, g, b, a }
}

/** Relative luminance (0–1). Use dark text when > threshold. Alpha is applied so transparent bars are treated as dark. */
function relativeLuminance(parsed) {
  if (!parsed) return 0.5
  const { r, g, b, a } = parsed
  const srgb = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const lum = 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b)
  return lum * a
}

const LUMINANCE_THRESHOLD = 0.45

/** Abbreviate long player names; full name in title. */
function abbreviateName(name) {
  if (!name || name.length <= MAX_NAME_LENGTH) return name || '—'
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) {
    const last = parts[parts.length - 1]
    const initials = parts.slice(0, -1).map((p) => (p[0] || '').toUpperCase()).join('.')
    const short = initials ? `${initials}.${last}` : last
    return short.length <= MAX_NAME_LENGTH ? short : short.slice(0, MAX_NAME_LENGTH - 1) + '…'
  }
  return name.slice(0, MAX_NAME_LENGTH - 1) + '…'
}

/** FPL bonus tiebreaker: BPS desc, then goals, assists, clean_sheets for ordering. */
function sortByBpsAndTiebreakers(players) {
  return [...players].sort((a, b) => {
    const bpsA = a.bps ?? 0
    const bpsB = b.bps ?? 0
    if (bpsB !== bpsA) return bpsB - bpsA
    const gA = a.goals_scored ?? 0
    const gB = b.goals_scored ?? 0
    if (gB !== gA) return gB - gA
    const aA = a.assists ?? 0
    const aB = b.assists ?? 0
    if (aB !== aA) return aB - aA
    const csA = a.clean_sheets ?? 0
    const csB = b.clean_sheets ?? 0
    if (csB !== csA) return csB - csA
    return (a.player_name || '').localeCompare(b.player_name || '')
  })
}

/** Min bar width % to fit the value inside the bar; below this we show the value outside (after the bar). */
const VALUE_ON_BAR_MIN_WIDTH_PCT = 32

/**
 * BPS leaders horizontal bar chart for a single fixture.
 * Top 3 by BPS (with FPL tiebreakers) are colored: 3 pts = gold, 2 pts = silver, 1 pt = bronze.
 * Optional gameweekMaxBps scales bars to gameweek-wide max so all fixtures share the same scale.
 */
export default function BpsLeadersChart({ players = [], loading = false, gameweekMaxBps = null, isProvisional = false, showHeader = true, animateKey, fixtureStatus }) {
  const BPS_FILL_ANIMATION_MS = 400
  const barsRef = useRef(null)
  const [contrastByPlayerId, setContrastByPlayerId] = useState({})
  const [playFillAnimation, setPlayFillAnimation] = useState(false)
  const [labelsVisible, setLabelsVisible] = useState(false)

  const { sortedPlayers, maxBps } = useMemo(() => {
    if (!players?.length) return { sortedPlayers: [], maxBps: 1 }
    const withBps = players.filter((p) => (p.bps ?? 0) > 0)
    if (!withBps.length) return { sortedPlayers: [], maxBps: 1 }
    const sorted = sortByBpsAndTiebreakers(withBps)
    const fixtureMax = Math.max(...sorted.map((p) => p.bps ?? 0), 1)
    const scaleMax = gameweekMaxBps != null && gameweekMaxBps > 0
      ? Math.max(gameweekMaxBps, fixtureMax)
      : fixtureMax
    return { sortedPlayers: sorted, maxBps: scaleMax }
  }, [players, gameweekMaxBps])

  const barWidthPercent = (bps) =>
    maxBps > 0 ? Math.min(100, ((bps ?? 0) / maxBps) * 100) : 0

  /** Bonus 3 = gold (1st), 2 = silver (2nd), 1 = bronze (3rd), 0 = neutral. Uses effective_bonus or bonus from player. */
  const barClassForBonus = (bonus) => {
    const b = bonus ?? 0
    if (b === 3) return 'bps-chart__fill--bonus-1'
    if (b === 2) return 'bps-chart__fill--bonus-2'
    if (b === 1) return 'bps-chart__fill--bonus-3'
    return 'bps-chart__fill--no-bonus'
  }

  /** When value is on bar, use auto contrast (dark vs light text); otherwise after-bar uses primary text. */
  const valueColorClass = (valueOnBar, bonus, playerId) => {
    if (!valueOnBar) return 'bps-chart__value--after-bar'
    const contrast = contrastByPlayerId[playerId]
    if (contrast === 'dark') return 'bps-chart__value--on-bar bps-chart__value--contrast-dark'
    if (contrast === 'light') return 'bps-chart__value--on-bar bps-chart__value--contrast-light'
    return 'bps-chart__value--on-bar bps-chart__value--contrast-dark'
  }

  useLayoutEffect(() => {
    if (!sortedPlayers.length) return
    const id = requestAnimationFrame(() => setPlayFillAnimation(true))
    return () => cancelAnimationFrame(id)
  }, [sortedPlayers.length])

  useEffect(() => {
    if (animateKey == null || !sortedPlayers.length) return
    setPlayFillAnimation(false)
    setLabelsVisible(false)
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setPlayFillAnimation(true))
    })
    return () => cancelAnimationFrame(id)
  }, [animateKey, sortedPlayers.length])

  useEffect(() => {
    if (!playFillAnimation || !sortedPlayers.length) return
    const t = setTimeout(() => setLabelsVisible(true), BPS_FILL_ANIMATION_MS)
    return () => clearTimeout(t)
  }, [playFillAnimation, sortedPlayers.length])

  useLayoutEffect(() => {
    if (!sortedPlayers.length || !barsRef.current) return
    const fills = barsRef.current.querySelectorAll('.bps-chart__fill')
    if (fills.length !== sortedPlayers.length) return
    const next = {}
    fills.forEach((fill, i) => {
      const player = sortedPlayers[i]
      if (!player) return
      const parsed = parseRgba(getComputedStyle(fill).backgroundColor)
      const lum = relativeLuminance(parsed)
      next[player.player_id] = lum > LUMINANCE_THRESHOLD ? 'dark' : 'light'
    })
    setContrastByPlayerId((prev) => {
      if (
        Object.keys(prev).length === Object.keys(next).length &&
        sortedPlayers.every((p) => prev[p.player_id] === next[p.player_id])
      ) return prev
      return next
    })
  }, [sortedPlayers])

  if (loading) {
    return (
      <div className="bps-chart bps-chart--loading">
        <div className="bps-chart__skeleton" />
      </div>
    )
  }

  if (!sortedPlayers.length) {
    const emptyMessage = fixtureStatus === 'scheduled'
      ? 'Stats will appear when the match has started.'
      : 'No player data for this match'
    return (
      <div className="bps-chart">
        <div className="bps-chart__empty">{emptyMessage}</div>
      </div>
    )
  }

  return (
    <div className={`bps-chart${isProvisional ? ' bps-chart--provisional' : ''}${!showHeader ? ' bps-chart--no-header' : ''}${labelsVisible ? ' bps-chart--labels-visible' : ''}`} role="list" aria-label="BPS leaders">
      {showHeader && (
        <div className="bps-chart__header" aria-hidden>
          <div className="bps-chart__header-label" />
          <div className="bps-chart__header-bps">BPS</div>
          <div className="bps-chart__header-bonus">Bonus</div>
        </div>
      )}
      <div className="bps-chart__bars" ref={barsRef}>
        {sortedPlayers.map((player, index) => {
          const bps = player.bps ?? 0
          const widthPct = barWidthPercent(bps)
          const valueOnBar = widthPct >= VALUE_ON_BAR_MIN_WIDTH_PCT
          const apiBonus = player.bonus ?? player.effective_bonus ?? 0
          const numBonus = Number(apiBonus)
          const hasOfficialBonus = numBonus >= 1 && numBonus <= 3
          const bonus = hasOfficialBonus
            ? numBonus
            : isProvisional
              ? (index === 0 ? 3 : index === 1 ? 2 : index === 2 ? 1 : 0)
              : 0
          const inBonus = bonus >= 1 && bonus <= 3
          return (
            <div
              key={player.player_id}
              className="bps-chart__row"
              role="listitem"
              title={`${player.player_name}: ${bps} BPS${inBonus ? ` · ${bonus} bonus pt${bonus !== 1 ? 's' : ''}` : ''}`}
            >
              <div className="bps-chart__label">
                <span className="bps-chart__name" title={player.player_name}>
                  {abbreviateName(player.player_name)}
                </span>
                {player.player_team_short_name && (
                  <img
                    className="bps-chart__badge"
                    src={`/badges/${player.player_team_short_name}.svg`}
                    alt=""
                    width={20}
                    height={20}
                    onError={(e) => {
                      e.target.style.display = 'none'
                    }}
                  />
                )}
              </div>
              <div className="bps-chart__track">
                <div
                  className={`bps-chart__fill ${barClassForBonus(bonus)}${playFillAnimation ? ' bps-chart__fill--animate' : ''}`}
                  style={{ width: `${widthPct}%` }}
                />
                <span
                  className={`bps-chart__value bps-chart__value--delayed ${valueColorClass(valueOnBar, bonus, player.player_id)}${valueOnBar && bonus === 0 ? ' bps-chart__value--no-bonus-bar' : ''}`}
                  style={
                    valueOnBar
                      ? { left: `calc(${widthPct}% - 8px)`, right: 'auto', transform: 'translateY(-50%) translateX(-100%)' }
                      : { left: `${widthPct}%`, marginLeft: 8, right: 'auto' }
                  }
                >
                  {bps}
                </span>
              </div>
              <div className="bps-chart__bonus-col bps-chart__bonus-col--delayed">
                {inBonus ? (
                  <span className={`bps-chart__bonus-badge bps-chart__bonus-badge--${bonus}`} title={`${bonus} bonus pt${bonus !== 1 ? 's' : ''}`}>
                    {bonus}+
                  </span>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
