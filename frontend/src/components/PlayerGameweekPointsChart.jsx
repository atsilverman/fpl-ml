import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as d3 from 'd3'
import './PlayerGameweekPointsChart.css'

export const CHART_RANGE_FILTERS = [
  { key: 'gw20plus', label: 'GW20+' },
  { key: 'last6', label: 'Last 6' },
  { key: 'last12', label: 'Last 12' },
]

const EXPECTED_STAT_KEYS = ['expected_goals', 'expected_assists', 'expected_goal_involvements', 'expected_goals_conceded']

/** DEFCON threshold by FPL position: 1=GK, 2=DEF, 3=MID, 4=FWD. GK 999 = no threshold. */
const DEFCON_THRESHOLD_BY_POSITION = { 1: 999, 2: 10, 3: 12, 4: 12 }
/** Saves threshold for GK: 3+ saves = 1 pt per 3 */
const SAVES_THRESHOLD_GK = 3

/** When viewing this stat, overlay a subtle line for the corresponding expected stat */
const STAT_TO_EXPECTED = {
  goals: 'expected_goals',
  assists: 'expected_assists',
  goal_involvements: 'expected_goal_involvements',
}

function getStatValue(d, statKey) {
  if (statKey === 'goal_involvements') return (d.goals ?? 0) + (d.assists ?? 0)
  return d[statKey] ?? 0
}

function formatStatLabel(value, statKey) {
  if (EXPECTED_STAT_KEYS.includes(statKey)) {
    const n = Number(value)
    return n === 0 ? '0' : n.toFixed(2)
  }
  return String(value)
}

/** Bar fill: green for positive, red for negative (red bar drawn in positive direction with negative label). */
function getBarFill(d, getVal) {
  const v = getVal(d)
  return v < 0 ? 'var(--accent-red, #dc2626)' : 'var(--accent-green, #10b981)'
}

/** Whether we're showing DEFCON/Saves threshold styling (hashed vs solid). */
function isThresholdStat(statKey, position, thresholdLine) {
  if (thresholdLine == null || thresholdLine <= 0) return false
  if (statKey === 'defensive_contribution' && position != null && position !== 1) return true
  if (statKey === 'saves' && position === 1) return true
  return false
}

/** True if this gameweek's value met or exceeded the DEFCON/Saves threshold. */
function hitThreshold(d, getVal, thresholdLine) {
  if (thresholdLine == null) return false
  return (getVal(d) ?? 0) >= thresholdLine
}

/** True when player did not play in that gameweek (fixture played and 0 minutes). Don't show DNP if game hasn't started. */
function isDnp(d) {
  const minutes = d.minutes !== undefined ? Number(d.minutes) : undefined
  const matchPlayed = d.match_played === true || d.match_played === 'true'
  return minutes === 0 && matchPlayed
}

const DNP_ICON_R = 6
const DNP_LABEL_OFFSET_Y = 10

/**
 * D3 bar chart: player stat per gameweek (points, goals, assists, or goal involvements).
 * X-axis = gameweek (oldest left, newest right). Filter: GW20+ / Last 6 (default) / Last 12.
 */
function formatAverageForDisplay(value, statKey) {
  if (value == null || Number.isNaN(value)) return null
  if (EXPECTED_STAT_KEYS.includes(statKey)) return Number(value).toFixed(2)
  return value % 1 === 0 ? String(value) : value.toFixed(1)
}

export default function PlayerGameweekPointsChart({
  data = [],
  loading = false,
  statKey = 'points',
  position = null,
  onAverageChange = null,
  filter: filterProp = null,
  onFilterChange = null,
}) {
  const svgRef = useRef(null)
  const containerRef = useRef(null)
  const [dimensions, setDimensions] = useState({ width: 400, height: 220 })
  const [internalFilter, setInternalFilter] = useState('last6')
  const isControlled = filterProp != null && typeof onFilterChange === 'function'
  const filter = isControlled ? filterProp : internalFilter
  const setFilter = isControlled ? onFilterChange : setInternalFilter

  const filteredData = useMemo(() => {
    if (!data || data.length === 0) return []
    if (filter === 'last6' && data.length > 6) return data.slice(-6)
    if (filter === 'last12' && data.length > 12) return data.slice(-12)
    if (filter === 'gw20plus') return data.filter((d) => (d.gameweek ?? 0) >= 20)
    return data
  }, [data, filter])

  const avgValForReport = useMemo(() => {
    if (!filteredData.length) return null
    const getVal = (d) => getStatValue(d, statKey)
    const sum = filteredData.reduce((a, d) => a + (getVal(d) ?? 0), 0)
    const avg = sum / filteredData.length
    return Number.isNaN(avg) ? null : avg
  }, [filteredData, statKey])

  useEffect(() => {
    if (typeof onAverageChange !== 'function') return
    const formatted = formatAverageForDisplay(avgValForReport, statKey)
    onAverageChange(formatted)
  }, [avgValForReport, statKey, onAverageChange])

  useEffect(() => {
    if (!containerRef.current) return
    let resizeTimeout
    const updateDimensions = () => {
      if (!containerRef.current) return
      const el = containerRef.current
      const w = Math.max(280, el.clientWidth || 400)
      const h = Math.max(180, el.clientHeight || 220)
      setDimensions((prev) => {
        if (Math.abs(prev.width - w) < 2 && Math.abs(prev.height - h) < 2) return prev
        return { width: w, height: h }
      })
    }
    updateDimensions()
    const ro = new ResizeObserver(() => {
      clearTimeout(resizeTimeout)
      resizeTimeout = setTimeout(updateDimensions, 100)
    })
    ro.observe(containerRef.current)
    return () => {
      clearTimeout(resizeTimeout)
      ro.disconnect()
    }
  }, [])

  // useLayoutEffect so chart redraws synchronously when statKey/filter change (e.g. from filter popup)
  useLayoutEffect(() => {
    if (!filteredData.length || !svgRef.current || loading) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const width = dimensions.width
    const height = dimensions.height
    const padding = {
      top: 20,
      right: 16,
      bottom: 28,
      left: 32,
    }
    const chartWidth = width - padding.left - padding.right
    const chartHeight = height - padding.top - padding.bottom

    const getVal = (d) => getStatValue(d, statKey)
    const expectedKey = STAT_TO_EXPECTED[statKey]
    const getExpectedVal = expectedKey ? (d) => getStatValue(d, expectedKey) : null
    const defconThreshold = statKey === 'defensive_contribution' && position != null ? DEFCON_THRESHOLD_BY_POSITION[position] : null
    const savesThreshold = statKey === 'saves' && position === 1 ? SAVES_THRESHOLD_GK : null
    const thresholdLine = defconThreshold != null && defconThreshold < 999 ? defconThreshold : savesThreshold
    const allVals = filteredData.map(getVal)
    const avgVal = filteredData.length ? allVals.reduce((a, b) => a + b, 0) / filteredData.length : null
    const maxAbs = Math.max(1, ...allVals.map((v) => Math.abs(v)), ...(getExpectedVal ? filteredData.map(getExpectedVal) : [0]), thresholdLine ?? 0, avgVal ?? 0)
    const yMax = Math.ceil(maxAbs * 1.1) || 10

    const xScale = d3
      .scaleBand()
      .domain(filteredData.map((d) => String(d.gameweek)))
      .range([padding.left, width - padding.right])
      .padding(0.25)

    const yScale = d3
      .scaleLinear()
      .domain([0, yMax])
      .range([height - padding.bottom, padding.top])

    const baselineY = height - padding.bottom
    // For negative values: bar height is |v| drawn upward from baseline. DNP: no bar (height 0).
    const getBarY = (d) => {
      if (isDnp(d)) return baselineY
      const v = getVal(d)
      const displayVal = v < 0 ? -v : v
      return yScale(displayVal)
    }
    const getBarHeight = (d) => {
      if (isDnp(d)) return 0
      const v = getVal(d)
      const displayVal = v < 0 ? -v : v
      return Math.max(0, yScale(0) - yScale(displayVal))
    }
    const getBarFillFor = (d) => getBarFill(d, getVal)
    const getLabelY = (d, pillHeight, barLabelGap) => {
      return getBarY(d) - barLabelGap - pillHeight / 2
    }

    const useThresholdStyling = isThresholdStat(statKey, position, thresholdLine)
    const getBarFillOrThreshold = (d) => {
      if (isDnp(d)) return 'transparent'
      if (!useThresholdStyling) return getBarFillFor(d)
      const v = getVal(d)
      if (v < 0) return 'var(--accent-red, #dc2626)'
      return hitThreshold(d, getVal, thresholdLine) ? 'var(--accent-green, #10b981)' : 'url(#player-gw-chart-hash-muted)'
    }

    // DEFCON/Saves hash pattern: parallel diagonals only (no crossing), subdued for "not achieved"
    if (useThresholdStyling) {
      const hashId = 'player-gw-chart-hash-muted'
      const pattern = svg.append('defs').append('pattern').attr('id', hashId).attr('patternUnits', 'userSpaceOnUse').attr('width', 6).attr('height', 6)
      pattern.append('rect').attr('width', 6).attr('height', 6).attr('fill', 'var(--text-secondary, #64748b)').attr('opacity', 0.12)
      const hashLines = [{ x1: 0, y1: 6, x2: 6, y2: 0 }] // single diagonal; pattern repeat gives parallel stripes
      pattern
        .append('g')
        .attr('fill', 'none')
        .attr('stroke', 'var(--text-secondary, #64748b)')
        .attr('stroke-width', 1)
        .attr('opacity', 0.35)
        .selectAll('line')
        .data(hashLines)
        .join('line')
        .attr('x1', (d) => d.x1)
        .attr('y1', (d) => d.y1)
        .attr('x2', (d) => d.x2)
        .attr('y2', (d) => d.y2)
    }

    const g = svg.append('g').attr('class', 'player-gw-chart-group')

    // Horizontal grid lines (full width) — drawn first so they sit behind bars, labels, and all other content
    const yTicks = yScale.ticks(5)
    const gridBg = g.append('g').attr('class', 'player-gw-chart-grid-background')
    yTicks.forEach((tick) => {
      const y = yScale(tick)
      gridBg
        .append('line')
        .attr('class', 'player-gw-chart-grid-line')
        .attr('x1', padding.left)
        .attr('x2', width - padding.right)
        .attr('y1', y)
        .attr('y2', y)
    })

    // Y-axis line
    g.append('line')
      .attr('class', 'player-gw-chart-axis player-gw-chart-y-axis')
      .attr('x1', padding.left)
      .attr('y1', padding.top)
      .attr('x2', padding.left)
      .attr('y2', height - padding.bottom)
      .attr('stroke', 'var(--border-color)')
      .attr('stroke-width', 1)

    // X-axis line
    g.append('line')
      .attr('class', 'player-gw-chart-axis player-gw-chart-x-axis')
      .attr('x1', padding.left)
      .attr('y1', height - padding.bottom)
      .attr('x2', width - padding.right)
      .attr('y2', height - padding.bottom)
      .attr('stroke', 'var(--border-color)')
      .attr('stroke-width', 1)

    // Threshold line: dashed grey in background, no label
    if (thresholdLine != null && thresholdLine > 0 && thresholdLine <= yMax) {
      const yThreshold = yScale(thresholdLine)
      g.append('line')
        .attr('class', 'player-gw-chart-threshold-line')
        .attr('x1', padding.left)
        .attr('x2', width - padding.right)
        .attr('y1', yThreshold)
        .attr('y2', yThreshold)
    }

    // Saves: horizontal lines at 6, 9, 12, … (dashed grey, no labels)
    if (statKey === 'saves') {
      for (let val = 6; val <= yMax; val += 3) {
        const y = yScale(val)
        g.append('line')
          .attr('class', 'player-gw-chart-saves-increment-line')
          .attr('x1', padding.left)
          .attr('x2', width - padding.right)
          .attr('y1', y)
          .attr('y2', y)
      }
    }

    // Y-axis labels
    const yLabelFontSize = 10
    const yAxisLabelFormat = (v) =>
      EXPECTED_STAT_KEYS.includes(statKey) ? Number(v).toFixed(2) : String(v)
    g.selectAll('.player-gw-chart-y-label')
      .data(yTicks)
      .join('text')
      .attr('class', 'player-gw-chart-y-label')
      .attr('x', padding.left - 6)
      .attr('y', (d) => yScale(d) + 4)
      .attr('text-anchor', 'end')
      .attr('font-size', yLabelFontSize)
      .attr('fill', 'var(--text-secondary)')
      .text(yAxisLabelFormat)

    // X-axis labels: all gameweeks
    const xLabelFontSize = 10
    filteredData.forEach((d) => {
      const gw = d.gameweek
      const x = xScale(String(gw)) + xScale.bandwidth() / 2
      g.append('text')
        .attr('class', 'player-gw-chart-x-label')
        .attr('x', x)
        .attr('y', height - padding.bottom + 14)
        .attr('text-anchor', 'middle')
        .attr('font-size', xLabelFontSize)
        .attr('fill', 'var(--text-secondary)')
        .text(String(gw))
    })

    const barTransition = d3.transition().duration(350).ease(d3.easeCubicOut)

    // Bars: start from zero height then grow to value. DEFCON/Saves: hashed if below threshold, solid if achieved. DNP: no visible bar.
    const barClass = (d) => {
      const neg = getVal(d) < 0 ? 'player-gw-chart-bar--negative' : ''
      if (isDnp(d)) return 'player-gw-chart-bar player-gw-chart-bar--dnp'
      if (!useThresholdStyling || getVal(d) <= 0) return `player-gw-chart-bar ${neg}`.trim()
      const achieved = hitThreshold(d, getVal, thresholdLine) ? 'player-gw-chart-bar--achieved' : 'player-gw-chart-bar--hashed'
      return `player-gw-chart-bar ${achieved} ${neg}`.trim()
    }
    g.selectAll('.player-gw-chart-bar')
      .data(filteredData, (d) => d.gameweek)
      .join(
        (enter) =>
          enter
            .append('rect')
            .attr('class', barClass)
            .attr('x', (d) => xScale(String(d.gameweek)))
            .attr('y', height - padding.bottom)
            .attr('width', xScale.bandwidth())
            .attr('height', 0)
            .attr('fill', getBarFillOrThreshold)
            .attr('rx', 2)
            .attr('ry', 2)
            .call((sel) =>
              sel.transition(barTransition).attr('y', getBarY).attr('height', getBarHeight)
            ),
        (update) =>
          update
            .attr('class', barClass)
            .attr('fill', getBarFillOrThreshold)
            .call((sel) =>
              sel.transition(barTransition).attr('y', getBarY).attr('height', getBarHeight)
            ),
        (exit) => exit.remove()
      )

    // Expected stat line (e.g. xG when viewing Goals): draw before bar labels so labels stay on top
    if (expectedKey && getExpectedVal) {
      g.selectAll('.player-gw-chart-expected-dot').remove()
      const expectedData = filteredData.filter((d) => {
        const v = getExpectedVal(d)
        return v != null && !Number.isNaN(v) && Number.isFinite(v)
      })
      if (expectedData.length >= 2) {
        const lineGen = d3
          .line()
          .x((d) => xScale(String(d.gameweek)) + xScale.bandwidth() / 2)
          .y((d) => yScale(getExpectedVal(d)))
          .curve(d3.curveMonotoneX)
        g.selectAll('.player-gw-chart-expected-line')
          .data([expectedData])
          .join('path')
          .attr('class', 'player-gw-chart-expected-line')
          .attr('d', lineGen)
          .attr('fill', 'none')
      } else {
        g.selectAll('.player-gw-chart-expected-line').remove()
      }
    }

    // Bar value labels: pill (bar-width) + text; theme-aware background. Gap between pill and bar top. Drawn last so always on top.
    const barLabelFontSize = filter === 'last6' ? 11 : filter === 'last12' ? 10 : 9 // GW20+ uses 9
    const pillHeight = barLabelFontSize + 8
    const barLabelGap = 6
    const pillRx = 4
    const labelData = filteredData.filter((d) => getVal(d) !== 0)
    const bandWidth = xScale.bandwidth()
    g.selectAll('.player-gw-chart-bar-label-wrap')
      .data(labelData, (d) => d.gameweek)
      .join(
        (enter) => {
          const group = enter.append('g').attr('class', 'player-gw-chart-bar-label-wrap').attr('opacity', 0)
          group.each(function (d) {
            const el = d3.select(this)
            const centerX = xScale(String(d.gameweek)) + bandWidth / 2
            const labelY = getLabelY(d, pillHeight, barLabelGap)
            const textStr = formatStatLabel(getVal(d), statKey)
            const negative = getVal(d) < 0
            el.append('rect')
              .attr('class', 'player-gw-chart-bar-label-pill')
              .attr('x', -bandWidth / 2)
              .attr('y', -pillHeight / 2)
              .attr('width', bandWidth)
              .attr('height', pillHeight)
              .attr('rx', pillRx)
              .attr('ry', pillRx)
            el.append('text')
              .attr('class', `player-gw-chart-bar-label ${negative ? 'player-gw-chart-bar-label--negative' : ''}`)
              .attr('x', 0)
              .attr('y', 0)
              .attr('text-anchor', 'middle')
              .attr('dominant-baseline', 'middle')
              .attr('font-size', barLabelFontSize)
              .attr('font-weight', 600)
              .attr('fill', negative ? 'var(--accent-red, #dc2626)' : 'var(--text-primary)')
              .text(textStr)
            el.attr('transform', `translate(${centerX}, ${labelY})`)
          })
          group.transition(barTransition).attr('opacity', 1)
        },
        (update) =>
          update.each(function (d) {
            const el = d3.select(this)
            const centerX = xScale(String(d.gameweek)) + bandWidth / 2
            const labelY = getLabelY(d, pillHeight, barLabelGap)
            const textStr = formatStatLabel(getVal(d), statKey)
            const negative = getVal(d) < 0
            el.select('.player-gw-chart-bar-label-pill')
              .attr('x', -bandWidth / 2)
              .attr('y', -pillHeight / 2)
              .attr('width', bandWidth)
              .attr('height', pillHeight)
              .attr('rx', pillRx)
              .attr('ry', pillRx)
            const text = el.select('.player-gw-chart-bar-label')
            text
              .attr('class', `player-gw-chart-bar-label ${negative ? 'player-gw-chart-bar-label--negative' : ''}`)
              .attr('font-size', barLabelFontSize)
              .attr('fill', negative ? 'var(--accent-red, #dc2626)' : 'var(--text-primary)')
              .text(textStr)
            el.transition(barTransition).attr('transform', `translate(${centerX}, ${labelY})`)
          }),
        (exit) => exit.remove()
      )

    // DNP indicator: red circle with "!" (match GW points bento) + "DNP" text, no pill background
    const dnpData = filteredData.filter(isDnp)
    const dnpLabelY = baselineY - DNP_LABEL_OFFSET_Y
    g.selectAll('.player-gw-chart-dnp-wrap')
      .data(dnpData, (d) => d.gameweek)
      .join(
        (enter) => {
          const wrap = enter.append('g').attr('class', 'player-gw-chart-dnp-wrap').attr('opacity', 0)
          wrap.each(function (d) {
            const el = d3.select(this)
            const centerX = xScale(String(d.gameweek)) + bandWidth / 2
            el.attr('transform', `translate(${centerX}, ${dnpLabelY})`)
            el.append('circle')
              .attr('class', 'player-gw-chart-dnp-icon')
              .attr('r', DNP_ICON_R)
              .attr('cx', -DNP_ICON_R - 4)
              .attr('cy', 0)
              .attr('fill', 'var(--impact-negative, var(--accent-red, #dc2626))')
            el.append('text')
              .attr('class', 'player-gw-chart-dnp-icon-text')
              .attr('x', -DNP_ICON_R - 4)
              .attr('y', 0)
              .attr('text-anchor', 'middle')
              .attr('dominant-baseline', 'middle')
              .attr('font-size', 7)
              .attr('font-weight', 700)
              .attr('fill', '#fff')
              .text('!')
            el.append('text')
              .attr('class', 'player-gw-chart-dnp-label')
              .attr('x', 4)
              .attr('y', 0)
              .attr('text-anchor', 'start')
              .attr('dominant-baseline', 'middle')
              .attr('font-size', barLabelFontSize)
              .attr('font-weight', 600)
              .attr('fill', 'var(--text-secondary, #64748b)')
              .text('DNP')
          })
          wrap.transition(barTransition).attr('opacity', 1)
        },
        (update) =>
          update.each(function (d) {
            const el = d3.select(this)
            const centerX = xScale(String(d.gameweek)) + bandWidth / 2
            el.attr('transform', `translate(${centerX}, ${dnpLabelY})`)
            el.select('.player-gw-chart-dnp-label').attr('font-size', barLabelFontSize)
          }),
        (exit) => exit.remove()
      )

  }, [filteredData, dimensions, loading, statKey, position, filter])

  if (loading) {
    return (
      <div className="player-gw-chart-container player-gw-chart-container--loading">
        <div className="player-gw-chart-skeleton" />
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <div className="player-gw-chart-container player-gw-chart-container--empty">
        <span className="player-gw-chart-empty">No gameweek data</span>
      </div>
    )
  }

  return (
    <div className="player-gw-chart-wrapper">
      <div ref={containerRef} className="player-gw-chart-container">
        <svg
          ref={svgRef}
          width={dimensions.width}
          height={dimensions.height}
          viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
          preserveAspectRatio="xMidYMid meet"
          className="player-gw-chart-svg"
          aria-label={`${(statKey || 'points').replace(/_/g, ' ')} by gameweek`}
        />
      </div>
      {!isControlled && (
        <div className="player-gw-chart-filter-controls">
          {CHART_RANGE_FILTERS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={`player-gw-chart-filter-btn ${filter === key ? 'active' : ''}`}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
