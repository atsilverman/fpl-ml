import { useEffect, useMemo, useRef, useState } from 'react'
import * as d3 from 'd3'
import { useBpsSnapshots } from '../hooks/useBpsSnapshots'
import './BpsOverTimeChart.css'

/** Stroke color by bonus – only top 3 (3/2/1) get color; rest muted. */
const BONUS_COLORS = {
  3: 'var(--bonus-1st)',
  2: 'var(--bonus-2nd)',
  1: 'var(--bonus-3rd)',
}
const DEMOTED_LINE_COLOR = 'rgba(148, 163, 184, 0.35)'

const CHART_HEIGHT = 340

/** Format time for axis/tooltip. */
function formatRecordedAt(isoString) {
  if (!isoString) return '—'
  const d = new Date(isoString)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true })
}

/** Elapsed minutes from kickoff for a given timestamp (capped 0–90). */
function minuteFromKickoff(kickoffIso, recordedIso) {
  if (!kickoffIso || !recordedIso) return 0
  const k = new Date(kickoffIso.replace('Z', '+00:00')).getTime()
  const r = new Date(recordedIso.replace('Z', '+00:00')).getTime()
  if (Number.isNaN(k) || Number.isNaN(r)) return 0
  const mins = (r - k) / 60000
  return Math.max(0, Math.min(90, Math.round(mins)))
}

/**
 * D3.js BPS over time chart (one line per player), colorized by bonus.
 * Data from bps_snapshots. X-axis is match minute (0'–current max), extending as data arrives.
 */
export default function BpsOverTimeChart({ fixtureId, gameweek, players = [], enabled = true, kickoffTime = null, fixtureStatus = null }) {
  const { data: snapshots, loading } = useBpsSnapshots(fixtureId, gameweek, enabled, fixtureStatus === 'live')
  const svgRef = useRef(null)
  const containerRef = useRef(null)
  const [dimensions, setDimensions] = useState(null)
  const [liveTick, setLiveTick] = useState(0)
  const isLive = fixtureStatus === 'live'

  // When live, re-render periodically so x-axis can extend to current match minute
  useEffect(() => {
    if (!isLive || !kickoffTime) return
    const interval = setInterval(() => setLiveTick((n) => n + 1), 30000)
    return () => clearInterval(interval)
  }, [isLive, kickoffTime])

  const { chartData, seriesByPlayer, playerKeys, playerNamesByKey, strokeByKey, strokeWidthByKey, isBonusByKey, bonusValueByKey, maxMinute, minBps, maxBps } = useMemo(() => {
    if (!snapshots?.length) {
      return {
        chartData: [],
        seriesByPlayer: {},
        playerKeys: [],
        playerNamesByKey: {},
        strokeByKey: {},
        strokeWidthByKey: {},
        isBonusByKey: {},
        bonusValueByKey: {},
        maxMinute: 0,
        minBps: 0,
        maxBps: 0,
      }
    }
    const playerById = Object.fromEntries((players ?? []).map((p) => [p.player_id, p]))
    const bonusByPid = {}
    ;(players ?? []).forEach((p, idx) => {
      const pid = p?.player_id
      if (pid == null) return
      const confirmed = p?.bonus ?? 0
      bonusByPid[pid] = (confirmed >= 1 && confirmed <= 3) ? confirmed : (idx < 3 ? (3 - idx) : 0)
    })
    const playerKeys = [...new Set(snapshots.map((r) => Number(r.player_id)))]
    const playerNamesByKey = {}
    const strokeByKey = {}
    const strokeWidthByKey = {}
    const isBonusByKey = {}
    const bonusValueByKey = {}
    playerKeys.forEach((pid) => {
      const p = playerById[pid]
      playerNamesByKey[pid] = p?.player_name ?? `Player ${pid}`
      const bonus = bonusByPid[pid] ?? 0
      const isBonus = bonus >= 1 && bonus <= 3
      isBonusByKey[pid] = isBonus
      if (isBonus) bonusValueByKey[pid] = bonus
      strokeByKey[pid] = isBonus ? (BONUS_COLORS[bonus] ?? DEMOTED_LINE_COLOR) : DEMOTED_LINE_COLOR
      strokeWidthByKey[pid] = isBonus ? 2.5 : 1
    })

    const times = [...new Set(snapshots.map((r) => r.recorded_at))].sort()
    const firstRecordedAt = times[0] ? new Date(times[0]).getTime() : 0
    const chartData = times.map((t) => {
      const minute = kickoffTime
        ? minuteFromKickoff(kickoffTime, t)
        : firstRecordedAt ? Math.min(90, Math.round((new Date(t).getTime() - firstRecordedAt) / 60000)) : 0
      const point = { time: t, recorded_at: t, minute }
      snapshots.filter((r) => r.recorded_at === t).forEach((r) => { point[Number(r.player_id)] = r.bps })
      return point
    })
    const lastDataMinute = chartData.length ? Math.max(...chartData.map((d) => d.minute)) : 0
    const elapsedMinute = (kickoffTime && isLive) ? minuteFromKickoff(kickoffTime, new Date().toISOString()) : lastDataMinute
    const maxMinute = Math.min(90, Math.max(lastDataMinute, elapsedMinute, 1))

    const seriesByPlayer = {}
    playerKeys.forEach((pid) => {
      const points = chartData.map((d) => ({ minute: d.minute, time: d.time, bps: d[pid] ?? null }))
      const hasAnyBps = points.some((p) => p.bps != null)
      seriesByPlayer[pid] = hasAnyBps ? [{ minute: 0, time: null, bps: 0 }, ...points] : points
    })
    const allBps = snapshots.map((r) => r.bps).filter((n) => n != null)
    const minBps = allBps.length ? Math.min(...allBps) : 0
    const maxBps = allBps.length ? Math.max(...allBps) : 0
    return {
      chartData,
      seriesByPlayer,
      playerKeys,
      playerNamesByKey,
      strokeByKey,
      strokeWidthByKey,
      isBonusByKey,
      bonusValueByKey,
      maxMinute,
      minBps,
      maxBps,
    }
  }, [snapshots, players, kickoffTime, isLive, liveTick])

  // Cleanup tooltip on unmount
  useEffect(() => {
    return () => {
      d3.select('.bps-over-time-chart-tooltip').remove()
    }
  }, [])

  // ResizeObserver for responsive chart (run when we have data so container with ref is mounted)
  const hasChartData = chartData.length > 0 && playerKeys.length > 0
  useEffect(() => {
    if (!hasChartData || !containerRef.current) return
    let resizeTimeout
    const currentDimensionsRef = { width: 0, height: 0 }
    const updateDimensions = () => {
      if (!containerRef.current) return
      const w = Math.max(280, containerRef.current.clientWidth || 400)
      const h = CHART_HEIGHT
      if (Math.abs(currentDimensionsRef.width - w) < 1) return
      currentDimensionsRef.width = w
      currentDimensionsRef.height = h
      setDimensions({ width: w, height: h })
    }
    updateDimensions()
    const ro = new ResizeObserver(() => {
      clearTimeout(resizeTimeout)
      resizeTimeout = setTimeout(updateDimensions, 150)
    })
    ro.observe(containerRef.current)
    return () => {
      clearTimeout(resizeTimeout)
      ro.disconnect()
    }
  }, [hasChartData])

  // Draw chart with D3 (x-axis: match minute 0 to maxMinute, extending as data arrives)
  useEffect(() => {
    if (!dimensions || !svgRef.current || !chartData.length || maxMinute <= 0) return

    const svg = d3.select(svgRef.current)
    const width = dimensions.width
    const height = dimensions.height
    const padding = { top: 12, right: 12, bottom: 28, left: 36 }
    const chartWidth = width - padding.left - padding.right
    const chartHeight = height - padding.top - padding.bottom

    const xScale = d3.scaleLinear()
      .domain([0, maxMinute])
      .range([padding.left, width - padding.right])

    const range = Math.max(maxBps - minBps, 1)
    const paddingAmount = range * 0.08
    const yMin = minBps - paddingAmount
    const yMax = maxBps + paddingAmount
    const yScale = d3.scaleLinear()
      .domain([yMin, yMax])
      .range([height - padding.bottom, padding.top])

    const line = d3.line()
      .x((d) => xScale(d.minute))
      .y((d) => yScale(d.bps))
      .defined((d) => d.bps != null)
      .curve(d3.curveMonotoneX)

    const g = svg.selectAll('.bps-chart-group').data([1])
    const gEnter = g.enter().append('g').attr('class', 'bps-chart-group')
    const gMerge = gEnter.merge(g)

    // Grid
    const yTicks = yScale.ticks(5)
    gMerge.selectAll('.bps-chart-grid-line')
      .data(yTicks)
      .join('line')
      .attr('class', 'bps-chart-grid-line')
      .attr('x1', padding.left)
      .attr('x2', width - padding.right)
      .attr('y1', (d) => yScale(d))
      .attr('y2', (d) => yScale(d))
      .attr('stroke', 'var(--border-color)')
      .attr('stroke-dasharray', '3 3')
      .attr('stroke-opacity', 0.6)

    // Axis lines (single element each)
    let xAxisLine = gMerge.select('.bps-chart-x-axis')
    if (xAxisLine.empty()) {
      xAxisLine = gMerge.append('line').attr('class', 'bps-chart-x-axis')
    }
    xAxisLine
      .attr('x1', padding.left)
      .attr('y1', height - padding.bottom)
      .attr('x2', width - padding.right)
      .attr('y2', height - padding.bottom)
      .attr('stroke', 'var(--border-color)')
      .attr('stroke-width', 1)
    let yAxisLine = gMerge.select('.bps-chart-y-axis')
    if (yAxisLine.empty()) {
      yAxisLine = gMerge.append('line').attr('class', 'bps-chart-y-axis')
    }
    yAxisLine
      .attr('x1', padding.left)
      .attr('y1', padding.top)
      .attr('x2', padding.left)
      .attr('y2', height - padding.bottom)
      .attr('stroke', 'var(--border-color)')
      .attr('stroke-width', 1)

    // X axis labels: 0', 15', 30', ... up to maxMinute (match minute, not full 90' upfront)
    const xTicks = []
    for (let m = 0; m < maxMinute; m += 15) xTicks.push(m)
    xTicks.push(maxMinute)
    gMerge.selectAll('.bps-chart-x-label')
      .data(xTicks)
      .join('text')
      .attr('class', 'bps-chart-x-label')
      .attr('x', (m) => xScale(m))
      .attr('y', height - padding.bottom + 14)
      .attr('text-anchor', 'middle')
      .attr('font-size', 10)
      .attr('fill', 'var(--text-secondary)')
      .text((m) => `${m}'`)

    // Y axis labels
    gMerge.selectAll('.bps-chart-y-label')
      .data(yTicks)
      .join('text')
      .attr('class', 'bps-chart-y-label')
      .attr('x', padding.left - 8)
      .attr('y', (d) => yScale(d) + 4)
      .attr('text-anchor', 'end')
      .attr('font-size', 10)
      .attr('fill', 'var(--text-secondary)')
      .text((d) => d)

    // Lines (animate in on load: draw from left to right)
    const linePaths = gMerge.selectAll('.bps-chart-line')
      .data(playerKeys, (d) => d)

    const lineEnter = linePaths.enter()
      .append('path')
      .attr('class', 'bps-chart-line')
      .attr('fill', 'none')
      .attr('stroke', (pid) => strokeByKey[pid])
      .attr('stroke-width', (pid) => strokeWidthByKey[pid] ?? 1)
      .attr('stroke-linecap', 'round')
      .attr('stroke-linejoin', 'round')
      .attr('d', (pid) => line(seriesByPlayer[pid]))

    lineEnter.each(function () {
      const node = this
      const len = node.getTotalLength()
      d3.select(node).attr('stroke-dasharray', len).attr('stroke-dashoffset', len)
    })
    lineEnter
      .transition()
      .duration(1400)
      .ease(d3.easeCubicOut)
      .attr('stroke-dashoffset', 0)

    linePaths
      .attr('stroke-dasharray', null)
      .attr('stroke-dashoffset', null)
    linePaths.merge(lineEnter)
      .attr('stroke', (pid) => strokeByKey[pid])
      .attr('stroke-width', (pid) => strokeWidthByKey[pid] ?? 1)
      .attr('d', (pid) => line(seriesByPlayer[pid]))

    linePaths.exit().remove()

    // Bonus player dots at last point
    const lastPointByPlayer = {}
    playerKeys.forEach((pid) => {
      const series = seriesByPlayer[pid] ?? []
      const defined = series.filter((d) => d.bps != null)
      if (defined.length && isBonusByKey[pid]) {
        const last = defined[defined.length - 1]
        lastPointByPlayer[pid] = { ...last, pid }
      }
    })
    const lastPoints = Object.values(lastPointByPlayer)
    const dots = gMerge.selectAll('.bps-chart-dot')
      .data(lastPoints, (d) => d.pid)

    dots.enter()
      .append('circle')
      .attr('class', 'bps-chart-dot')
      .attr('cx', (d) => xScale(d.minute))
      .attr('cy', (d) => yScale(d.bps))
      .attr('r', 2)
      .attr('fill', (d) => strokeByKey[d.pid])
      .attr('stroke', 'var(--bg-card)')
      .attr('stroke-width', 1)
      .merge(dots)
      .attr('cx', (d) => xScale(d.minute))
      .attr('cy', (d) => yScale(d.bps))

    dots.exit().remove()

    // Invisible overlay for tooltip (snap to nearest time)
    gMerge.selectAll('.bps-chart-overlay').remove()
    const overlay = gMerge.append('rect')
      .attr('class', 'bps-chart-overlay')
      .attr('x', padding.left)
      .attr('y', padding.top)
      .attr('width', chartWidth)
      .attr('height', chartHeight)
      .attr('fill', 'transparent')
      .attr('pointer-events', 'all')

    let tooltip = d3.select('.bps-over-time-chart-tooltip')
    if (tooltip.empty()) {
      tooltip = d3.select('body').append('div')
        .attr('class', 'bps-over-time-chart-tooltip')
        .style('position', 'absolute')
        .style('pointer-events', 'none')
        .style('opacity', 0)
        .style('z-index', 1000)
        .style('background', 'var(--bg-card)')
        .style('border', '1px solid var(--border-color)')
        .style('border-radius', '8px')
        .style('font-size', '11px')
        .style('padding', '8px 10px')
    }

    const getClosestPoint = (x) => {
      const minute = xScale.invert(x)
      const idx = d3.bisectCenter(chartData.map((d) => d.minute), minute)
      const i = Math.max(0, Math.min(idx, chartData.length - 1))
      return chartData[i]
    }

    overlay
      .on('mouseover', () => tooltip.transition().duration(150).style('opacity', 1))
      .on('mousemove', function (event) {
        const [x] = d3.pointer(event, svgRef.current)
        if (x < padding.left || x > width - padding.right) return
        const point = getClosestPoint(x)
        const bonusEntries = playerKeys
          .filter((pid) => isBonusByKey[pid] && point[pid] != null)
          .map((pid) => ({ pid, name: playerNamesByKey[pid] ?? pid, value: point[pid], color: strokeByKey[pid] }))
        if (!bonusEntries.length) {
          tooltip.style('opacity', 0)
          return
        }
        tooltip
          .style('display', 'block')
          .html(`
            <div style="margin-bottom:4px;color:var(--text-secondary)">${point.minute}' ${formatRecordedAt(point.time)}</div>
            ${bonusEntries.map((e) => `<div style="color:${e.color}">${e.name}: ${e.value ?? '—'}</div>`).join('')}
          `)
        const node = tooltip.node()
        if (node) {
          const rect = node.getBoundingClientRect()
          const pad = 10
          let left = event.pageX + pad
          let top = event.pageY - pad
          if (left + rect.width + pad > window.innerWidth) left = event.pageX - rect.width - pad
          if (top + rect.height + pad > window.innerHeight) top = event.pageY - rect.height - pad
          if (top < pad) top = pad
          tooltip.style('left', `${left}px`).style('top', `${top}px`)
        }
      })
      .on('mouseleave', () => tooltip.transition().duration(200).style('opacity', 0))
  }, [dimensions, chartData, seriesByPlayer, playerKeys, playerNamesByKey, strokeByKey, strokeWidthByKey, isBonusByKey, maxMinute, minBps, maxBps])

  if (loading) {
    return (
      <div className="bps-over-time-chart bps-over-time-chart--loading">
        <div className="bps-over-time-chart__skeleton" />
      </div>
    )
  }

  if (!chartData.length || !playerKeys.length) {
    return (
      <div className="bps-over-time-chart bps-over-time-chart--empty">
        <p className="bps-over-time-chart__empty-message">
          No BPS history for this fixture. It’s recorded during live matches when the backend is running.
        </p>
      </div>
    )
  }

  return (
    <div className="bps-over-time-chart" ref={containerRef} style={{ height: CHART_HEIGHT }}>
      <svg
        ref={svgRef}
        width={dimensions?.width ?? '100%'}
        height={CHART_HEIGHT}
        className="bps-over-time-chart__svg"
      />
      <div className="bps-over-time-chart-legend" aria-hidden>
        {playerKeys.filter((pid) => isBonusByKey[pid]).map((pid) => (
          <div key={pid} className="bps-over-time-chart-legend-item">
            <span
              className="bps-over-time-chart-legend-swatch"
              style={{ background: strokeByKey[pid], height: 3 }}
            />
            <span className="bps-over-time-chart-legend-label">
              {playerNamesByKey[pid] ?? pid}
              {bonusValueByKey[pid] != null ? ` +${bonusValueByKey[pid]}` : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
