import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import './DeadlineProgressBento.css'

function formatDateTime(iso) {
  if (!iso) return null
  try {
    const d = new Date(iso.replace('Z', '+00:00'))
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return null
  }
}

export default function DeadlineProgressBento({ className = '', style = {}, animateEntrance = false }) {
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
    // Poll so the displayed "next gameweek" flips right after the deadline passes.
    staleTime: 0,
    refetchInterval: 30 * 1000,
    refetchIntervalInBackground: true,
  })

  const loading = nextGw == null
  const nextDeadlineText = useMemo(() => {
    const nextGwId = nextGw?.id ?? null
    const formatted = formatDateTime(nextGw?.deadline_time)
    if (!formatted) return `gameweek ${nextGwId ?? '—'} deadline: —`
    return `Gameweek ${nextGwId} deadline: ${formatted}`
  }, [nextGw?.deadline_time])

  return (
    <div
      className="next-gameweek-deadline-text-bento"
      style={style}
      aria-live="polite"
      aria-busy={loading}
    >
      <div className="next-gameweek-deadline-text">{nextDeadlineText}</div>
    </div>
  )
}
