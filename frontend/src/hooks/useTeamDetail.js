import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

/**
 * Fetches team detail for the team detail modal: team info,
 * gameweek-by-gameweek aggregated stats (sum of all players for that team)
 * in the same shape as usePlayerDetail's gameweekPoints for the chart,
 * and league rankings (PL table position, goals/xG/GC/xGC ranks 1-20).
 */
export function useTeamDetail(teamId, gameweek) {
  const main = useQuery({
    queryKey: ['team-detail', teamId, gameweek],
    queryFn: async () => {
      if (teamId == null || !gameweek) return null

      const numericTeamId = typeof teamId === 'string' ? Number(teamId) : teamId
      const isNumeric = Number.isFinite(numericTeamId)

      let resolvedTeamId = isNumeric ? numericTeamId : null
      let teamInfo = null

      if (isNumeric) {
        const teamRes = await supabase
          .from('teams')
          .select('team_id, short_name, team_name')
          .eq('team_id', numericTeamId)
          .maybeSingle()
        if (teamRes.error) throw teamRes.error
        teamInfo = teamRes.data
        resolvedTeamId = teamInfo?.team_id ?? numericTeamId
      } else {
        const teamRes = await supabase
          .from('teams')
          .select('team_id, short_name, team_name')
          .eq('short_name', teamId)
          .maybeSingle()
        if (teamRes.error) throw teamRes.error
        teamInfo = teamRes.data
        resolvedTeamId = teamInfo?.team_id ?? null
      }

      if (resolvedTeamId == null) return null

      const historyRes = await supabase
        .from('player_gameweek_stats')
        .select(
          'gameweek, total_points, goals_scored, assists, clean_sheets, saves, bps, bonus, defensive_contribution, yellow_cards, red_cards, expected_goals, expected_assists, expected_goal_involvements, opponent_team_id, opponent_team:teams!fk_pgws_opponent(short_name)'
        )
        .eq('team_id', resolvedTeamId)
        .lte('gameweek', gameweek)
        .order('gameweek', { ascending: true })

      if (historyRes.error) throw historyRes.error

      // GC and xGC: use RPC (MAX per fixture from def/GK) – summing player rows would double-count
      let gcXgcByGw = {}
      try {
        const { data: gcXgcData } = await supabase.rpc('get_team_gc_xgc_per_gameweek', {
          p_team_id: resolvedTeamId,
          p_max_gw: Number(gameweek) || 38,
          p_location: 'all'
        })
        if (gcXgcData?.length) {
          gcXgcByGw = Object.fromEntries(
            gcXgcData.map((row) => [
              row.gameweek,
              {
                goals_conceded: row.goals_conceded ?? 0,
                expected_goals_conceded: Number(row.expected_goals_conceded) ?? 0
              }
            ])
          )
        }
      } catch (e) {
        console.error('[useTeamDetail] get_team_gc_xgc_per_gameweek failed:', e)
      }

      const byGw = new Map()
      ;(historyRes.data || []).forEach((r) => {
        const gw = r.gameweek
        const cur = byGw.get(gw) || {
          points: 0,
          goals: 0,
          assists: 0,
          clean_sheets: 0,
          saves: 0,
          bps: 0,
          bonus: 0,
          defensive_contribution: 0,
          yellow_cards: 0,
          red_cards: 0,
          expected_goals: 0,
          expected_assists: 0,
          expected_goal_involvements: 0,
          opponent_short_name: r.opponent_team?.short_name ?? null,
        }
        cur.points += r.total_points ?? 0
        cur.goals += r.goals_scored ?? 0
        cur.assists += r.assists ?? 0
        cur.clean_sheets += r.clean_sheets ?? 0
        cur.saves += r.saves ?? 0
        cur.bps += r.bps ?? 0
        cur.bonus += r.bonus ?? 0
        cur.defensive_contribution += r.defensive_contribution ?? 0
        cur.yellow_cards += r.yellow_cards ?? 0
        cur.red_cards += r.red_cards ?? 0
        cur.expected_goals += Number(r.expected_goals) || 0
        cur.expected_assists += Number(r.expected_assists) || 0
        cur.expected_goal_involvements += Number(r.expected_goal_involvements) || 0
        byGw.set(gw, cur)
      })

      const gameweekPoints = Array.from(byGw.entries())
        .map(([gw, cur]) => {
          const gcXgc = gcXgcByGw[gw] ?? { goals_conceded: 0, expected_goals_conceded: 0 }
          return {
            gameweek: gw,
            points: cur.points,
            goals: cur.goals,
            assists: cur.assists,
            goal_involvements: cur.goals + cur.assists,
            clean_sheets: cur.clean_sheets,
            saves: cur.saves,
            bps: cur.bps,
            bonus: cur.bonus,
            defensive_contribution: cur.defensive_contribution,
            yellow_cards: cur.yellow_cards,
            red_cards: cur.red_cards,
            expected_goals: cur.expected_goals,
            expected_assists: cur.expected_assists,
            expected_goal_involvements: cur.expected_goal_involvements,
            goals_conceded: gcXgc.goals_conceded,
            expected_goals_conceded: gcXgc.expected_goals_conceded,
            opponent_short_name: cur.opponent_short_name ?? null,
          }
        })
        .sort((a, b) => a.gameweek - b.gameweek)

      let seasonPoints = 0
      gameweekPoints.forEach((row) => {
        seasonPoints += row.points ?? 0
      })

      // Fetch league rankings (table position, goals/xG/GC/xGC ranks) for team details bento.
      // Also fetch previous-GW rankings for rank-change badges (positive = moved up, negative = moved down).
      let tablePosition = null
      let rankGoals = null
      let rankXg = null
      let rankGoalsConceded = null
      let rankXgc = null
      let tablePositionChange = null
      let rankGoalsChange = null
      let rankXgChange = null
      let rankGoalsConcededChange = null
      let rankXgcChange = null
      const numericGw = Number(gameweek) || 0
      try {
        const rpcParams = { p_gw_filter: 'all', p_location: 'all' }
        const { data: rankingsData } = await supabase.rpc('get_team_league_rankings', {
          ...rpcParams,
          p_as_of_gw: numericGw > 0 ? numericGw : null
        })
        if (rankingsData?.length) {
          const row = rankingsData.find((r) => Number(r.team_id) === resolvedTeamId)
          if (row) {
            tablePosition = row.table_position != null ? Number(row.table_position) : null
            rankGoals = row.rank_goals != null ? Number(row.rank_goals) : null
            rankXg = row.rank_xg != null ? Number(row.rank_xg) : null
            rankGoalsConceded = row.rank_goals_conceded != null ? Number(row.rank_goals_conceded) : null
            rankXgc = row.rank_xgc != null ? Number(row.rank_xgc) : null
          }
        }
        // Previous-GW rankings for rank-change delta (prev - curr; positive = moved up)
        if (numericGw > 1) {
          const { data: prevData } = await supabase.rpc('get_team_league_rankings', {
            ...rpcParams,
            p_as_of_gw: numericGw - 1
          })
          if (prevData?.length) {
            const prevRow = prevData.find((r) => Number(r.team_id) === resolvedTeamId)
            if (prevRow) {
              const prevPos = prevRow.table_position != null ? Number(prevRow.table_position) : null
              const prevGoals = prevRow.rank_goals != null ? Number(prevRow.rank_goals) : null
              const prevXg = prevRow.rank_xg != null ? Number(prevRow.rank_xg) : null
              const prevGc = prevRow.rank_goals_conceded != null ? Number(prevRow.rank_goals_conceded) : null
              const prevXgc = prevRow.rank_xgc != null ? Number(prevRow.rank_xgc) : null
              if (prevPos != null && tablePosition != null) tablePositionChange = prevPos - tablePosition
              if (prevGoals != null && rankGoals != null) rankGoalsChange = prevGoals - rankGoals
              if (prevXg != null && rankXg != null) rankXgChange = prevXg - rankXg
              if (prevGc != null && rankGoalsConceded != null) rankGoalsConcededChange = prevGc - rankGoalsConceded
              if (prevXgc != null && rankXgc != null) rankXgcChange = prevXgc - rankXgc
            }
          }
        }
      } catch (e) {
        console.error('[useTeamDetail] get_team_league_rankings failed:', e)
      }

      return {
        team: teamInfo
          ? {
              team_id: teamInfo.team_id,
              short_name: teamInfo.short_name,
              team_name: teamInfo.team_name ?? teamInfo.short_name ?? '—',
            }
          : { team_id: resolvedTeamId, short_name: null, team_name: '—' },
        seasonPoints,
        gameweekPoints,
        tablePosition,
        rankGoals,
        rankXg,
        rankGoalsConceded,
        rankXgc,
        tablePositionChange,
        rankGoalsChange,
        rankXgChange,
        rankGoalsConcededChange,
        rankXgcChange,
      }
    },
    enabled: teamId != null && !!gameweek,
    staleTime: 60000,
  })

  return {
    ...main.data,
    loading: main.isLoading,
    error: main.error,
  }
}
