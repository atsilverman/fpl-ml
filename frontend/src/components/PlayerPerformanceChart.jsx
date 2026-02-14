import { useEffect, useMemo, useState } from 'react'
import { formatNumber } from '../utils/formatNumbers'
import { useToast } from '../contexts/ToastContext'
import './PlayerPerformanceChart.css'

const MOBILE_BREAKPOINT = 768
/** Bar width % above which we place the value inside the bar (right-aligned); below this, place after the bar. */
const VALUE_ON_BAR_THRESHOLD_DESKTOP = 82
const VALUE_ON_BAR_THRESHOLD_MOBILE = 72
const VALUE_ON_BAR_THRESHOLD_DESKTOP_EXCLUDE_HAALAND = 80
const VALUE_ON_BAR_THRESHOLD_MOBILE_EXCLUDE_HAALAND = 70

const MAX_NAME_LENGTH = 12

/** Abbreviate long player names for display (e.g. "Bruno Fernandes" → "B.Fernandes"); full name in title. */
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

/**
 * Total points bar chart – points per gameweek range (All / Last 12 / Last 6).
 * Renders a simple horizontal bar chart across the bento; no D3, CSS-based bars.
 */
export default function PlayerPerformanceChart({
  data = [],
  loading = false,
  filter = 'all',
  onFilterChange = null,
}) {
  const [excludeHaaland, setExcludeHaaland] = useState(false)
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth <= MOBILE_BREAKPOINT)
  const { toast } = useToast()

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= MOBILE_BREAKPOINT)
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  const { sortedData, maxPoints, maxPercentage } = useMemo(() => {
    if (!data || data.length === 0) {
      return { sortedData: [], maxPoints: 1, maxPercentage: 1 }
    }

    let list = data
    if (excludeHaaland) {
      list = data.filter(
        (p) =>
          !p.player_name || p.player_name.toLowerCase() !== 'haaland'
      )
      if (list.length > 0) {
        const total = list.reduce((s, p) => s + (p.total_points || 0), 0)
        list = list.map((p) => ({
          ...p,
          percentage_of_total_points:
            total > 0
              ? Math.round(((p.total_points || 0) / total) * 100 * 100) / 100
              : 0,
        }))
      }
    }

    const sorted = [...list].sort(
      (a, b) => (b.total_points || 0) - (a.total_points || 0)
    )
    const maxP = Math.max(
      ...sorted.map((d) => d.total_points || 0),
      1
    )
    const maxPct = Math.max(
      ...sorted.map((d) => d.percentage_of_total_points || 0),
      1
    )
    return { sortedData: sorted, maxPoints: maxP, maxPercentage: maxPct }
  }, [data, excludeHaaland])

  const barWidthPercent = (points) =>
    maxPoints > 0 ? Math.min(100, (points / maxPoints) * 100) : 0

  const barColor = (pct) => {
    if (!pct || maxPercentage <= 0) return 'var(--total-points-bar-low, #5B8DEF)'
    const t = Math.min(1, pct / maxPercentage)
    return t >= 1
      ? 'var(--total-points-bar-high, #2D6BEC)'
      : 'var(--total-points-bar-mid, #3d7aed)'
  }

  if (loading) {
    return (
      <div className="total-points-chart total-points-chart--loading">
        <div className="total-points-chart__skeleton" />
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <div className="total-points-chart">
        <div className="total-points-chart__empty">
          No player data for this gameweek range
        </div>
      </div>
    )
  }

  return (
    <div className="total-points-chart">
      <div className="total-points-chart__bars" role="list">
          {sortedData.map((player) => {
            const points = player.total_points || 0
            const pct = player.percentage_of_total_points || 0
            const widthPct = barWidthPercent(points)
            const threshold = excludeHaaland
              ? (isMobile ? VALUE_ON_BAR_THRESHOLD_MOBILE_EXCLUDE_HAALAND : VALUE_ON_BAR_THRESHOLD_DESKTOP_EXCLUDE_HAALAND)
              : (isMobile ? VALUE_ON_BAR_THRESHOLD_MOBILE : VALUE_ON_BAR_THRESHOLD_DESKTOP)
            const valueOnBar = widthPct >= threshold
            const valueStyle = valueOnBar
              ? undefined
              : { left: `${widthPct}%`, marginLeft: isMobile ? 6 : 8, right: 'auto' }
            return (
              <div
                key={player.player_id}
                className="total-points-chart__row"
                role="listitem"
              >
                <div className="total-points-chart__label">
                  <span className="total-points-chart__name" title={player.player_name}>
                    {abbreviateName(player.player_name)}
                  </span>
                  {player.team_short_name && (
                    <img
                      className="total-points-chart__badge"
                      src={`/badges/${player.team_short_name}.svg`}
                      alt=""
                      width={16}
                      height={16}
                      onError={(e) => {
                        e.target.style.display = 'none'
                      }}
                    />
                  )}
                </div>
                <div className="total-points-chart__track">
                  <div
                    className="total-points-chart__fill"
                    style={{
                      width: `${widthPct}%`,
                      backgroundColor: barColor(pct),
                    }}
                    title={`${player.player_name}: ${formatNumber(points)} pts`}
                  />
                  <span
                    className={`total-points-chart__value ${valueOnBar ? 'total-points-chart__value--on-bar' : 'total-points-chart__value--after-bar'}`}
                    style={valueStyle}
                  >
                    {formatNumber(points)}
                  </span>
                </div>
              </div>
            )
          })}
      </div>

      <div className="total-points-chart__controls">
        {onFilterChange && (
          <>
            <button
              type="button"
              className={`total-points-chart__btn ${filter === 'all' ? 'active' : ''}`}
              onClick={() => {
                onFilterChange('all')
                toast('Showing all gameweeks')
              }}
            >
              All
            </button>
            <button
              type="button"
              className={`total-points-chart__btn ${filter === 'last12' ? 'active' : ''}`}
              onClick={() => {
                onFilterChange('last12')
                toast('Showing last 12 gameweeks')
              }}
            >
              Last 12
            </button>
            <button
              type="button"
              className={`total-points-chart__btn ${filter === 'last6' ? 'active' : ''}`}
              onClick={() => {
                onFilterChange('last6')
                toast('Showing last 6 gameweeks')
              }}
            >
              Last 6
            </button>
            <span className="total-points-chart__separator" aria-hidden />
          </>
        )}
        <button
          type="button"
          className={`total-points-chart__btn total-points-chart__btn--exclude ${excludeHaaland ? 'active' : ''}`}
          onClick={() => {
            setExcludeHaaland((prev) => !prev)
            toast(excludeHaaland ? 'Including Haaland' : 'Excluding Haaland')
          }}
          title="Exclude Haaland from view and recalculate percentages"
        >
          Exclude Haaland
        </button>
      </div>
    </div>
  )
}
