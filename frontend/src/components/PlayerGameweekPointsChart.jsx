import { useEffect, useMemo, useRef, useState } from 'react'
import * as d3 from 'd3'
import './PlayerGameweekPointsChart.css'

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'last6', label: 'Last 6' },
  { key: 'last12', label: 'Last 12' },
]

const EXPECTED_STAT_KEYS = ['expected_goals', 'expected_assists', 'expected_goal_involvements', 'expected_goals_conceded']

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

/**
 * D3 bar chart: player stat per gameweek (points, goals, assists, or goal involvements).
 * X-axis = gameweek (oldest left, newest right). Filter: All / Last 6 (default) / Last 12.
 */
export default function PlayerGameweekPointsChart({ data = [], loading = false, statKey = 'points' }) {
  const svgRef = useRef(null)
  const containerRef = useRef(null)
  const [dimensions, setDimensions] = useState({ width: 400, height: 220 })
  const [filter, setFilter] = useState('last6')

  const filteredData = useMemo(() => {
    if (!data || data.length === 0) return []
    if (filter === 'last6' && data.length > 6) return data.slice(-6)
    if (filter === 'last12' && data.length > 12) return data.slice(-12)
    return data
  }, [data, filter])

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

  useEffect(() => {
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
    const maxVal = Math.max(
      1,
      ...filteredData.map(getVal),
      ...(getExpectedVal ? filteredData.map(getExpectedVal) : [0])
    )
    const yMax = Math.ceil(maxVal * 1.1) || 10

    const xScale = d3
      .scaleBand()
      .domain(filteredData.map((d) => String(d.gameweek)))
      .range([padding.left, width - padding.right])
      .padding(0.25)

    const yScale = d3
      .scaleLinear()
      .domain([0, yMax])
      .range([height - padding.bottom, padding.top])

    const g = svg.append('g').attr('class', 'player-gw-chart-group')

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

    const yTicks = yScale.ticks(5)
    yTicks.forEach((tick) => {
      g.append('line')
        .attr('class', 'player-gw-chart-grid-line')
        .attr('x1', padding.left)
        .attr('x2', width - padding.right)
        .attr('y1', yScale(tick))
        .attr('y2', yScale(tick))
        .attr('stroke', 'var(--border-color)')
        .attr('stroke-width', 0.5)
        .attr('opacity', 0.2)
    })

    // Y-axis labels (smaller font)
    const yAxisLabelFormat = (v) =>
      EXPECTED_STAT_KEYS.includes(statKey) ? Number(v).toFixed(2) : String(v)
    g.selectAll('.player-gw-chart-y-label')
      .data(yTicks)
      .join('text')
      .attr('class', 'player-gw-chart-y-label')
      .attr('x', padding.left - 6)
      .attr('y', (d) => yScale(d) + 4)
      .attr('text-anchor', 'end')
      .attr('font-size', 8)
      .attr('fill', 'var(--text-secondary)')
      .text(yAxisLabelFormat)

    // X-axis labels: all gameweeks, smaller font
    filteredData.forEach((d) => {
      const gw = d.gameweek
      const x = xScale(String(gw)) + xScale.bandwidth() / 2
      g.append('text')
        .attr('class', 'player-gw-chart-x-label')
        .attr('x', x)
        .attr('y', height - padding.bottom + 14)
        .attr('text-anchor', 'middle')
        .attr('font-size', 8)
        .attr('fill', 'var(--text-secondary)')
        .text(String(gw))
    })

    const barTransition = d3.transition().duration(350).ease(d3.easeCubicOut)

    // Bars: start from zero height then grow to value (animates when changing stats or filter)
    g.selectAll('.player-gw-chart-bar')
      .data(filteredData, (d) => d.gameweek)
      .join(
        (enter) =>
          enter
            .append('rect')
            .attr('class', 'player-gw-chart-bar')
            .attr('x', (d) => xScale(String(d.gameweek)))
            .attr('y', height - padding.bottom)
            .attr('width', xScale.bandwidth())
            .attr('height', 0)
            .attr('fill', 'var(--accent-green, #10b981)')
            .attr('rx', 2)
            .attr('ry', 2)
            .call((sel) => sel.transition(barTransition).attr('y', (d) => yScale(getVal(d))).attr('height', (d) => Math.max(0, yScale(0) - yScale(getVal(d))))),
        (update) =>
          update
            .call((sel) =>
              sel
                .transition(barTransition)
                .attr('y', (d) => yScale(getVal(d)))
                .attr('height', (d) => Math.max(0, yScale(0) - yScale(getVal(d))))
            ),
        (exit) => exit.remove()
      )

    // Bar value labels: only show for non-zero values
    const labelData = filteredData.filter((d) => getVal(d) !== 0)
    g.selectAll('.player-gw-chart-bar-label')
      .data(labelData, (d) => d.gameweek)
      .join(
        (enter) =>
          enter
            .append('text')
            .attr('class', 'player-gw-chart-bar-label')
            .attr('x', (d) => xScale(String(d.gameweek)) + xScale.bandwidth() / 2)
            .attr('y', height - padding.bottom - 4)
            .attr('text-anchor', 'middle')
            .attr('font-size', 8)
            .attr('font-weight', 600)
            .attr('fill', 'var(--text-primary)')
            .attr('opacity', 0)
            .text((d) => formatStatLabel(getVal(d), statKey))
            .call((sel) => sel.transition(barTransition).attr('y', (d) => yScale(getVal(d)) - 4).attr('opacity', 1)),
        (update) =>
          update.call((sel) =>
            sel
              .transition(barTransition)
              .attr('x', (d) => xScale(String(d.gameweek)) + xScale.bandwidth() / 2)
              .attr('y', (d) => yScale(getVal(d)) - 4)
              .text((d) => formatStatLabel(getVal(d), statKey))
          ),
        (exit) => exit.remove()
      )

    // Expected stat line (e.g. xG when viewing Goals): drawn on top of bars so it’s visible
    if (expectedKey && getExpectedVal) {
      const segmentHeight = 2
      g.selectAll('.player-gw-chart-expected-segment')
        .data(filteredData.filter((d) => getExpectedVal(d) != null && !Number.isNaN(getExpectedVal(d))))
        .join('rect')
        .attr('class', 'player-gw-chart-expected-segment')
        .attr('x', (d) => xScale(String(d.gameweek)))
        .attr('y', (d) => yScale(getExpectedVal(d)) - segmentHeight / 2)
        .attr('width', xScale.bandwidth())
        .attr('height', segmentHeight)
        .attr('fill', '#c62828')
        .attr('rx', 1)
    }
  }, [filteredData, dimensions, loading, statKey])

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
          aria-label="Points by gameweek"
        />
      </div>
      <div className="player-gw-chart-filter-controls">
        {FILTERS.map(({ key, label }) => (
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
    </div>
  )
}
