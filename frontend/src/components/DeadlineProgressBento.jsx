import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import './DeadlineProgressBento.css'

/** Hours per square so a 7-day week fits in ~28 squares (one per 6h) */
const HOURS_PER_SQUARE = 6
const MIN_SQUARES = 12
const MAX_SQUARES = 56

function parseDeadline(iso) {
  if (!iso) return null
  try {
    return new Date(iso.replace('Z', '+00:00')).getTime()
  } catch {
    return null
  }
}

export default function DeadlineProgressBento({ className = '', style = {} }) {
  const { data: currentGw } = useQuery({
    queryKey: ['gameweek', 'current', 'deadline'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gameweeks')
        .select('id, name, deadline_time')
        .eq('is_current', true)
        .single()
      if (error) return null
      return data
    },
    staleTime: 5 * 60 * 1000,
  })

  const { data: nextGw } = useQuery({
    queryKey: ['gameweek', 'next'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gameweeks')
        .select('id, name, deadline_time')
        .eq('is_next', true)
        .single()
      if (error) return null
      return data
    },
    staleTime: 5 * 60 * 1000,
  })

  const { totalSquares, filledSquares, totalHours, elapsedHours, nextDeadlineLabel, nextDeadlineFullText } = useMemo(() => {
    const currentDeadlineMs = parseDeadline(currentGw?.deadline_time)
    const nextDeadlineMs = parseDeadline(nextGw?.deadline_time)
    const rawName = nextGw?.name?.trim() || (nextGw?.id != null ? `GW${nextGw.id}` : '')
    const name = rawName.replace(/^Gameweek\s*/i, 'GW')
    let dateFormatted = ''
    if (nextGw?.deadline_time) {
      try {
        const d = new Date(nextGw.deadline_time.replace('Z', '+00:00'))
        dateFormatted = d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
      } catch (_) {}
    }
    const nextDeadlineFullText = dateFormatted ? `Next deadline: ${dateFormatted}` : ''

    if (currentDeadlineMs == null || nextDeadlineMs == null) {
      return { totalSquares: 0, filledSquares: 0, totalHours: 0, elapsedHours: 0, nextDeadlineLabel: name, nextDeadlineFullText }
    }
    const now = Date.now()
    const totalMs = nextDeadlineMs - currentDeadlineMs
    const totalHours = totalMs / (1000 * 60 * 60)
    const elapsedMs = Math.max(0, now - currentDeadlineMs)
    const elapsedHours = Math.min(totalHours, elapsedMs / (1000 * 60 * 60))

    const rawSquares = totalHours / HOURS_PER_SQUARE
    const totalSquares = Math.max(
      MIN_SQUARES,
      Math.min(MAX_SQUARES, Math.round(rawSquares))
    )
    const filledRatio = totalHours > 0 ? elapsedHours / totalHours : 0
    const filledSquares = Math.min(totalSquares, Math.max(0, Math.floor(filledRatio * totalSquares)))

    return { totalSquares, filledSquares, totalHours, elapsedHours, nextDeadlineLabel: name, nextDeadlineFullText }
  }, [currentGw?.deadline_time, nextGw?.deadline_time, nextGw?.name, nextGw?.id])

  const squares = useMemo(() => {
    return Array.from({ length: totalSquares }, (_, i) => ({ filled: i < filledSquares }))
  }, [totalSquares, filledSquares])

  const subtext = useMemo(() => {
    if (totalHours <= 0) return null
    const remaining = totalHours - elapsedHours
    if (remaining <= 0) return 'Deadline passed'
    const h = Math.floor(remaining)
    const m = Math.round((remaining - h) * 60)
    if (h >= 24) {
      const d = Math.floor(h / 24)
      const hr = h % 24
      return `${d}d ${hr}h left`
    }
    return m > 0 ? `${h}h ${m}m left` : `${h}h left`
  }, [totalHours, elapsedHours])

  const loading = !currentGw && !nextGw

  return (
    <div
      className={`deadline-progress-bento bento-card bento-card-animate ${className}`.trim()}
      style={style}
      aria-labelledby="deadline-progress-heading"
    >
      <div className="deadline-progress-bento-header">
        <h2 id="deadline-progress-heading" className="bento-card-label">
          {nextDeadlineFullText || 'Next deadline'}
        </h2>
        {subtext && <span className="deadline-progress-bento-subtext">{subtext}</span>}
      </div>
      <div className="deadline-progress-bento-inner" aria-hidden>
        {loading ? (
          <div className="bento-card-value loading" aria-busy="true" />
        ) : (
          <div
            className="deadline-progress-grid"
            role="img"
            aria-label={`${filledSquares} of ${totalSquares} periods elapsed until ${nextDeadlineLabel}`}
          >
            {squares.map((cell, i) => (
              <div
                key={i}
                className={`deadline-progress-cell ${cell.filled ? 'deadline-progress-cell--filled' : ''}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
