import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

function formatDateTime(iso) {
  if (!iso) return null
  try {
    const d = new Date(iso.replace('Z', '+00:00'))
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return null
  }
}

export default function NextDeadlineStatement({ refreshState }) {
  const deadlineRefetchIntervalMs =
    refreshState === 'gw_setup' || refreshState === 'fpl_updating' ? 10_000 : 30_000

  const { data: nextGw, refetch } = useQuery({
    queryKey: ['gameweek', 'next', 'deadline-statement'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gameweeks')
        .select('id, deadline_time')
        .eq('is_next', true)
        .single()
      if (error) return null
      return data
    },
    staleTime: 0,
    refetchInterval: deadlineRefetchIntervalMs,
    refetchIntervalInBackground: true,
  })

  useEffect(() => {
    if (refreshState === 'gw_setup' || refreshState === 'fpl_updating') {
      refetch()
    }
  }, [refreshState, refetch])

  const loading = nextGw == null
  const text = useMemo(() => {
    const nextId = nextGw?.id ?? '—'
    const formatted = formatDateTime(nextGw?.deadline_time)
    return `Gameweek ${nextId} Deadline: ${formatted ?? '—'}`
  }, [nextGw?.id, nextGw?.deadline_time])

  return (
    <div className="home-page-next-deadline" aria-live="polite" aria-busy={loading}>
      {text}
    </div>
  )
}

