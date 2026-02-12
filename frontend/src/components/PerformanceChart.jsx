import { useEffect, useMemo, useRef, useState } from 'react'
import * as d3 from 'd3'
import { Users } from 'lucide-react'
import { formatNumber } from '../utils/formatNumbers'
import { useToast } from '../contexts/ToastContext'
import './PerformanceChart.css'

/** Same subtle color for top-10 lines (except league leader) */
const TOP10_MUTED_COLOR = 'rgba(148, 163, 184, 0.45)' // slate, subtle
/** League leader line – same visual weight as configured manager, different color */
const TOP10_LEADER_COLOR = 'rgba(245, 158, 11, 0.9)'  // amber

/**
 * D3.js Performance Chart Component
 * Displays manager's overall rank over time with chip markers
 * Fully responsive - adapts to container size using ResizeObserver
 */
export default function PerformanceChart({ 
  data = [], 
  comparisonData = null,
  filter = 'all', // 'all', 'last12', 'last6'
  showComparison = false,
  lineColor = 'var(--accent-green)',
  loading = false,
  onFilterChange = null,
  showTop10Lines = false,
  top10LinesData = null,
  onShowTop10Change = null,
  currentManagerId = null
}) {
  const { toast } = useToast()
  const svgRef = useRef(null)
  const containerRef = useRef(null)
  const [dimensions, setDimensions] = useState(null)
  const [isMobile, setIsMobile] = useState(false)
  const [measurementReady, setMeasurementReady] = useState(false)
  const prevDimensionsRef = useRef({ width: 0, height: 0 })
  
  // Chip display configuration
  const chipInfo = {
    '3xc': { name: 'TC', color: '#f97316' }, // Orange
    'freehit': { name: 'FH', color: '#3b82f6' }, // Blue
    'wildcard': { name: 'WC', color: '#8b5cf6' }, // Purple
    'bboost': { name: 'BB', color: '#06b6d4' } // Cyan
  }

  // Helper function to get chip display name with season half indicator
  const getChipDisplayName = (chip, gameweek) => {
    if (!chip || !chipInfo[chip]) return chipInfo[chip]?.name || chip
    
    // For wildcards, show WC1 (first half, GW 1-19) or WC2 (second half, GW 20+)
    if (chip === 'wildcard') {
      return gameweek <= 19 ? 'WC1' : 'WC2'
    }
    
    return chipInfo[chip].name
  }

  // Format number with K/M abbreviations, whole numbers only
  const formatWholeNumber = (num) => {
    const rounded = Math.round(num)
    if (rounded >= 1000000) {
      return `${Math.round(rounded / 1000000)}M`
    }
    if (rounded >= 1000) {
      return `${Math.round(rounded / 1000)}K`
    }
    return rounded.toString()
  }

  // Detect mobile viewport
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768)
    }
    
    checkMobile()
    window.addEventListener('resize', checkMobile)
    
    return () => {
      window.removeEventListener('resize', checkMobile)
    }
  }, [])

  // Cleanup tooltip on unmount
  useEffect(() => {
    return () => {
      d3.select('.chart-tooltip').remove()
    }
  }, [])

  // Delay first measurement so bento expand (280ms) finishes – avoids small-then-big double draw
  useEffect(() => {
    const t = setTimeout(() => setMeasurementReady(true), 350)
    return () => clearTimeout(t)
  }, [])

  // Responsive sizing with ResizeObserver (only after measurementReady so we get final size once)
  useEffect(() => {
    if (!measurementReady) return

    let resizeTimeout
    let isUpdating = false
    const currentDimensionsRef = { width: dimensions?.width ?? 0, height: dimensions?.height ?? 0 }

    const updateDimensions = () => {
      if (containerRef.current && !isUpdating) {
        isUpdating = true

        const container = containerRef.current
        const newWidth = Math.max(300, container.clientWidth || 400)
        const newHeight = Math.max(200, container.clientHeight || 300)

        setDimensions(prev => {
          if (!prev) {
            isUpdating = false
            currentDimensionsRef.width = newWidth
            currentDimensionsRef.height = newHeight
            return { width: newWidth, height: newHeight }
          }
          const widthDiff = Math.abs(prev.width - newWidth)
          const heightDiff = Math.abs(prev.height - newHeight)

          if (widthDiff < 1 && heightDiff < 1) {
            isUpdating = false
            return prev
          }

          isUpdating = false
          currentDimensionsRef.width = newWidth
          currentDimensionsRef.height = newHeight
          return { width: newWidth, height: newHeight }
        })
      } else {
        isUpdating = false
      }
    }

    // Single measurement now that bento has settled
    if (containerRef.current) {
      updateDimensions()
    }

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const newWidth = entry.contentBoxSize?.[0]?.inlineSize || entry.contentRect.width
        const newHeight = entry.contentBoxSize?.[0]?.blockSize || entry.contentRect.height

        const widthDiff = Math.abs(currentDimensionsRef.width - newWidth)
        const heightDiff = Math.abs(currentDimensionsRef.height - newHeight)

        if (widthDiff < 1 && heightDiff < 1) return

        clearTimeout(resizeTimeout)
        resizeTimeout = setTimeout(updateDimensions, 200)
      }
    })

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current)
    }

    const handleResize = () => {
      clearTimeout(resizeTimeout)
      resizeTimeout = setTimeout(updateDimensions, 200)
    }
    window.addEventListener('resize', handleResize)

    return () => {
      clearTimeout(resizeTimeout)
      resizeObserver.disconnect()
      window.removeEventListener('resize', handleResize)
    }
  }, [measurementReady])

  // Debug: Log data when it changes
  useEffect(() => {
    if (data && data.length > 0) {
      console.log('[PerformanceChart] Raw data:', {
        totalPoints: data.length,
        gameweeks: data.map(d => d.gameweek),
        sample: data.slice(0, 3)
      })
    }
  }, [data])

  // Filter data based on filter prop
  const filteredData = useMemo(() => {
    if (!data || data.length === 0) return []
    
    if (filter === 'last12' && data.length > 12) {
      return data.slice(-12)
    } else if (filter === 'last6' && data.length > 6) {
      return data.slice(-6)
    }
    return data
  }, [data, filter])

  // Debug: Log filtered data when it changes
  useEffect(() => {
    if (filteredData && filteredData.length > 0) {
      console.log('[PerformanceChart] Filtered data:', {
        filter,
        totalPoints: filteredData.length,
        gameweeks: filteredData.map(d => d.gameweek),
        minGW: Math.min(...filteredData.map(d => d.gameweek)),
        maxGW: Math.max(...filteredData.map(d => d.gameweek))
      })
    }
  }, [filteredData, filter])

  // Filter comparison data to match filtered data range
  const filteredComparisonData = useMemo(() => {
    if (!showComparison || !comparisonData || comparisonData.length === 0) return null
    
    if (filteredData.length === 0) return null
    
    const minGW = Math.min(...filteredData.map(d => d.gameweek))
    const maxGW = Math.max(...filteredData.map(d => d.gameweek))
    
    return comparisonData.filter(d => d.gameweek >= minGW && d.gameweek <= maxGW)
  }, [showComparison, comparisonData, filteredData])

  // Filter to league leader only, same GW range as main chart
  const filteredTop10LinesData = useMemo(() => {
    if (!showTop10Lines || !top10LinesData?.length || filteredData.length === 0) return []
    const minGW = Math.min(...filteredData.map(d => d.gameweek))
    const maxGW = Math.max(...filteredData.map(d => d.gameweek))
    return top10LinesData
      .filter(s => s.leagueRank === 1)
      .map(({ managerId, managerName, data: seriesData, leagueRank }) => ({
        managerId,
        managerName,
        leagueRank,
        data: seriesData.filter(d => d.gameweek >= minGW && d.gameweek <= maxGW)
      }))
      .filter(s => s.data.length > 0)
  }, [showTop10Lines, top10LinesData, filteredData])

  // Render chart with D3 (only after we have settled dimensions to avoid small-then-big bounce)
  useEffect(() => {
    if (!dimensions || !svgRef.current || filteredData.length === 0 || loading) return

    const svg = d3.select(svgRef.current)
    const width = dimensions.width
    const height = dimensions.height
    
    // Check if dimensions changed significantly - if so, clear everything
    const dimensionsChanged = 
      Math.abs(prevDimensionsRef.current.width - width) > 5 || 
      Math.abs(prevDimensionsRef.current.height - height) > 5
    
    if (dimensionsChanged) {
      svg.selectAll('*').remove()
      prevDimensionsRef.current = { width, height }
    }

    // When redrawing due to resize (e.g. bento just expanded), skip transitions to avoid double-load flicker
    const transitionMs = (n) => (dimensionsChanged ? 0 : n)

    // Proportional padding – tighter so graph + chip legend fit in bento without scroll
    const padding = {
      top: Math.round(height * 0.06),
      right: Math.round(width * 0.05),
      bottom: Math.round(height * 0.16),
      left: Math.round(width * 0.1)
    }
    
    const chartWidth = width - padding.left - padding.right
    const chartHeight = height - padding.top - padding.bottom

    // Calculate scales
    const allRanks = [...filteredData.map(d => d.overallRank)]
    if (filteredComparisonData && filteredComparisonData.length > 0) {
      allRanks.push(...filteredComparisonData.map(d => d.overallRank))
    }
    if (filteredTop10LinesData.length > 0) {
      filteredTop10LinesData.forEach(s => s.data.forEach(d => allRanks.push(d.overallRank)))
    }
    
    const minRank = Math.min(...allRanks)
    const maxRank = Math.max(...allRanks)
    const minGW = Math.min(...filteredData.map(d => d.gameweek))
    const maxGW = Math.max(...filteredData.map(d => d.gameweek))

    // Calculate season midpoint (GW19/20 boundary for FPL)
    // WC1 must be used by GW19, WC2 available from GW20
    const seasonMidpoint = 19.5

    // Y-axis scale (inverted - rank 1 at top)
    // If manager is close to top (within top 100k), show 1 on y-axis for better context
    const rankRange = maxRank - minRank
    let yMin
    if (minRank <= 100000) {
      // For top managers, always show 1 on y-axis (rank 1 is the best)
      yMin = 1
    } else {
      // For other managers, use padding
      yMin = Math.max(1, minRank - rankRange * 0.1)
    }
    const yMax = maxRank + rankRange * 0.1
    
    const xScale = d3.scaleLinear()
      .domain([minGW, maxGW])
      .range([padding.left, width - padding.right])

    const yScale = d3.scaleLinear()
      .domain([yMin, yMax])
      .range([padding.top, height - padding.bottom])

    // Line generator with smooth curves
    const line = d3.line()
      .x(d => xScale(d.gameweek))
      .y(d => yScale(d.overallRank))
      .curve(d3.curveMonotoneX) // Smooth curve
    
    // Shared interpolation function - ensures line and points use identical calculations
    // Matches by gameweek to handle cases where data order changes
    const getInterpolatedData = (currentData, previousData, t) => {
      const previousMap = new Map(previousData.map(d => [d.gameweek, d]))
      
      return currentData.map((point) => {
        const prevPoint = previousMap.get(point.gameweek) || point
        return {
          gameweek: prevPoint.gameweek + (point.gameweek - prevPoint.gameweek) * t,
          overallRank: prevPoint.overallRank + (point.overallRank - prevPoint.overallRank) * t
        }
      })
    }
    
    // Path tween factory - creates a tween function that uses shared previousData
    // This ensures line, area, and points all animate from the exact same starting point
    const createPathTween = (sharedPreviousData) => {
      return function(d) {
        const node = this
        node.__previousData = d
        
        // Return tween function that interpolates between previous and current data
        return function(t) {
          // Use the shared previousData for perfect synchronization
          const interpolatedData = getInterpolatedData(d, sharedPreviousData, t)
          return line(interpolatedData)
        }
      }
    }

    // Create a shared transition for all chart elements (area, line, points) to ensure perfect synchronization
    // This ensures they all animate together with the same timing
    const syncTransition = d3.transition('chart-sync')
      .duration(transitionMs(220))
      .ease(d3.easeCubicInOut)

    // Create or get main group
    let g = svg.select('.chart-group')
    if (g.empty() || dimensionsChanged) {
      g = svg.append('g').attr('class', 'chart-group')
    }

    // Grid lines with transition
    // If yMin is 1, ensure rank 1 is included in ticks
    let yTicks = yScale.ticks(5)
    if (yMin === 1 && !yTicks.includes(1)) {
      yTicks = [1, ...yTicks].sort((a, b) => a - b)
    }
    const gridLines = g.selectAll('.grid-line')
      .data(yTicks, d => d) // Key function

    const gridLinesEnter = gridLines.enter()
      .append('line')
      .attr('class', 'grid-line')
      .attr('x1', padding.left)
      .attr('x2', width - padding.right)
      .attr('y1', d => yScale(d))
      .attr('y2', d => yScale(d))
      .attr('stroke', 'var(--border-color)')
      .attr('stroke-width', 0.5)
      .attr('stroke-dasharray', '2,4')
      .attr('opacity', 0)
      .lower() // Ensure grid lines are behind other elements

    const mergedGridLines = gridLinesEnter.merge(gridLines)
    mergedGridLines.lower() // Ensure grid lines are behind other elements (call on selection, not transition)
    mergedGridLines
      .transition()
      .duration(transitionMs(320))
      .ease(d3.easeCubicOut)
      .attr('y1', d => yScale(d))
      .attr('y2', d => yScale(d))
      .attr('opacity', 0.28)

    gridLines.exit()
      .transition()
      .duration(transitionMs(180))
      .attr('opacity', 0)
      .remove()

    // Y-axis labels with transition
    const yLabels = g.selectAll('.y-label')
      .data(yTicks, d => d) // Key function

    const yLabelsEnter = yLabels.enter()
      .append('text')
      .attr('class', 'y-label')
      .attr('x', padding.left - (isMobile ? 6 : 12))
      .attr('y', d => yScale(d) + 4)
      .attr('text-anchor', 'end')
      .attr('font-size', isMobile ? '9' : '11')
      .attr('fill', 'var(--text-secondary)')
      .attr('font-weight', '500')
      .attr('opacity', 0)
      .text(d => formatWholeNumber(d))

    yLabelsEnter.merge(yLabels)
      .transition()
      .duration(transitionMs(320))
      .ease(d3.easeCubicOut)
      .attr('y', d => yScale(d) + 4)
      .attr('opacity', 1)
      .text(d => formatWholeNumber(d))

    yLabels.exit()
      .transition()
      .duration(transitionMs(180))
      .attr('opacity', 0)
      .remove()

    // X-axis labels (gameweeks) with transition
    const xTicks = (() => {
      const range = maxGW - minGW
      if (range <= 6) {
        // Show all gameweeks if 6 or fewer
        return Array.from({ length: range + 1 }, (_, i) => minGW + i)
      } else {
        // Show ~5 evenly spaced gameweeks
        const step = Math.ceil(range / 5)
        const ticks = []
        for (let gw = minGW; gw <= maxGW; gw += step) {
          ticks.push(gw)
        }
        if (ticks[ticks.length - 1] !== maxGW) {
          ticks.push(maxGW)
        }
        return ticks
      }
    })()

    const xLabels = g.selectAll('.x-label')
      .data(xTicks, d => d) // Key function

    const xLabelsEnter = xLabels.enter()
      .append('text')
      .attr('class', 'x-label')
      .attr('x', d => xScale(d))
      .attr('y', height - padding.bottom + (isMobile ? 10 : 12))
      .attr('text-anchor', 'middle')
      .attr('font-size', isMobile ? '9' : '11')
      .attr('fill', 'var(--text-secondary)')
      .attr('font-weight', '500')
      .attr('opacity', 0)
      .text(d => d)

    xLabelsEnter.merge(xLabels)
      .transition()
      .duration(transitionMs(320))
      .ease(d3.easeCubicOut)
      .attr('x', d => xScale(d))
      .attr('opacity', 1)

    xLabels.exit()
      .transition()
      .duration(transitionMs(180))
      .attr('opacity', 0)
      .remove()

    // Y-axis line - always update to ensure it extends full height
    const yAxisLine = g.selectAll('.y-axis')
      .data([1]) // Single data point to ensure line exists
    
    yAxisLine.enter()
      .append('line')
      .attr('class', 'y-axis')
      .attr('x1', padding.left)
      .attr('y1', padding.top)
      .attr('x2', padding.left)
      .attr('y2', height - padding.bottom)
      .attr('stroke', 'var(--border-color)')
      .attr('stroke-width', 1)
      .attr('opacity', 0.5)
    
    yAxisLine.merge(yAxisLine)
      .attr('x1', padding.left)
      .attr('y1', padding.top)
      .attr('x2', padding.left)
      .attr('y2', height - padding.bottom)
    
    yAxisLine.exit().remove()

    if (g.select('.x-axis').empty()) {
      g.append('line')
        .attr('class', 'x-axis')
        .attr('x1', padding.left)
        .attr('y1', height - padding.bottom)
        .attr('x2', width - padding.right)
        .attr('y2', height - padding.bottom)
        .attr('stroke', 'var(--border-color)')
        .attr('stroke-width', 1)
        .attr('opacity', 0.5)
    } else {
      g.select('.x-axis')
        .attr('x2', width - padding.right)
        .attr('y1', height - padding.bottom)
        .attr('y2', height - padding.bottom)
    }

    // Season midpoint vertical line (only show if midpoint is within visible range)
    if (seasonMidpoint >= minGW && seasonMidpoint <= maxGW) {
      const midpointX = xScale(seasonMidpoint)
      
      const midpointLine = g.selectAll('.season-midpoint-line')
        .data([seasonMidpoint])
      
      const midpointLineEnter = midpointLine.enter()
        .append('line')
        .attr('class', 'season-midpoint-line')
        .attr('x1', midpointX)
        .attr('x2', midpointX)
        .attr('y1', padding.top)
        .attr('y2', height - padding.bottom)
        .attr('stroke', 'var(--text-secondary)')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '3,3')
        .attr('opacity', 0.3)
      
      midpointLineEnter.merge(midpointLine)
        .transition()
        .duration(transitionMs(320))
        .ease(d3.easeCubicOut)
        .attr('x1', midpointX)
        .attr('x2', midpointX)
        .attr('opacity', 0.3)
      
      midpointLine.exit()
        .transition()
        .duration(transitionMs(180))
        .attr('opacity', 0)
        .remove()
    } else {
      // Remove midpoint line if not in range
      g.selectAll('.season-midpoint-line')
        .transition()
        .duration(transitionMs(180))
        .attr('opacity', 0)
        .remove()
    }

    // Area gradient (only create if it doesn't exist)
    let defs = svg.select('defs')
    if (defs.empty()) {
      defs = svg.append('defs')
    }
    
    let gradient = defs.select('#areaGradient')
    if (gradient.empty()) {
      gradient = defs.append('linearGradient')
        .attr('id', 'areaGradient')
        .attr('x1', '0%')
        .attr('y1', '0%')
        .attr('x2', '0%')
        .attr('y2', '100%')

      gradient.append('stop')
        .attr('offset', '0%')
        .attr('stop-color', lineColor)
        .attr('stop-opacity', 0.28)

      gradient.append('stop')
        .attr('offset', '35%')
        .attr('stop-color', lineColor)
        .attr('stop-opacity', 0.06)

      gradient.append('stop')
        .attr('offset', '100%')
        .attr('stop-color', lineColor)
        .attr('stop-opacity', 0.02)
    }

    // Main line with smooth transition
    // We need to get previous data FIRST, before area, so all elements can share it
    const mainLine = g.selectAll('.main-line')
      .data([filteredData])

    // Store previous data before creating new line
    // This must happen before any transitions to ensure area and points can access it
    const mainLineNode = mainLine.node()
    const previousData = mainLineNode?.__previousData || filteredData
    // Store current data as previous for next transition (after this one completes)
    if (mainLineNode) {
      mainLineNode.__previousData = filteredData
    }

    // Area fill with transition - synchronized with line and points
    const area = d3.area()
      .x(d => xScale(d.gameweek))
      .y0(height - padding.bottom)
      .y1(d => yScale(d.overallRank))
      .curve(d3.curveMonotoneX)

    const areaPath = g.selectAll('.area')
      .data([filteredData])

    // Use the same previousData as the line for perfect synchronization
    const areaPathNode = areaPath.node()
    if (areaPathNode) {
      areaPathNode.__previousData = filteredData
    }

    const areaPathEnter = areaPath.enter()
      .append('path')
      .attr('class', 'area')
      .attr('fill', 'url(#areaGradient)')
      .attr('d', area(previousData)) // Start from same previous position as line
      .attr('opacity', 0)
      .each(function() {
        // Store previous data on entering area node too
        this.__previousData = previousData
      })

    // Area tween using the same interpolation as line and points
    // CRITICAL: Always use the shared previousData (not node.__previousData) for perfect sync
    const areaTween = function(d) {
      const node = this
      // Always use the shared previousData from the line node - this ensures area, line, and points
      // all animate from the exact same starting point
      node.__previousData = d
      
      return function(t) {
        // Use the exact same shared interpolation function with the exact same previousData
        // This ensures the area follows the line perfectly
        const interpolatedData = getInterpolatedData(d, previousData, t)
        return area(interpolatedData)
      }
    }
    
    // Merge and animate - ensure all paths start from previous position for perfect sync
    // For merged (existing) paths, set initial 'd' to previous position before transition
    areaPath
      .attr('d', area(previousData)) // Set to previous position for smooth transition
    
    // Now animate all paths together using the shared transition
    areaPathEnter.merge(areaPath)
      .transition(syncTransition)
      .attrTween('d', areaTween)
      .attr('opacity', 1)
      .on('end', function() {
        // Update previous data after transition completes
        this.__previousData = filteredData
      })

    areaPath.exit()
      .transition()
      .duration(transitionMs(180))
      .attr('opacity', 0)
      .remove()

    // Comparison line (if enabled)
    if (filteredComparisonData && filteredComparisonData.length > 0) {
      const comparisonLine = g.selectAll('.comparison-line')
        .data([filteredComparisonData])
      
      const comparisonLineEnter = comparisonLine.enter()
        .append('path')
        .attr('class', 'comparison-line')
        .attr('fill', 'none')
        .attr('stroke', 'var(--accent-yellow)')
        .attr('stroke-width', isMobile ? 2 : 2.5)
        .attr('stroke-dasharray', '4,4')
        .attr('opacity', 0)
        .attr('d', line)
      
      comparisonLineEnter.merge(comparisonLine)
        .transition()
        .duration(transitionMs(320))
        .ease(d3.easeCubicOut)
        .attr('d', line)
        .attr('opacity', 0.8)
      
      comparisonLine.exit()
        .transition()
        .duration(transitionMs(180))
        .attr('opacity', 0)
        .remove()

      // Comparison data points
      const comparisonPoints = g.selectAll('.comparison-point')
        .data(filteredComparisonData, d => `${d.gameweek}-${d.overallRank}`)
      
      const comparisonPointsEnter = comparisonPoints.enter()
        .append('circle')
        .attr('class', 'comparison-point')
        .attr('cx', d => xScale(d.gameweek))
        .attr('cy', d => yScale(d.overallRank))
        .attr('r', 0)
        .attr('fill', 'var(--bg-card)')
        .attr('stroke', 'var(--accent-yellow)')
        .attr('stroke-width', 1.5)
        .attr('opacity', 0)
      
      comparisonPointsEnter.merge(comparisonPoints)
        .transition()
        .duration(transitionMs(320))
        .ease(d3.easeCubicOut)
        .attr('cx', d => xScale(d.gameweek))
        .attr('cy', d => yScale(d.overallRank))
        .attr('r', 4)
        .attr('opacity', 1)
      
      comparisonPoints.exit()
        .transition()
        .duration(transitionMs(180))
        .attr('r', 0)
        .attr('opacity', 0)
        .remove()
    } else {
      // Remove comparison line if disabled
      g.selectAll('.comparison-line, .comparison-point')
        .transition()
        .duration(transitionMs(180))
        .attr('opacity', 0)
        .remove()
    }

    // League leader line: same styling as configured manager (thick line + points), different color
    if (filteredTop10LinesData.length > 0) {
      const top10Paths = g.selectAll('.top10-line')
        .data(filteredTop10LinesData, (d, i) => d.managerId ?? i)

      const strokeColor = (d) => (d.leagueRank === 1 ? TOP10_LEADER_COLOR : TOP10_MUTED_COLOR)
      const leaderStrokeWidth = isMobile ? 2 : 2.5

      top10Paths.enter()
        .append('path')
        .attr('class', 'top10-line')
        .attr('fill', 'none')
        .attr('stroke-width', leaderStrokeWidth)
        .attr('stroke-linecap', 'round')
        .attr('stroke-linejoin', 'round')
        .attr('opacity', 0)
        .attr('d', d => line(d.data))
        .attr('stroke', strokeColor)
        .merge(top10Paths)
        .transition()
        .duration(transitionMs(240))
        .ease(d3.easeCubicOut)
        .attr('d', d => line(d.data))
        .attr('opacity', 1)
        .attr('stroke', strokeColor)
        .attr('stroke-width', leaderStrokeWidth)

      top10Paths.exit()
        .transition()
        .duration(transitionMs(200))
        .attr('opacity', 0)
        .remove()

      // League leader data points (same style as main line: circle with stroke; chips like main)
      const leaderPointsFlat = filteredTop10LinesData.flatMap(s => s.data.map(d => ({ ...d, _managerId: s.managerId })))
      const top10Points = g.selectAll('.top10-point')
        .data(leaderPointsFlat, d => `${d._managerId}-${d.gameweek}`)

      top10Points.enter()
        .append('circle')
        .attr('class', d => d.chip ? 'top10-point top10-chip-point' : 'top10-point')
        .attr('cx', d => xScale(d.gameweek))
        .attr('cy', d => yScale(d.overallRank))
        .attr('r', 0)
        .attr('fill', d => {
          if (d.chip && chipInfo[d.chip]) return chipInfo[d.chip].color
          return 'var(--bg-card)'
        })
        .attr('stroke', d => {
          if (d.chip && chipInfo[d.chip]) return 'rgba(0, 0, 0, 0.3)'
          return TOP10_LEADER_COLOR
        })
        .attr('stroke-width', d => d.chip ? 2 : 1.5)
        .attr('opacity', 0)
        .merge(top10Points)
        .attr('class', d => d.chip ? 'top10-point top10-chip-point' : 'top10-point')
        .transition()
        .duration(transitionMs(240))
        .ease(d3.easeCubicOut)
        .attr('cx', d => xScale(d.gameweek))
        .attr('cy', d => yScale(d.overallRank))
        .attr('r', d => (d.chip ? 5 : 4))
        .attr('opacity', 1)
        .attr('fill', d => {
          if (d.chip && chipInfo[d.chip]) return chipInfo[d.chip].color
          return 'var(--bg-card)'
        })
        .attr('stroke', d => {
          if (d.chip && chipInfo[d.chip]) return 'rgba(0, 0, 0, 0.3)'
          return TOP10_LEADER_COLOR
        })
        .attr('stroke-width', d => d.chip ? 2 : 1.5)

      top10Points.exit()
        .transition()
        .duration(transitionMs(200))
        .attr('r', 0)
        .attr('opacity', 0)
        .remove()
    } else {
      g.selectAll('.top10-line, .top10-point')
        .transition()
        .duration(transitionMs(200))
        .attr('opacity', 0)
        .remove()
    }

    const mainLineEnter = mainLine.enter()
      .append('path')
      .attr('class', 'main-line')
      .attr('fill', 'none')
      .attr('stroke', lineColor)
      .attr('stroke-width', isMobile ? 2 : 2.5)
      .attr('stroke-linecap', 'round')
      .attr('stroke-linejoin', 'round')
      .attr('d', line(previousData)) // Start from previous position
      .attr('opacity', 0)
      .each(function() {
        // Store previous data on entering line node too
        this.__previousData = previousData
      })

    // Create path tween using the shared previousData for perfect sync
    const pathTween = createPathTween(previousData)
    
    // Use the same shared transition for synchronization
    mainLineEnter.merge(mainLine)
      .transition(syncTransition)
      .attrTween('d', pathTween)
      .attr('opacity', 1)
      .on('end', function() {
        // Update previous data after transition completes
        this.__previousData = filteredData
      })

    mainLine.exit()
      .transition()
      .duration(transitionMs(180))
      .attr('opacity', 0)
      .remove()

    // Data points with transition
    const previousDataMap = new Map(previousData.map(d => [d.gameweek, d]))
    const points = g.selectAll('.data-point')
      .data(filteredData, d => d.gameweek)

    const pointsEnter = points.enter()
      .append('circle')
      .attr('class', d => d.chip ? 'data-point chip-point' : 'data-point')
      .attr('cx', d => xScale(d.gameweek))
      .attr('cy', d => {
        const prev = previousDataMap.get(d.gameweek)
        return yScale(prev ? prev.overallRank : d.overallRank)
      })
      .attr('r', 0)
      .attr('fill', d => {
        if (d.chip && chipInfo[d.chip]) return chipInfo[d.chip].color
        return 'var(--bg-card)'
      })
      .attr('stroke', d => {
        if (d.chip && chipInfo[d.chip]) return 'rgba(0, 0, 0, 0.3)'
        return lineColor
      })
      .attr('stroke-width', d => d.chip ? 2 : 1.5)
      .attr('opacity', 0)

    const currentPositions = new Map()
    points.each(function(d) {
      const cx = d3.select(this).attr('cx')
      const cy = d3.select(this).attr('cy')
      if (cx && cy && !isNaN(parseFloat(cx)) && !isNaN(parseFloat(cy))) {
        currentPositions.set(d.gameweek, { cx: parseFloat(cx), cy: parseFloat(cy) })
      }
    })

    const getInterpolatedDataMap = (t) => {
      const interpolatedData = getInterpolatedData(filteredData, previousData, t)
      return new Map(interpolatedData.map(d => [d.gameweek, d]))
    }

    pointsEnter.merge(points)
      .transition(syncTransition)
      .attrTween('cx', function(d) {
        const currentPos = currentPositions.get(d.gameweek)
        const targetX = xScale(d.gameweek)
        return (t) => currentPos
          ? currentPos.cx + (targetX - currentPos.cx) * t
          : xScale((getInterpolatedDataMap(t).get(d.gameweek) || d).gameweek)
      })
      .attrTween('cy', function(d) {
        const currentPos = currentPositions.get(d.gameweek)
        const targetY = yScale(d.overallRank)
        return (t) => currentPos
          ? currentPos.cy + (targetY - currentPos.cy) * t
          : yScale((getInterpolatedDataMap(t).get(d.gameweek) || d).overallRank)
      })
      .attr('r', d => (d.chip ? 5 : 4))
      .attr('opacity', 1)

    points.exit()
      .transition()
      .duration(transitionMs(180))
      .attr('r', 0)
      .attr('opacity', 0)
      .remove()

    // Ensure configured manager (main) line and dots render above league leader
    g.selectAll('.main-line, .data-point').raise()

    // Tooltip (simple hover effect) - create or select existing
    let tooltip = d3.select('.chart-tooltip')
    if (tooltip.empty()) {
      tooltip = d3.select('body').append('div')
        .attr('class', 'chart-tooltip')
        .style('opacity', 0)
        .style('position', 'absolute')
        .style('background', 'var(--bg-card)')
        .style('border', '1px solid var(--border-color)')
        .style('border-radius', '6px')
        .style('padding', '8px 12px')
        .style('font-size', '12px')
        .style('pointer-events', 'none')
        .style('z-index', 1000)
    }

    // Bind tooltip to all points
    pointsEnter.merge(points)
      .on('mouseover', function(event, d) {
        tooltip.transition().duration(200).style('opacity', 1)
        const chipDisplay = d.chip ? getChipDisplayName(d.chip, d.gameweek) : null
        tooltip.html(`
          <div><strong>GW ${d.gameweek}</strong></div>
          <div>Rank: ${formatNumber(d.overallRank)}</div>
          ${chipDisplay ? `<div>Chip: ${chipDisplay}</div>` : ''}
        `)
        
        // Intelligent positioning to avoid screen edges, especially on mobile
        const tooltipNode = tooltip.node()
        if (tooltipNode) {
          // Get tooltip dimensions (need to make it visible temporarily to measure)
          tooltip.style('visibility', 'hidden').style('display', 'block')
          const tooltipRect = tooltipNode.getBoundingClientRect()
          const tooltipWidth = tooltipRect.width
          const tooltipHeight = tooltipRect.height
          tooltip.style('visibility', 'visible')
          
          // Get viewport dimensions
          const viewportWidth = window.innerWidth
          const viewportHeight = window.innerHeight
          const padding = 12 // Minimum distance from edge
          
          // Calculate initial position
          let left = event.pageX + 10
          let top = event.pageY - 10
          
          // Adjust horizontal position if too close to right edge
          if (left + tooltipWidth + padding > viewportWidth) {
            // Try positioning to the left of cursor
            left = event.pageX - tooltipWidth - 10
            // If still off-screen on left, position at right edge with padding
            if (left < padding) {
              left = viewportWidth - tooltipWidth - padding
            }
          }
          
          // Adjust horizontal position if too close to left edge
          if (left < padding) {
            left = padding
          }
          
          // Adjust vertical position if too close to bottom edge
          if (top + tooltipHeight + padding > viewportHeight) {
            // Position above cursor instead
            top = event.pageY - tooltipHeight - 10
            // If still off-screen on top, position at bottom edge with padding
            if (top < padding) {
              top = viewportHeight - tooltipHeight - padding
            }
          }
          
          // Adjust vertical position if too close to top edge
          if (top < padding) {
            top = padding
          }
          
          tooltip
            .style('left', left + 'px')
            .style('top', top + 'px')
        } else {
          // Fallback to original positioning if measurement fails
          tooltip
            .style('left', (event.pageX + 10) + 'px')
            .style('top', (event.pageY - 10) + 'px')
        }
      })
      .on('mouseout', function() {
        tooltip.transition().duration(200).style('opacity', 0)
      })

    // Chip legend inside SVG so dot size matches graph (r=6/7); add League leader when toggled
    const legendChips = [
      ...Object.entries(chipInfo).map(([key, { name, color }]) => ({ key, name, color, isLine: false })),
      ...(showTop10Lines ? [{ key: 'league-leader', name: 'League leader', color: TOP10_LEADER_COLOR, isLine: true }] : [])
    ]
    const legendGroupSel = g.selectAll('.chip-legend-group').data([null])
    legendGroupSel.enter()
      .append('g')
      .attr('class', 'chip-legend-group')

    const legendGroup = g.select('.chip-legend-group')
    legendGroup.attr('transform', `translate(${width / 2}, ${height - padding.bottom * 0.35})`)

    const legendItemSpacing = isMobile ? 40 : 48
    const legendTotalWidth = (legendChips.length - 1) * legendItemSpacing
    let legendX = -legendTotalWidth / 2

    const legendItems = legendGroup.selectAll('.chip-legend-item').data(legendChips, d => d.key)
    const legendItemsEnter = legendItems.enter()
      .append('g')
      .attr('class', 'chip-legend-item')

    const legendDotR = isMobile ? 4 : 5
    // Circle for chips; line segment for "League leader"
    legendItemsEnter.each(function(d) {
      const el = d3.select(this)
      if (d.isLine) {
        el.append('path')
          .attr('class', 'chip-legend-line')
          .attr('d', `M${-legendDotR},0 L${legendDotR},0`)
          .attr('stroke', d.color)
          .attr('stroke-width', 2)
          .attr('stroke-linecap', 'round')
          .attr('fill', 'none')
      } else {
        el.append('circle')
          .attr('r', legendDotR)
          .attr('fill', d.color)
          .attr('stroke', 'rgba(0,0,0,0.3)')
          .attr('stroke-width', 1.5)
          .attr('cx', 0)
          .attr('cy', 0)
      }
    })

    legendItemsEnter.append('text')
      .attr('class', 'chip-legend-svg-label')
      .attr('x', legendDotR + 3)
      .attr('y', 3.5)
      .attr('fill', 'var(--text-secondary)')
      .attr('font-size', isMobile ? 8 : 9)
      .attr('font-weight', '500')
      .attr('text-anchor', 'start')
      .text(d => d.name)

    legendItems.merge(legendItemsEnter)
      .attr('transform', (d, i) => {
        const x = legendX + i * legendItemSpacing
        return `translate(${x}, 0)`
      })

    legendItems.selectAll('circle')
      .attr('r', legendDotR)
      .attr('fill', d => d.color)

    legendItems.selectAll('.chip-legend-line')
      .attr('stroke', d => d.color)

    legendItems.select('text')
      .attr('x', legendDotR + 3)
      .attr('font-size', isMobile ? 8 : 9)
      .text(d => d.name)

    legendItems.exit().remove()

    // No cleanup needed - tooltip persists across renders
  }, [filteredData, filteredComparisonData, filteredTop10LinesData, dimensions, isMobile, lineColor, loading, showComparison, showTop10Lines, filter])

  if (loading || !data || data.length === 0) {
    return (
      <div className="chart-loading">
        <div className="skeleton-text"></div>
      </div>
    )
  }

  const displayDims = dimensions ?? { width: 400, height: 300 }

  return (
    <div className="performance-chart-container">
      <div ref={containerRef} className="performance-chart-svg-wrapper">
        <svg 
          ref={svgRef}
          width={displayDims.width}
          height={displayDims.height}
          viewBox={`0 0 ${displayDims.width} ${displayDims.height}`}
          preserveAspectRatio="xMidYMid meet"
          className="performance-chart"
        />
      </div>
      {/* Filter controls below legend, centered */}
      {(onFilterChange || onShowTop10Change) && (
        <div className="chart-filter-controls">
          {onFilterChange && (
            <>
              <button
                className={`chart-filter-btn ${filter === 'all' ? 'active' : ''}`}
                onClick={() => {
                  onFilterChange('all')
                  toast('Showing all gameweeks')
                }}
              >
                All
              </button>
              <button
                className={`chart-filter-btn ${filter === 'last12' ? 'active' : ''}`}
                onClick={() => {
                  onFilterChange('last12')
                  toast('Showing last 12 gameweeks')
                }}
              >
                Last 12
              </button>
              <button
                className={`chart-filter-btn ${filter === 'last6' ? 'active' : ''}`}
                onClick={() => {
                  onFilterChange('last6')
                  toast('Showing last 6 gameweeks')
                }}
              >
                Last 6
              </button>
            </>
          )}
          {onShowTop10Change && (
            <>
              <span className="chart-filter-sep" aria-hidden />
              <button
                type="button"
                className={`chart-filter-btn chart-filter-btn-icon ${showTop10Lines ? 'active' : ''}`}
                onClick={() => {
                  const next = !showTop10Lines
                  onShowTop10Change(next)
                  toast(next ? 'League leader line shown' : 'League leader line hidden')
                }}
                title={showTop10Lines ? 'Hide league leader line' : 'Show league leader line'}
                aria-pressed={showTop10Lines}
              >
                <Users size={14} strokeWidth={2} aria-hidden />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
