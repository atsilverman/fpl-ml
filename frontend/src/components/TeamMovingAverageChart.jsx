import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import * as d3 from 'd3'
import './TeamMovingAverageChart.css'

const MA_STAT_OPTIONS = [
  { key: 'goals', label: 'G' },
  { key: 'expected_goals', label: 'xG' },
  { key: 'goals_conceded', label: 'GC' },
  { key: 'expected_goals_conceded', label: 'xGC' },
]

const MA_WINDOW_OPTIONS = [
  { key: 3, label: '3 GW' },
  { key: 10, label: '10 GW' },
]

const CHART_RANGE_FILTERS = [
  { key: 'gw20plus', label: 'GW20+' },
  { key: 'last6', label: 'Last 6' },
  { key: 'last12', label: 'Last 12' },
]

const FOCUSED_LINE_COLOR = 'var(--accent-green, #5a9b7a)'
const DEMOTED_LINE_COLOR = 'rgba(148, 163, 184, 0.35)'

function getStatValue(d, statKey) {
  switch (statKey) {
    case 'goals': return d.goals ?? 0
    case 'expected_goals': return Number(d.xg) ?? 0
    case 'goals_conceded': return d.goals_conceded ?? 0
    case 'expected_goals_conceded': return Number(d.xgc) ?? 0
    default: return 0
  }
}

function computeMovingAverage(series, statKey, windowSize) {
  const getVal = (d) => getStatValue(d, statKey)
  return series.map((d, i) => {
    const start = Math.max(0, i - windowSize + 1)
    const slice = series.slice(start, i + 1)
    const sum = slice.reduce((a, r) => a + getVal(r), 0)
    return { gameweek: d.gameweek, value: slice.length ? sum / slice.length : 0 }
  })
}

export default function TeamMovingAverageChart({
  byTeamId = {},
  teamShortNameById = {},
  focusedTeamDisplayName = null,
  focusedTeamBadgeShortName = null,
  focusedTeamId,
  rank1TeamIds = null,
  statKey = 'expected_goals',
  windowSize = 3,
  filter = 'gw20plus',
  filterPopupOpen = false,
  onFilterPopupOpenChange,
  onFilterChange,
  onStatChange,
  onWindowChange,
  loading = false,
}) {
  const svgRef = useRef(null)
  const containerRef = useRef(null)
  const [dimensions, setDimensions] = useState({ width: 400, height: 260 })

  const seriesData = useMemo(() => {
    const teamIds = Object.keys(byTeamId).map(Number)
    if (teamIds.length === 0) return []

    return teamIds.map((tid) => {
      const raw = byTeamId[tid] || []
      const ma = computeMovingAverage(raw, statKey, windowSize)
      let data = ma
      if (filter === 'last6') data = ma.slice(-6)
      else if (filter === 'last12') data = ma.slice(-12)
      else if (filter === 'gw20plus') data = ma.filter((d) => (d.gameweek ?? 0) >= 20)

      return {
        teamId: tid,
        shortName: teamShortNameById[tid] ?? String(tid),
        data,
      }
    }).filter((s) => s.data.length >= 1)
  }, [byTeamId, teamShortNameById, statKey, windowSize, filter])

  const statLabel = MA_STAT_OPTIONS.find((o) => o.key === statKey)?.label ?? statKey

  useEffect(() => {
    if (!containerRef.current) return
    let resizeTimeout
    const update = () => {
      if (!containerRef.current) return
      const el = containerRef.current
      const w = Math.max(200, el.clientWidth || 400)
      const h = Math.max(180, el.clientHeight || 260)
      setDimensions((prev) => {
        if (Math.abs(prev.width - w) < 2 && Math.abs(prev.height - h) < 2) return prev
        return { width: w, height: h }
      })
    }
    update()
    const ro = new ResizeObserver(() => {
      clearTimeout(resizeTimeout)
      resizeTimeout = setTimeout(update, 100)
    })
    ro.observe(containerRef.current)
    return () => {
      clearTimeout(resizeTimeout)
      ro.disconnect()
    }
  }, [])

  useLayoutEffect(() => {
    if (!svgRef.current || seriesData.length === 0 || loading) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const width = dimensions.width
    const height = dimensions.height
    const padding = { top: 16, right: 24, bottom: 28, left: 36 }
    const chartWidth = width - padding.left - padding.right
    const chartHeight = height - padding.top - padding.bottom

    const allValues = seriesData.flatMap((s) => s.data.map((d) => d.value))
    const minVal = Math.min(0, ...allValues)
    const maxVal = Math.max(0.01, ...allValues)
    const paddingVal = (maxVal - minVal) * 0.08 || 0.1
    const yMin = Math.min(minVal - paddingVal, 0)
    const yMax = maxVal + paddingVal

    const minGW = Math.min(...seriesData.flatMap((s) => s.data.map((d) => d.gameweek)))
    const maxGW = Math.max(...seriesData.flatMap((s) => s.data.map((d) => d.gameweek)))

    const xScale = d3.scaleLinear()
      .domain([minGW, maxGW])
      .range([padding.left, width - padding.right])

    const yScale = d3.scaleLinear()
      .domain([yMin, yMax])
      .range([height - padding.bottom, padding.top])

    const line = d3.line()
      .x((d) => xScale(d.gameweek))
      .y((d) => yScale(d.value))
      .curve(d3.curveMonotoneX)

    const g = svg.append('g').attr('class', 'team-ma-chart-group')

    // Grid
    const yTicks = yScale.ticks(5)
    yTicks.forEach((tick) => {
      g.append('line')
        .attr('class', 'team-ma-chart-grid')
        .attr('x1', padding.left)
        .attr('x2', width - padding.right)
        .attr('y1', yScale(tick))
        .attr('y2', yScale(tick))
    })

    // Sort: others first, rank1 teams next, selected last (z-order top)
    const numericFocused = focusedTeamId != null ? Number(focusedTeamId) : null
    const rank1Set = rank1TeamIds instanceof Set ? rank1TeamIds : new Set()
    const sortKey = (s) => {
      if (numericFocused != null && s.teamId === numericFocused) return 2
      if (rank1Set.has(s.teamId)) return 1
      return 0
    }
    const sorted = [...seriesData].sort((a, b) => sortKey(a) - sortKey(b))

    const isFocused = (teamId) => numericFocused != null && teamId === numericFocused

    // Demoted and promoted lines
    const focusedSeries = sorted.find((s) => isFocused(s.teamId))
    sorted.forEach((series) => {
      const focused = isFocused(series.teamId)
      g.append('path')
        .attr('class', `team-ma-chart-line ${focused ? 'team-ma-chart-line--focused' : 'team-ma-chart-line--demoted'}`)
        .attr('d', line(series.data))
        .attr('fill', 'none')
        .attr('stroke', focused ? FOCUSED_LINE_COLOR : DEMOTED_LINE_COLOR)
        .attr('stroke-width', focused ? 2.5 : 1)
        .attr('stroke-linecap', 'round')
        .attr('stroke-linejoin', 'round')
        .attr('data-team-id', series.teamId)
    })

    const badgeSize = 14
    // Badge at end of focused line
    if (focusedSeries?.data?.length && focusedTeamBadgeShortName) {
      const lastPoint = focusedSeries.data[focusedSeries.data.length - 1]
      const x = xScale(lastPoint.gameweek)
      const y = yScale(lastPoint.value)
      g.append('image')
        .attr('class', 'team-ma-chart-line-badge team-ma-chart-line-badge--focused')
        .attr('href', `/badges/${focusedTeamBadgeShortName}.svg`)
        .attr('x', x - badgeSize / 2)
        .attr('y', y - badgeSize / 2)
        .attr('width', badgeSize)
        .attr('height', badgeSize)
        .attr('preserveAspectRatio', 'xMidYMid meet')
    }

    // Y-axis
    g.append('line')
      .attr('class', 'team-ma-chart-axis')
      .attr('x1', padding.left)
      .attr('y1', padding.top)
      .attr('x2', padding.left)
      .attr('y2', height - padding.bottom)

    // X-axis
    g.append('line')
      .attr('class', 'team-ma-chart-axis')
      .attr('x1', padding.left)
      .attr('y1', height - padding.bottom)
      .attr('x2', width - padding.right)
      .attr('y2', height - padding.bottom)

    // Y labels
    const yFormat = ['expected_goals', 'expected_goals_conceded'].includes(statKey)
      ? (v) => Number(v).toFixed(1)
      : (v) => String(Math.round(v))
    g.selectAll('.team-ma-chart-y-label')
      .data(yTicks)
      .join('text')
      .attr('class', 'team-ma-chart-y-label')
      .attr('x', padding.left - 6)
      .attr('y', (d) => yScale(d) + 4)
      .attr('text-anchor', 'end')
      .attr('font-size', 10)
      .attr('fill', 'var(--text-secondary)')
      .text(yFormat)

    // X labels (gameweeks)
    const xStep = maxGW - minGW <= 8 ? 1 : Math.ceil((maxGW - minGW) / 5)
    const xTicks = []
    for (let gw = minGW; gw <= maxGW; gw += xStep) xTicks.push(gw)
    if (xTicks[xTicks.length - 1] !== maxGW) xTicks.push(maxGW)

    g.selectAll('.team-ma-chart-x-label')
      .data(xTicks)
      .join('text')
      .attr('class', 'team-ma-chart-x-label')
      .attr('x', (d) => xScale(d))
      .attr('y', height - padding.bottom + 14)
      .attr('text-anchor', 'middle')
      .attr('font-size', 10)
      .attr('fill', 'var(--text-secondary)')
      .text((d) => d)

  }, [seriesData, dimensions, loading, statKey, windowSize, filter, focusedTeamId, focusedTeamBadgeShortName, rank1TeamIds])

  if (loading) {
    return (
      <div className="team-ma-chart-container team-ma-chart-container--loading">
        <div className="team-ma-chart-skeleton" />
      </div>
    )
  }

  if (seriesData.length === 0) {
    return (
      <div className="team-ma-chart-container team-ma-chart-container--empty">
        <span className="team-ma-chart-empty">No data</span>
      </div>
    )
  }

  const legendFocusedLabel = focusedTeamDisplayName ?? teamShortNameById[focusedTeamId] ?? 'This team'

  return (
    <div className="team-ma-chart-wrapper">
      <div ref={containerRef} className="team-ma-chart-container">
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
          preserveAspectRatio="xMidYMid meet"
          className="team-ma-chart-svg"
          aria-label={`${statLabel} ${windowSize}-gameweek moving average by team`}
        />
      </div>
      <div className="team-ma-chart-legend">
        <span className="team-ma-chart-legend-line team-ma-chart-legend-line--focused" />
        {focusedTeamBadgeShortName && (
          <img
            src={`/badges/${focusedTeamBadgeShortName}.svg`}
            alt=""
            className="team-ma-chart-legend-badge"
            onError={(e) => { e.target.style.display = 'none' }}
          />
        )}
        <span className="team-ma-chart-legend-label">{legendFocusedLabel}</span>
        <span className="team-ma-chart-legend-line team-ma-chart-legend-line--demoted" />
        <span className="team-ma-chart-legend-label">Others</span>
      </div>
      {filterPopupOpen && typeof document !== 'undefined' && createPortal(
        <div className="player-detail-filter-popup-layer" style={{ position: 'fixed', inset: 0, zIndex: 1200, pointerEvents: 'auto' }}>
          <div className="player-detail-filter-backdrop" style={{ position: 'absolute', inset: 0, pointerEvents: 'auto' }} onClick={() => onFilterPopupOpenChange?.(false)} aria-hidden />
          <div className="player-detail-filter-popup-portal" style={{ position: 'fixed', inset: 0, zIndex: 1, pointerEvents: 'auto' }} onClick={() => onFilterPopupOpenChange?.(false)}>
            <div className="player-detail-stat-popup stats-filter-overlay-panel" role="dialog" aria-label="Filters" style={{ pointerEvents: 'auto' }} onClick={(e) => e.stopPropagation()}>
              <div className="stats-filter-overlay-header">
                <span className="stats-filter-overlay-title">Filters</span>
                <div className="stats-filter-overlay-header-actions">
                  <button type="button" className="stats-filter-overlay-close" onClick={() => onFilterPopupOpenChange?.(false)} aria-label="Close">
                    <X size={20} strokeWidth={2} />
                  </button>
                </div>
              </div>
              <div className="stats-filter-overlay-body">
                <div className="stats-filter-section">
                  <div className="stats-filter-section-title">Stat</div>
                  <div className="stats-filter-buttons">
                    {MA_STAT_OPTIONS.map(({ key, label }) => (
                      <button key={key} type="button" className={`stats-filter-option-btn ${statKey === key ? 'stats-filter-option-btn--active' : ''}`} onClick={() => { onStatChange?.(key); onFilterPopupOpenChange?.(false) }} aria-pressed={statKey === key}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="stats-filter-section">
                  <div className="stats-filter-section-title">Moving average</div>
                  <div className="stats-filter-buttons">
                    {MA_WINDOW_OPTIONS.map(({ key, label }) => (
                      <button key={key} type="button" className={`stats-filter-option-btn ${windowSize === key ? 'stats-filter-option-btn--active' : ''}`} onClick={() => { onWindowChange?.(key); onFilterPopupOpenChange?.(false) }} aria-pressed={windowSize === key}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="stats-filter-section">
                  <div className="stats-filter-section-title">Range</div>
                  <div className="stats-filter-buttons">
                    {CHART_RANGE_FILTERS.map(({ key, label }) => (
                      <button key={key} type="button" className={`stats-filter-option-btn ${filter === key ? 'stats-filter-option-btn--active' : ''}`} onClick={() => { onFilterChange?.(key); onFilterPopupOpenChange?.(false) }} aria-pressed={filter === key}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="stats-filter-overlay-footer">
                <button type="button" className="stats-filter-overlay-done" onClick={() => onFilterPopupOpenChange?.(false)} aria-label="Done">Done</button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
