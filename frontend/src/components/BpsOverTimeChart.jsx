import { useMemo } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { useBpsSnapshots } from '../hooks/useBpsSnapshots'
import './BpsOverTimeChart.css'

/** Stroke color by bonus – only top 3 (3/2/1) get color; rest muted like team moving avg. */
const BONUS_COLORS = {
  3: 'var(--bonus-1st)',
  2: 'var(--bonus-2nd)',
  1: 'var(--bonus-3rd)',
}
const DEMOTED_LINE_COLOR = 'rgba(148, 163, 184, 0.35)'

/** Format time for axis/tooltip: short time or time + date if multi-day. */
function formatRecordedAt(isoString) {
  if (!isoString) return '—'
  const d = new Date(isoString)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true })
}

/** Tooltip that only shows bonus players. */
function BpsTooltipContent({ active, payload, label, playerNamesByKey, isBonusByKey }) {
  if (!active || !payload?.length) return null
  const bonusPayload = payload.filter((entry) => isBonusByKey[entry.dataKey])
  if (!bonusPayload.length) return null
  return (
    <div
      className="bps-over-time-chart-tooltip"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-color)',
        borderRadius: 8,
        fontSize: 11,
        padding: '8px 10px',
      }}
    >
      <div style={{ marginBottom: 4, color: 'var(--text-secondary)' }}>
        {formatRecordedAt(label)}
      </div>
      {bonusPayload.map((entry) => (
        <div key={entry.dataKey} style={{ color: entry.color }}>
          {playerNamesByKey[entry.dataKey] ?? entry.dataKey}: {entry.value ?? '—'}
        </div>
      ))}
    </div>
  )
}

/**
 * BPS over time (one line per player), colorized by bonus.
 * Data from bps_snapshots; empty state when no snapshots yet.
 */
export default function BpsOverTimeChart({ fixtureId, gameweek, players = [], enabled = true }) {
  const { data: snapshots, loading } = useBpsSnapshots(fixtureId, gameweek, enabled)

  const { chartData, playerKeys, playerNamesByKey, strokeByKey, strokeWidthByKey, isBonusByKey, bonusValueByKey } = useMemo(() => {
    if (!snapshots?.length) {
      return { chartData: [], playerKeys: [], playerNamesByKey: {}, strokeByKey: {}, strokeWidthByKey: {}, isBonusByKey: {}, bonusValueByKey: {} }
    }
    const times = [...new Set(snapshots.map((r) => r.recorded_at))].sort()
    const playerById = Object.fromEntries((players ?? []).map((p) => [p.player_id, p]))
    /* Effective bonus by player: use confirmed bonus, else infer from BPS rank (players is sorted by BPS desc). */
    const bonusByPid = {}
    ;(players ?? []).forEach((p, idx) => {
      const pid = p?.player_id
      if (pid == null) return
      const confirmed = p?.bonus ?? 0
      bonusByPid[pid] = (confirmed >= 1 && confirmed <= 3) ? confirmed : (idx < 3 ? (3 - idx) : 0)
    })
    const playerKeys = [...new Set(snapshots.map((r) => r.player_id))]
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
    const chartData = times.map((t) => {
      const point = { time: t, recorded_at: t }
      snapshots.filter((r) => r.recorded_at === t).forEach((r) => { point[r.player_id] = r.bps })
      return point
    })
    return { chartData, playerKeys, playerNamesByKey, strokeByKey, strokeWidthByKey, isBonusByKey, bonusValueByKey }
  }, [snapshots, players])

  const xAxisTicks = useMemo(() => {
    if (!chartData.length) return []
    const first = chartData[0].time
    const last = chartData[chartData.length - 1].time
    const midIdx = Math.floor(chartData.length / 2)
    const mid = chartData[midIdx]?.time
    if (first === last) return [first]
    return mid && mid !== first && mid !== last ? [first, mid, last] : [first, last]
  }, [chartData])

  const formatXAxisTick = (value) => {
    if (!value || !xAxisTicks.length) return ''
    if (value === xAxisTicks[0]) return 'Kickoff'
    if (value === xAxisTicks[xAxisTicks.length - 1]) return 'Full time'
    return 'Halftime'
  }

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
          BPS over time will appear here as we update during live matches.
        </p>
      </div>
    )
  }

  return (
    <div className="bps-over-time-chart">
      <ResponsiveContainer width="100%" height={340}>
        <LineChart
          data={chartData}
          margin={{ top: 8, right: 8, left: 0, bottom: 4 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
          <XAxis
            dataKey="time"
            tickFormatter={formatRecordedAt}
            tick={{ fontSize: 10, fill: 'var(--text-secondary)' }}
            stroke="var(--text-tertiary)"
          />
          <YAxis
            domain={[0, 'auto']}
            tick={{ fontSize: 10, fill: 'var(--text-secondary)' }}
            stroke="var(--text-tertiary)"
            width={28}
          />
          <Tooltip
            content={({ active, payload, label }) => (
              <BpsTooltipContent
                active={active}
                payload={payload}
                label={label}
                playerNamesByKey={playerNamesByKey}
                isBonusByKey={isBonusByKey}
              />
            )}
          />
          <Legend
            wrapperStyle={{ fontSize: 10 }}
            formatter={(value) => {
              const name = playerNamesByKey[value] ?? value
              const bonus = bonusValueByKey[value]
              return bonus != null ? `${name} +${bonus}` : name
            }}
          />
          {playerKeys.map((key) => {
            const isBonus = isBonusByKey[key]
            return (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={strokeByKey[key]}
                strokeWidth={strokeWidthByKey[key] ?? 1}
                dot={isBonus ? { r: 2 } : false}
                activeDot={isBonus ? { r: 4 } : false}
                connectNulls
                name={key}
                legendType={isBonus ? 'line' : 'none'}
              />
            )
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
