import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useConfiguration } from '../contexts/ConfigurationContext'

/**
 * Hook to fetch captain and vice-captain picks for all managers in the configured league
 * for the current gameweek. Returns array of { manager_id, rank, manager_team_name, captain_name, vice_captain_name }
 * sorted by rank ascending (same shape as expanded league rank).
 */
export function useLeagueCaptainPicks(gameweek = null) {
  const { config } = useConfiguration()
  const LEAGUE_ID = config?.leagueId || import.meta.env.VITE_LEAGUE_ID || null

  const { data: leagueCaptainData, isLoading, error } = useQuery({
    queryKey: ['league-captain-picks', LEAGUE_ID, gameweek],
    queryFn: async () => {
      if (!LEAGUE_ID || !gameweek) return []

      const { data: standings, error: standingsError } = await supabase
        .from('mv_mini_league_standings')
        .select('manager_id, manager_name, manager_team_name, calculated_rank, mini_league_rank')
        .eq('league_id', LEAGUE_ID)
        .eq('gameweek', gameweek)
        .order('calculated_rank', { ascending: true })

      if (standingsError) {
        console.warn('[useLeagueCaptainPicks] standings error:', standingsError)
        return []
      }
      if (!standings?.length) return []

      const managerIds = standings.map(s => s.manager_id)

      const { data: picks, error: picksError } = await supabase
        .from('manager_picks')
        .select('manager_id, player_id, is_captain, is_vice_captain, players(web_name, teams!fk_players_team(short_name))')
        .in('manager_id', managerIds)
        .eq('gameweek', gameweek)
        .or('is_captain.eq.true,is_vice_captain.eq.true')

      if (picksError) {
        console.warn('[useLeagueCaptainPicks] picks error:', picksError)
        return standings.map(s => {
          const displayName = (s.manager_team_name && s.manager_team_name.trim())
            ? s.manager_team_name
            : (s.manager_name || `Manager ${s.manager_id}`)
          return {
            manager_id: s.manager_id,
            rank: s.calculated_rank ?? s.mini_league_rank ?? null,
            manager_team_name: displayName,
            captain_name: '—',
            vice_captain_name: '—',
            captain_team_short_name: null,
            vice_captain_team_short_name: null,
            captain_dnp: false,
            vice_captain_dnp: false
          }
        })
      }

      const byManager = {}
      const captainVicePlayerIds = new Set()
      ;(picks || []).forEach(p => {
        if (!byManager[p.manager_id]) {
          byManager[p.manager_id] = {
            captain_name: null,
            vice_captain_name: null,
            captain_team_short_name: null,
            vice_captain_team_short_name: null,
            captain_player_id: null,
            vice_player_id: null
          }
        }
        const name = p.players?.web_name ?? '—'
        const teamShortName = p.players?.teams?.short_name ?? null
        if (p.is_captain) {
          byManager[p.manager_id].captain_name = name
          byManager[p.manager_id].captain_team_short_name = teamShortName
          byManager[p.manager_id].captain_player_id = p.player_id
          if (p.player_id != null) captainVicePlayerIds.add(p.player_id)
        }
        if (p.is_vice_captain) {
          byManager[p.manager_id].vice_captain_name = name
          byManager[p.manager_id].vice_captain_team_short_name = teamShortName
          byManager[p.manager_id].vice_player_id = p.player_id
          if (p.player_id != null) captainVicePlayerIds.add(p.player_id)
        }
      })

      let dnpByPlayerId = {}
      if (captainVicePlayerIds.size > 0) {
        const { data: statsRows } = await supabase
          .from('player_gameweek_stats')
          .select('player_id, minutes, match_finished, match_finished_provisional')
          .eq('gameweek', gameweek)
          .in('player_id', Array.from(captainVicePlayerIds))
        const statsByPlayer = {}
        ;(statsRows || []).forEach((r) => {
          const pid = r.player_id
          if (!statsByPlayer[pid]) statsByPlayer[pid] = []
          statsByPlayer[pid].push(r)
        })
        captainVicePlayerIds.forEach((pid) => {
          const rows = statsByPlayer[pid] || []
          const anyFinished = rows.some((r) => r.match_finished || r.match_finished_provisional)
          const totalMinutes = rows.reduce((s, r) => s + (r.minutes ?? 0), 0)
          dnpByPlayerId[pid] = !!(anyFinished && totalMinutes === 0)
        })
      }

      return standings.map(s => {
        const caps = byManager[s.manager_id] || {
          captain_name: null,
          vice_captain_name: null,
          captain_team_short_name: null,
          vice_captain_team_short_name: null,
          captain_player_id: null,
          vice_player_id: null
        }
        const displayName = (s.manager_team_name && s.manager_team_name.trim())
          ? s.manager_team_name
          : (s.manager_name || `Manager ${s.manager_id}`)
        return {
          manager_id: s.manager_id,
          rank: s.calculated_rank ?? s.mini_league_rank ?? null,
          manager_team_name: displayName,
          captain_name: caps.captain_name ?? '—',
          vice_captain_name: caps.vice_captain_name ?? '—',
          captain_team_short_name: caps.captain_team_short_name ?? null,
          vice_captain_team_short_name: caps.vice_captain_team_short_name ?? null,
          captain_dnp: caps.captain_player_id != null ? !!(dnpByPlayerId[caps.captain_player_id]) : false,
          vice_captain_dnp: caps.vice_player_id != null ? !!(dnpByPlayerId[caps.vice_player_id]) : false
        }
      })
    },
    enabled: !!LEAGUE_ID && !!gameweek,
    staleTime: 60000,
    refetchInterval: 60000
  })

  return {
    leagueCaptainData: leagueCaptainData ?? [],
    loading: isLoading,
    error
  }
}
