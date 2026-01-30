import { useQuery } from '@tanstack/react-query'
import { useGameweekData } from './useGameweekData'
import { supabase } from '../lib/supabase'

/**
 * For each stat column, returns the set of player_id that are in the top 10 for that stat in the gameweek.
 * Used so the green "top 10" badge is only shown when the player is actually top 10 for that specific column.
 */
function computeTop10ByStat(rows) {
  const out = {
    pts: new Set(),
    goals: new Set(),
    assists: new Set(),
    clean_sheets: new Set(),
    saves: new Set(),
    bps: new Set(),
    bonus: new Set(),
    defensive_contribution: new Set(),
    yellow_cards: new Set(),
    red_cards: new Set()
  }
  if (!rows || rows.length === 0) return out

  const keyToCol = {
    pts: 'total_points',
    goals: 'goals_scored',
    assists: 'assists',
    clean_sheets: 'clean_sheets',
    saves: 'saves',
    bps: 'bps',
    bonus: 'bonus',
    defensive_contribution: 'defensive_contribution',
    yellow_cards: 'yellow_cards',
    red_cards: 'red_cards'
  }

  for (const statKey of Object.keys(keyToCol)) {
    const col = keyToCol[statKey]
    const sorted = [...rows].sort((a, b) => (Number(b[col]) || 0) - (Number(a[col]) || 0))
    const top10 = sorted.slice(0, 10)
    top10.forEach((row) => {
      const id = row.player_id
      if (id != null) out[statKey].add(Number(id))
    })
  }

  return out
}

/**
 * Returns { top10ByStat } where each value is a Set of player_id in the top 10 for that stat in the gameweek.
 */
export function useGameweekTop10ByStat() {
  const { gameweek, loading: gwLoading } = useGameweekData()

  const { data: top10ByStat, isLoading } = useQuery({
    queryKey: ['gameweek-top10-by-stat', gameweek],
    queryFn: async () => {
      if (!gameweek) return computeTop10ByStat([])

      const { data, error } = await supabase
        .from('player_gameweek_stats')
        .select(
          'player_id, total_points, goals_scored, assists, clean_sheets, saves, bps, bonus, defensive_contribution, yellow_cards, red_cards'
        )
        .eq('gameweek', gameweek)

      if (error) {
        console.error('Error fetching gameweek stats for top 10 by stat:', error)
        return computeTop10ByStat([])
      }

      return computeTop10ByStat(data || [])
    },
    enabled: !!gameweek && !gwLoading,
    staleTime: 60 * 1000
  })

  return {
    top10ByStat: top10ByStat ?? computeTop10ByStat([]),
    isLoading: isLoading || gwLoading
  }
}
