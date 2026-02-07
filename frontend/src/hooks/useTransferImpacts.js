import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useConfiguration } from '../contexts/ConfigurationContext'

/**
 * Derive transfers in/out from manager_picks diff (current GW vs prior GW).
 * Used when mv_manager_transfer_impacts has no rows (e.g. manager_transfers not backfilled).
 * Returns same shape as MV: { playerOutName, playerInName, pointImpact }.
 */
async function fetchTransferImpactsFromPicksDiff(MANAGER_ID, gameweek) {
  if (!MANAGER_ID || !gameweek || gameweek <= 1) return []

  const priorGw = gameweek - 1

  const { data: picks, error: picksError } = await supabase
    .from('manager_picks')
    .select('player_id, gameweek')
    .eq('manager_id', MANAGER_ID)
    .in('gameweek', [gameweek, priorGw])

  if (picksError) throw picksError
  if (!picks?.length) return []

  const currentIds = new Set(picks.filter((p) => p.gameweek === gameweek).map((p) => p.player_id))
  const priorIds = new Set(picks.filter((p) => p.gameweek === priorGw).map((p) => p.player_id))

  const outIds = [...priorIds].filter((id) => !currentIds.has(id))
  const inIds = [...currentIds].filter((id) => !priorIds.has(id))

  if (outIds.length === 0 && inIds.length === 0) return []

  const allPlayerIds = [...new Set([...outIds, ...inIds])]

  const [playersRes, statsRes] = await Promise.all([
    supabase.from('players').select('fpl_player_id, web_name').in('fpl_player_id', allPlayerIds),
    supabase
      .from('player_gameweek_stats')
      .select('player_id, total_points')
      .eq('gameweek', gameweek)
      .in('player_id', allPlayerIds),
  ])

  if (playersRes.error) throw playersRes.error
  if (statsRes.error) throw statsRes.error

  const nameByPlayerId = {}
  ;(playersRes.data || []).forEach((p) => {
    nameByPlayerId[p.fpl_player_id] = p.web_name ?? 'Unknown'
  })
  const pointsByPlayerId = {}
  ;(statsRes.data || []).forEach((s) => {
    pointsByPlayerId[s.player_id] = s.total_points ?? 0
  })

  const n = Math.max(outIds.length, inIds.length, 1)
  const pairs = []
  for (let i = 0; i < n; i++) {
    const outId = outIds[i] ?? outIds[0]
    const inId = inIds[i] ?? inIds[0]
    if (outId == null || inId == null) continue
    const playerOutName = nameByPlayerId[outId] ?? 'Unknown'
    const playerInName = nameByPlayerId[inId] ?? 'Unknown'
    const pointsOut = pointsByPlayerId[outId] ?? 0
    const pointsIn = pointsByPlayerId[inId] ?? 0
    const pointImpact = pointsIn - pointsOut
    pairs.push({ playerOutName, playerInName, pointImpact })
  }
  return pairs
}

/**
 * Fetches transfer point impacts for the configured manager in a gameweek.
 * Uses mv_manager_transfer_impacts when available; otherwise derives from
 * manager_picks diff (current GW vs prior GW) + player_gameweek_stats.
 */
export function useTransferImpacts(gameweek = null) {
  const { config } = useConfiguration()
  const MANAGER_ID = config?.managerId || import.meta.env.VITE_MANAGER_ID || null

  const { data: transfers = [], isLoading, error } = useQuery({
    queryKey: ['transfer-impacts', MANAGER_ID, gameweek],
    queryFn: async () => {
      if (!MANAGER_ID || !gameweek) return []

      const { data, error } = await supabase
        .from('mv_manager_transfer_impacts')
        .select('player_in_name, player_out_name, point_impact, transfer_time')
        .eq('manager_id', MANAGER_ID)
        .eq('gameweek', gameweek)
        .order('transfer_time', { ascending: true })

      if (error) throw error

      if (data?.length > 0) {
        return data.map((row) => ({
          playerInName: row.player_in_name ?? 'Unknown',
          playerOutName: row.player_out_name ?? 'Unknown',
          pointImpact: row.point_impact != null ? row.point_impact : null,
        }))
      }

      return fetchTransferImpactsFromPicksDiff(MANAGER_ID, gameweek)
    },
    enabled: !!MANAGER_ID && !!gameweek,
    staleTime: 60000,
    refetchInterval: 60000,
  })

  return { transfers, loading: isLoading, error }
}

/**
 * Fetches transfer impacts for an arbitrary manager (e.g. for league page manager detail popup).
 */
export function useTransferImpactsForManager(managerId, gameweek) {
  const { data: transfers = [], isLoading, error } = useQuery({
    queryKey: ['transfer-impacts-for-manager', managerId, gameweek],
    queryFn: async () => {
      if (!managerId || !gameweek) return []

      const { data, error } = await supabase
        .from('mv_manager_transfer_impacts')
        .select('player_in_name, player_out_name, point_impact, transfer_time')
        .eq('manager_id', managerId)
        .eq('gameweek', gameweek)
        .order('transfer_time', { ascending: true })

      if (error) throw error

      if (data?.length > 0) {
        return data.map((row) => ({
          playerInName: row.player_in_name ?? 'Unknown',
          playerOutName: row.player_out_name ?? 'Unknown',
          pointImpact: row.point_impact != null ? row.point_impact : null,
        }))
      }

      return fetchTransferImpactsFromPicksDiff(managerId, gameweek)
    },
    enabled: !!managerId && !!gameweek,
    staleTime: 60000,
  })

  return { transfers, loading: isLoading, error }
}

/**
 * Fetches transfer impacts for all given managers in a gameweek.
 * Returns a map managerId -> array of { playerOutName, playerInName, pointImpact }.
 */
export function useLeagueTransferImpacts(managerIds, gameweek) {
  const ids = useMemo(() => (Array.isArray(managerIds) ? managerIds.filter(Boolean) : []), [managerIds])
  const { data: rows = [], isLoading, error } = useQuery({
    queryKey: ['league-transfer-impacts', ids, gameweek],
    queryFn: async () => {
      if (ids.length === 0 || !gameweek) return []

      const { data, error: err } = await supabase
        .from('mv_manager_transfer_impacts')
        .select('manager_id, player_in_name, player_out_name, point_impact, transfer_time')
        .in('manager_id', ids)
        .eq('gameweek', gameweek)
        .order('transfer_time', { ascending: true })

      if (err) throw err

      if (data?.length > 0) return data

      // Fallback: MV often has no rows when manager_transfers not backfilled; derive from picks diff
      const results = await Promise.all(
        ids.map((managerId) => fetchTransferImpactsFromPicksDiff(managerId, gameweek))
      )
      return results.flatMap((transfers, i) =>
        (transfers || []).map((t) => ({
          manager_id: ids[i],
          player_in_name: t.playerInName,
          player_out_name: t.playerOutName,
          point_impact: t.pointImpact,
          transfer_time: null,
        }))
      )
    },
    enabled: ids.length > 0 && !!gameweek,
    staleTime: 60000,
  })

  const transfersByManager = useMemo(() => {
    const map = {}
    ids.forEach((id) => { map[Number(id)] = [] })
    rows.forEach((row) => {
      const mid = row.manager_id != null ? Number(row.manager_id) : null
      if (mid == null || !(mid in map)) return
      map[mid].push({
        playerOutName: row.player_out_name ?? 'Unknown',
        playerInName: row.player_in_name ?? 'Unknown',
        pointImpact: row.point_impact != null ? row.point_impact : null,
      })
    })
    return map
  }, [ids, rows])

  return { transfersByManager, loading: isLoading, error }
}
