import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import * as d3 from 'd3'
import { formatNumber } from '../utils/formatNumbers'
import './PlayerPerformanceChart.css'

/**
 * D3.js Player Performance Chart Component
 * Displays owned player performance with horizontal bars showing points from starting positions only
 * (points that contribute to total points)
 */
export default function PlayerPerformanceChart({ 
  data = [], 
  loading = false,
  filter = 'all', // 'all', 'last12', 'last6'
  onFilterChange = null
}) {
  const svgRef = useRef(null)
  const containerRef = useRef(null)
  const [dimensions, setDimensions] = useState({ width: 400, height: 300 })
  const [isMobile, setIsMobile] = useState(false)
  const [excludeHaaland, setExcludeHaaland] = useState(false)
  const prevDimensionsRef = useRef(dimensions)
  
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

  // Responsive sizing with ResizeObserver
  useEffect(() => {
    let resizeTimeout
    let isUpdating = false
    
    const updateDimensions = () => {
      if (containerRef.current && !isUpdating) {
        isUpdating = true
        
        const container = containerRef.current
        // Use full container width for maximum chart area
        const newWidth = Math.max(300, container.clientWidth || 400)
        const newHeight = Math.max(200, container.clientHeight || 300)
        
        setDimensions(prev => {
          const widthDiff = Math.abs(prev.width - newWidth)
          const heightDiff = Math.abs(prev.height - newHeight)
          
          if (widthDiff < 1 && heightDiff < 1) {
            isUpdating = false
            return prev
          }
          
          return { width: newWidth, height: newHeight }
        })
        
        clearTimeout(resizeTimeout)
        resizeTimeout = setTimeout(() => {
          isUpdating = false
        }, 100)
      }
    }
    
    if (containerRef.current) {
      const resizeObserver = new ResizeObserver(updateDimensions)
      resizeObserver.observe(containerRef.current)
      
      updateDimensions()
      
      return () => {
        resizeObserver.disconnect()
        clearTimeout(resizeTimeout)
      }
    }
  }, [dimensions.width, dimensions.height])

  // Data is already filtered by the hook based on the filter prop
  // This useMemo just ensures we have valid data
  const filteredData = useMemo(() => {
    if (!data || data.length === 0) return []
    return data
  }, [data])

  // Filter out Haaland if excludeHaaland is enabled, and recalculate percentages
  const processedData = useMemo(() => {
    if (!filteredData || filteredData.length === 0) return []
    
    // Filter out Haaland if enabled (case-insensitive match)
    let dataToProcess = filteredData
    if (excludeHaaland) {
      dataToProcess = filteredData.filter(
        player => !player.player_name || 
        player.player_name.toLowerCase() !== 'haaland'
      )
    }
    
    // If Haaland was excluded, recalculate percentages based on remaining players
    if (excludeHaaland && dataToProcess.length > 0) {
      // Calculate new total points (sum of all remaining players)
      const newTotalPoints = dataToProcess.reduce(
        (sum, player) => sum + (player.total_points || 0), 
        0
      )
      
      // Recalculate percentage for each player
      if (newTotalPoints > 0) {
        dataToProcess = dataToProcess.map(player => ({
          ...player,
          percentage_of_total_points: Math.round(
            ((player.total_points || 0) / newTotalPoints) * 100 * 100
          ) / 100 // Round to 2 decimal places
        }))
      } else {
        // If no points, set all percentages to 0
        dataToProcess = dataToProcess.map(player => ({
          ...player,
          percentage_of_total_points: 0
        }))
      }
    }
    
    return dataToProcess
  }, [filteredData, excludeHaaland])

  // Sort data by total_points descending
  const sortedData = useMemo(() => {
    const sorted = [...processedData].sort((a, b) => (b.total_points || 0) - (a.total_points || 0))
    return sorted
  }, [processedData])

  // Render bar chart
  const renderBarChart = useCallback((svg, sortedData, dimensions, isMobile) => {
    const width = dimensions.width
    const baseHeight = dimensions.height

    // Badge size and spacing (defined early for padding calculation)
    const badgeSize = isMobile ? 14 : 16
    const badgeSpacing = 6 // Spacing between name and badge
    const badgeToBarPadding = 8 // Padding between badge and bar edge
    
    // Padding with minimum left padding to prevent player names from running off edge
    // Account for badge (16px) + spacing (6px) + name
    const minLeftPadding = 100 // Minimum pixels for badge + spacing + player names
    const calculatedLeftPadding = Math.round(width * 0.15)
    const padding = {
      top: Math.round(baseHeight * 0.03),
      right: Math.round(width * 0.02), // Minimal right padding
      bottom: Math.round(baseHeight * 0.08),
      left: Math.max(minLeftPadding, calculatedLeftPadding) // Ensure minimum space for badge + names
    }
    
    const chartWidth = width - padding.left - padding.right
    
    // Calculate height needed for all players (minimum bar height * number of players)
    // Allow overflow - don't constrain to baseHeight, let it scroll
    const minBarHeight = 20
    const barSpacing = 4
    const minChartHeight = sortedData.length * (minBarHeight + barSpacing) + padding.top + padding.bottom
    // Always use minChartHeight to show all players, enable scrolling
    const chartHeight = minChartHeight
    const height = chartHeight + padding.top + padding.bottom

    // Calculate max points for scale (only starting points - no bench points)
    const maxPoints = Math.max(
      ...sortedData.map(d => d.total_points || 0),
      1
    )

    // Calculate max percentage for color scale normalization
    const maxPercentage = Math.max(
      ...sortedData.map(d => d.percentage_of_total_points || 0),
      1
    )

    // Color interpolation function: maps percentage (0-100) to a gradient color
    // Gradient from cool teal/cyan (low %) to warm orange/red-orange (high %)
    // Inspired by vibrant chart color palettes
    const getThemeColor = (varName, darkDefault, lightDefault) => {
      if (typeof window !== 'undefined') {
        const root = document.documentElement
        const computed = getComputedStyle(root).getPropertyValue(varName).trim()
        if (computed) return computed
        // Fallback based on theme
        const isDark = !root.hasAttribute('data-theme') || root.getAttribute('data-theme') === 'dark'
        return isDark ? darkDefault : lightDefault
      }
      return darkDefault
    }
    
    // Determine if dark or light theme
    const isDark = typeof window !== 'undefined' && 
      (!document.documentElement.hasAttribute('data-theme') || 
       document.documentElement.getAttribute('data-theme') === 'dark')
    
    // Create gradient from cool teal to warm orange
    // Low %: Cool teal/cyan (similar to teal bars in reference)
    // High %: Warm orange/red-orange (similar to orange bars in reference)
    const lowColor = isDark 
      ? d3.rgb('#4ecdc4')  // Bright teal/cyan for dark mode
      : d3.rgb('#5dd5c4')  // Lighter teal for light mode
    
    const highColor = isDark
      ? d3.rgb('#ff8c42')  // Warm orange for dark mode
      : d3.rgb('#ff6b6b')  // Bright coral/orange-red for light mode
    
    const getColorForPercentage = (percentage) => {
      if (!percentage || percentage === 0) {
        // Very low or zero percentage - use the cool teal color
        return lowColor.toString()
      }
      
      // Normalize percentage to 0-1 range based on max percentage in current view
      const normalized = Math.min(percentage / maxPercentage, 1)
      
      // Interpolate from cool teal (low %) to warm orange (high %)
      // This creates a vibrant, visually distinct gradient showing contribution level
      const colorScale = d3.scaleLinear()
        .domain([0, 1])
        .range([lowColor, highColor])
      
      return colorScale(normalized).toString()
    }

    // Scales
    const xScale = d3.scaleLinear()
      .domain([0, maxPoints * 1.05]) // Reduced padding to maximize space
      .range([0, chartWidth])

    const yScale = d3.scaleBand()
      .domain(sortedData.map((d, i) => i))
      .range([0, chartHeight])
      .paddingInner(0.15)
      .paddingOuter(0.05)

    // Create clip path to prevent overflow beyond SVG bounds
    const defs = svg.append('defs')
    const clipPath = defs.append('clipPath')
      .attr('id', 'chart-clip')
    clipPath.append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', width)
      .attr('height', height)

    // Create main group with clipping
    const g = svg.append('g')
      .attr('class', 'chart-group')
      .attr('clip-path', 'url(#chart-clip)')

    // Grid lines
    const xTicks = xScale.ticks(5)
    const gridLines = g.selectAll('.grid-line')
      .data(xTicks)

    gridLines.enter()
      .append('line')
      .attr('class', 'grid-line')
      .attr('x1', d => padding.left + xScale(d))
      .attr('x2', d => padding.left + xScale(d))
      .attr('y1', padding.top)
      .attr('y2', height - padding.bottom)
      .attr('stroke', 'var(--border-color)')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '2,2')
      .attr('opacity', 0.2)

    // X-axis labels (points)
    const xLabels = g.selectAll('.x-label')
      .data(xTicks)

    xLabels.enter()
      .append('text')
      .attr('class', 'x-label')
      .attr('x', d => padding.left + xScale(d))
      .attr('y', height - padding.bottom + (isMobile ? 12 : 16))
      .attr('text-anchor', 'middle')
      .attr('font-size', isMobile ? '10' : '12')
      .attr('fill', 'var(--text-secondary)')
      .attr('font-weight', '500')
      .attr('letter-spacing', '0.01em')
      .text(d => formatNumber(d))

    // Y-axis labels (player names) - truncate long names to prevent overflow
    const yLabels = g.selectAll('.y-label')
      .data(sortedData)

    // Helper to truncate text if too long (using temporary SVG element for measurement)
    const truncateName = (name, maxWidth) => {
      if (!name) return 'Unknown'
      
      // Create a temporary SVG element for text measurement
      const tempSvg = d3.select('body').append('svg')
        .style('position', 'absolute')
        .style('visibility', 'hidden')
        .style('pointer-events', 'none')
      
      const tempText = tempSvg.append('text')
        .attr('font-size', isMobile ? '10' : '11')
        .attr('font-weight', '500')
        .text(name)
      
      const textWidth = tempText.node().getComputedTextLength()
      tempSvg.remove()
      
      if (textWidth <= maxWidth) return name
      
      // Truncate with ellipsis
      let truncated = name
      for (let i = name.length - 1; i > 0; i--) {
        truncated = name.substring(0, i) + '..'
        const newSvg = d3.select('body').append('svg')
          .style('position', 'absolute')
          .style('visibility', 'hidden')
          .style('pointer-events', 'none')
        const newText = newSvg.append('text')
          .attr('font-size', isMobile ? '10' : '11')
          .attr('font-weight', '500')
          .text(truncated)
        if (newText.node().getComputedTextLength() <= maxWidth) {
          newSvg.remove()
          return truncated
        }
        newSvg.remove()
      }
      return '..'
    }

    // Name and badge positioning - right-aligned with padding before bar
    // Calculate max width for name (accounting for badge and padding)
    const maxNameWidth = padding.left - badgeSize - badgeSpacing - badgeToBarPadding - 8 // Space for name before badge, with margin

    // Y-axis labels (player names) - middle aligned with bars, right-aligned with padding before bar
    yLabels.enter()
      .append('text')
      .attr('class', 'y-label')
      .attr('x', padding.left - badgeToBarPadding - badgeSpacing - badgeSize) // Right edge of badge area (with padding)
      .attr('y', (d, i) => padding.top + yScale(i) + yScale.bandwidth() / 2)
      .attr('dy', '0.35em') // Vertical alignment adjustment for middle alignment
      .attr('text-anchor', 'end') // Right-align text
      .attr('font-size', isMobile ? '10' : '11')
      .attr('fill', 'var(--text-primary)')
      .attr('font-weight', '500')
      .attr('letter-spacing', '0.01em')
      .text(d => truncateName(d.player_name, maxNameWidth))

    // Add team badges after player names - use enter/update/exit pattern
    // Only bind data for players with team_short_name
    const playersWithTeams = sortedData.filter(d => d.team_short_name)
    const badges = g.selectAll('.team-badge')
      .data(playersWithTeams, d => d.player_id)

    // Helper to get text width for positioning badge after name
    const getTextWidth = (text, fontSize) => {
      const tempSvg = d3.select('body').append('svg')
        .style('position', 'absolute')
        .style('visibility', 'hidden')
        .style('pointer-events', 'none')
      const tempText = tempSvg.append('text')
        .attr('font-size', fontSize)
        .attr('font-weight', '500')
        .text(text)
      const width = tempText.node().getComputedTextLength()
      tempSvg.remove()
      return width
    }

    const badgesEnter = badges.enter()
      .append('image')
      .attr('class', 'team-badge')
      .attr('x', padding.left - badgeToBarPadding - badgeSize) // Badge with padding before bar edge
      .attr('y', (d, i) => {
        const dataIndex = sortedData.findIndex(item => item.player_id === d.player_id)
        return padding.top + yScale(dataIndex) + (yScale.bandwidth() - badgeSize) / 2
      })
      .attr('width', badgeSize)
      .attr('height', badgeSize)
      .attr('href', d => `/badges/${d.team_short_name}.svg`)
      .attr('xlink:href', d => `/badges/${d.team_short_name}.svg`) // Fallback for older browsers
      .on('error', function(event, d) {
        // Hide badge if image fails to load
        console.warn('Badge failed to load:', d?.team_short_name, d3.select(this).attr('href'))
        d3.select(this).style('display', 'none')
      })

    // Update existing badges
    badgesEnter.merge(badges)
      .attr('x', padding.left - badgeToBarPadding - badgeSize) // Badge with padding before bar edge
      .attr('y', (d, i) => {
        const dataIndex = sortedData.findIndex(item => item.player_id === d.player_id)
        return padding.top + yScale(dataIndex) + (yScale.bandwidth() - badgeSize) / 2
      })
      .attr('width', badgeSize)
      .attr('height', badgeSize)
      .attr('href', d => `/badges/${d.team_short_name}.svg`)
      .attr('xlink:href', d => `/badges/${d.team_short_name}.svg`)
      .style('display', null) // Show if it was hidden due to error

    // Remove badges that are no longer in data
    badges.exit()
      .remove()

    // Axes lines
    g.append('line')
      .attr('class', 'x-axis')
      .attr('x1', padding.left)
      .attr('y1', height - padding.bottom)
      .attr('x2', width - padding.right)
      .attr('y2', height - padding.bottom)
      .attr('stroke', 'var(--border-color)')
      .attr('stroke-width', 1)
      .attr('opacity', 0.5)

    g.append('line')
      .attr('class', 'y-axis')
      .attr('x1', padding.left)
      .attr('y1', padding.top)
      .attr('x2', padding.left)
      .attr('y2', height - padding.bottom)
      .attr('stroke', 'var(--border-color)')
      .attr('stroke-width', 1)
      .attr('opacity', 0.5)

    // Tooltip
    const tooltip = d3.select('body').selectAll('.chart-tooltip')
      .data([1])
    
    tooltip.enter()
      .append('div')
      .attr('class', 'chart-tooltip')
      .style('position', 'absolute')
      .style('padding', '8px 12px')
      .style('background', 'var(--bg-card)')
      .style('border', '1px solid var(--border-color)')
      .style('border-radius', '6px')
      .style('font-size', '11px')
      .style('pointer-events', 'none')
      .style('opacity', 0)
      .style('z-index', 1000)
      .style('box-shadow', '0 4px 6px rgba(0, 0, 0, 0.1)')

    // Bars - Starting points (main bar)
    const bars = g.selectAll('.bar-starting')
      .data(sortedData)

    bars.enter()
      .append('rect')
      .attr('class', 'bar-starting')
      .attr('x', padding.left)
      .attr('y', (d, i) => padding.top + yScale(i))
      .attr('width', 0)
      .attr('height', yScale.bandwidth())
      .attr('fill', d => getColorForPercentage(d.percentage_of_total_points || 0))
      .attr('rx', 2)
      .on('mouseover', function(event, d) {
        d3.select(this).attr('opacity', 0.8)
        
        tooltip
          .style('opacity', 1)
          .html(`
            <div style="font-weight: 600; margin-bottom: 4px;">${d.player_name}</div>
            <div>Points: <strong>${formatNumber(d.total_points || 0)}</strong></div>
            ${d.percentage_of_total_points ? `<div>% of Total: <strong>${d.percentage_of_total_points}%</strong></div>` : ''}
            <div style="margin-top: 4px; font-size: 10px; color: var(--text-secondary);">
              Owned: ${d.gameweeks_owned} GW${d.gameweeks_owned !== 1 ? 's' : ''}
            </div>
          `)
      })
      .on('mousemove', function(event) {
        tooltip
          .style('left', (event.pageX + 10) + 'px')
          .style('top', (event.pageY - 10) + 'px')
      })
      .on('mouseout', function() {
        d3.select(this).attr('opacity', 1)
        tooltip.style('opacity', 0)
      })
      .transition()
      .duration(800)
      .ease(d3.easeCubicOut)
      .attr('width', d => xScale(d.total_points || 0))

    // Add text labels inside/at end of bars (points only)
    const barLabels = g.selectAll('.bar-label')
      .data(sortedData)

    const barLabelsEnter = barLabels.enter()
      .append('text')
      .attr('class', 'bar-label')
      .attr('x', padding.left) // Start at the left edge (where bar starts)
      .attr('y', (d, i) => padding.top + yScale(i) + yScale.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'start') // Start with left alignment
      .attr('font-size', isMobile ? '9' : '10')
      .attr('font-weight', '600')
      .attr('fill', (d, i) => {
        const barWidth = xScale(d.total_points || 0)
        // If text is inside bar, use white for contrast; if outside, use text color
        if (barWidth >= 40) {
          return '#ffffff' // White for inside bars (with text shadow for legibility)
        } else {
          return 'var(--text-primary)' // Normal text color for outside
        }
      })
      .style('text-shadow', (d, i) => {
        const barWidth = xScale(d.total_points || 0)
        // Add text shadow for better legibility, especially for white text on colored bars
        if (barWidth >= 40) {
          return '0 1px 2px rgba(0, 0, 0, 0.4), 0 0 1px rgba(0, 0, 0, 0.3)'
        }
        return 'none'
      })
      .attr('opacity', 0) // Start invisible
      .attr('pointer-events', 'none')
      .text(d => {
        const points = formatNumber(d.total_points || 0)
        return points
      })

    // Update existing labels - animate in sync with bars
    barLabelsEnter.merge(barLabels)
      .transition()
      .duration(800)
      .ease(d3.easeCubicOut)
      .attr('opacity', 1) // Fade in
      .attr('x', (d, i) => {
        const barWidth = xScale(d.total_points || 0)
        const minWidthForInside = 40 // Match enter threshold
        if (barWidth >= minWidthForInside) {
          return padding.left + barWidth - 6
        } else {
          return padding.left + barWidth + 4
        }
      })
      .attr('y', (d, i) => padding.top + yScale(i) + yScale.bandwidth() / 2)
      .attr('text-anchor', (d, i) => {
        const barWidth = xScale(d.total_points || 0)
        return barWidth >= 40 ? 'end' : 'start' // Match minWidthForInside
      })
      .attr('fill', (d, i) => {
        const barWidth = xScale(d.total_points || 0)
        if (barWidth >= 40) {
          return '#ffffff'
        } else {
          return 'var(--text-primary)'
        }
      })
      .style('text-shadow', (d, i) => {
        const barWidth = xScale(d.total_points || 0)
        if (barWidth >= 40) {
          return '0 1px 2px rgba(0, 0, 0, 0.4), 0 0 1px rgba(0, 0, 0, 0.3)'
        }
        return 'none'
      })
      .text(d => {
        const points = formatNumber(d.total_points || 0)
        // Always show points (positioning handles narrow bars)
        return points
      })

    barLabels.exit()
      .remove()

  }, [])


  // Calculate required height for bar chart
  // Allow overflow - calculate based on number of players, not container height
  const barChartHeight = useMemo(() => {
    if (sortedData.length === 0) return dimensions.height
    
    const padding = {
      top: Math.round(dimensions.height * 0.03),
      bottom: Math.round(dimensions.height * 0.08)
    }
    
    const minBarHeight = 20
    const barSpacing = 4
    // Calculate height needed for all players, allow overflow for scrolling
    const minChartHeight = sortedData.length * (minBarHeight + barSpacing) + padding.top + padding.bottom
    // Always return the calculated height (may be larger than container)
    return minChartHeight
  }, [sortedData.length, dimensions.height])

  // Render chart with D3
  useEffect(() => {
    if (!svgRef.current || sortedData.length === 0 || loading) return

    // Debug: Check if team data is in sortedData
    console.log('Rendering chart with data:', sortedData.length, 'players')
    const playersWithTeam = sortedData.filter(d => d.team_short_name)
    console.log('Players with team badges:', playersWithTeam.length, playersWithTeam.map(d => ({ name: d.player_name, team: d.team_short_name })))

    // Clear previous render
    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    // Set SVG height for bar chart (may exceed container - enables scrolling)
    svg.attr('height', barChartHeight)
      .attr('viewBox', `0 0 ${dimensions.width} ${barChartHeight}`)

    renderBarChart(svg, sortedData, dimensions, isMobile)
  }, [sortedData, dimensions, loading, isMobile, renderBarChart, barChartHeight])

  if (loading) {
    return (
      <div className="player-performance-chart-container">
        <div className="chart-loading">
          <div className="skeleton-text"></div>
        </div>
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <div className="player-performance-chart-container">
        <div className="chart-loading">
          <div style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
            No player data available
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="player-performance-chart-container" ref={containerRef}>
      {/* Controls Container - Filter buttons on left, Exclude Haaland on right */}
      <div className="chart-controls-wrapper">
        <div className="chart-filter-controls">
          {onFilterChange && (
            <>
              <button
                className={`chart-filter-btn ${filter === 'all' ? 'active' : ''}`}
                onClick={() => onFilterChange('all')}
              >
                All
              </button>
              <button
                className={`chart-filter-btn ${filter === 'last12' ? 'active' : ''}`}
                onClick={() => onFilterChange('last12')}
              >
                Last 12
              </button>
              <button
                className={`chart-filter-btn ${filter === 'last6' ? 'active' : ''}`}
                onClick={() => onFilterChange('last6')}
              >
                Last 6
              </button>
            </>
          )}
          <div className="chart-filter-separator"></div>
          <button
            className={`chart-filter-btn chart-filter-btn-exclude ${excludeHaaland ? 'active' : ''}`}
            onClick={() => setExcludeHaaland(!excludeHaaland)}
            title="Exclude Haaland from view and recalculate percentages"
          >
            Exclude Haaland
          </button>
        </div>
      </div>
      <div className="player-performance-chart-scrollable">
        <svg 
          ref={svgRef}
          width="100%"
          height={barChartHeight}
          viewBox={`0 0 ${dimensions.width} ${barChartHeight}`}
          preserveAspectRatio="xMidYMin meet"
          className="player-performance-chart"
          style={{ overflow: 'visible' }}
        />
      </div>
    </div>
  )
}
