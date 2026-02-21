import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useGameweekData } from './useGameweekData'
import { useRefreshState } from './useRefreshState'
import { getApiBase } from '../lib/apiBase'
import { supabase } from '../lib/supabase'

const PAGE_SIZE = 5000

const MV_TABLE_BY_GW = {
  all: 'mv_research_player_stats_all',
  last6: 'mv_research_player_stats_last_6',
  last12: 'mv_research_player_stats_last_12'
}

const MV_SELECT = 'player_id, location, minutes, effective_total_points, goals_scored, assists, clean_sheets, saves, bps, defensive_contribution, yellow_cards, red_cards, expected_goals, expected_assists, expected_goal_involvements, expected_goals_conceded, goals_conceded'

/**
 * Aggregate per-fixture rows into one row per player (sum stats across DGW fixtures).
 * Used when MVs are not available (fallback).
 */
function aggregateByPlayer(rows, locationFilter = 'all') {
  if (!rows || rows.length === 0) return []
  const byPlayer = new Map()
  for (const row of rows) {
    if (locationFilter === 'home' && !row.was_home) continue
    if (locationFilter === 'away' && row.was_home) continue
    const id = row.player_id
    if (id == null) continue
    const key = Number(id)
    const existing = byPlayer.get(key)
    const totalPoints = Number(row.total_points) || 0
    const bonusStatus = row.bonus_status ?? 'provisional'
    const officialBonus = Number(row.bonus) ?? 0
    const isBonusConfirmed = bonusStatus === 'confirmed'
    const provisionalBonus = Number(row.provisional_bonus) || 0
    const bonusToAdd = provisionalBonus || officialBonus
    const effective = isBonusConfirmed ? totalPoints : totalPoints + bonusToAdd
    const minutes = Number(row.minutes) || 0
    if (!existing) {
      byPlayer.set(key, {
        player_id: id,
        total_points: totalPoints,
        bonus: officialBonus,
        provisional_bonus: provisionalBonus,
        effective_total_points: effective,
        minutes,
        goals_scored: Number(row.goals_scored) || 0,
        assists: Number(row.assists) || 0,
        clean_sheets: Number(row.clean_sheets) || 0,
        saves: Number(row.saves) || 0,
        bps: Number(row.bps) || 0,
        defensive_contribution: Number(row.defensive_contribution) || 0,
        yellow_cards: Number(row.yellow_cards) || 0,
        red_cards: Number(row.red_cards) || 0,
        expected_goals: Number(row.expected_goals) || 0,
        expected_assists: Number(row.expected_assists) || 0,
        expected_goal_involvements: Number(row.expected_goal_involvements) || 0,
        expected_goals_conceded: Number(row.expected_goals_conceded) || 0,
        goals_conceded: row.goals_conceded ?? 0
      })
    } else {
      existing.total_points += totalPoints
      existing.bonus += officialBonus
      existing.provisional_bonus += provisionalBonus
      existing.effective_total_points += effective
      existing.minutes += minutes
      existing.goals_scored += Number(row.goals_scored) || 0
      existing.assists += Number(row.assists) || 0
      existing.clean_sheets += Number(row.clean_sheets) || 0
      existing.saves += Number(row.saves) || 0
      existing.bps += Number(row.bps) || 0
      existing.defensive_contribution += Number(row.defensive_contribution) || 0
      existing.yellow_cards += Number(row.yellow_cards) || 0
      existing.red_cards += Number(row.red_cards) || 0
      existing.expected_goals += Number(row.expected_goals) || 0
      existing.expected_assists += Number(row.expected_assists) || 0
      existing.expected_goal_involvements += Number(row.expected_goal_involvements) || 0
      existing.expected_goals_conceded += Number(row.expected_goals_conceded) || 0
      existing.goals_conceded += row.goals_conceded ?? 0
    }
  }
  return Array.from(byPlayer.values())
}

function mapRowToPlayer(row, playerMap) {
  const info = playerMap[row.player_id] || { web_name: 'Unknown', team_id: null, team_short_name: null, team_name: null, position: null, cost_tenths: null, selected_by_percent: null }
  return {
    player_id: row.player_id,
    web_name: info.web_name,
    team_id: info.team_id,
    team_short_name: info.team_short_name,
    team_name: info.team_name,
    position: info.position,
    cost_tenths: info.cost_tenths,
    selected_by_percent: info.selected_by_percent != null ? Number(info.selected_by_percent) : null,
    points: row.effective_total_points ?? 0,
    minutes: row.minutes ?? 0,
    goals_scored: row.goals_scored ?? 0,
    assists: row.assists ?? 0,
    clean_sheets: row.clean_sheets ?? 0,
    saves: row.saves ?? 0,
    bps: row.bps ?? 0,
    defensive_contribution: row.defensive_contribution ?? 0,
    yellow_cards: row.yellow_cards ?? 0,
    red_cards: row.red_cards ?? 0,
    expected_goals: Number(row.expected_goals) ?? 0,
    expected_assists: Number(row.expected_assists) ?? 0,
    expected_goal_involvements: Number(row.expected_goal_involvements) ?? 0,
    expected_goals_conceded: Number(row.expected_goals_conceded) ?? 0,
    goals_conceded: row.goals_conceded ?? 0
  }
}

const PAGE_SIZE_PLAYER_VIEW = 50
const PAGE_SIZE_TEAM_VIEW = 5000

/**
 * Fetches player stats for the Stats subpage. Uses materialized views when available
 * (one small request per GW range + location) for fast load; falls back to raw
 * player_gameweek_stats + in-memory aggregation if MVs are not yet deployed.
 * When using API: paginated (50 per page in player view); full list in team view.
 * @param {'all'|'last6'|'last12'} gwFilter - GW range
 * @param {'all'|'home'|'away'} locationFilter - filter by was_home
 * @param {{ page?: number, sortBy?: string, sortDir?: string, positionFilter?: string, searchQuery?: string, teamView?: boolean }} opts - pagination and filters (API only)
 */
export function useAllPlayersGameweekStats(gwFilter = 'all', locationFilter = 'all', opts = {}) {
  const {
    page = 1,
    sortBy = 'points',
    sortDir = 'desc',
    positionFilter = 'all',
    searchQuery = '',
    teamView = false
  } = opts
  const { gameweek, loading: gwLoading } = useGameweekData()
  const { state: refreshState } = useRefreshState()
  const isLive = refreshState === 'live_matches' || refreshState === 'bonus_pending'
  const pageSize = teamView ? PAGE_SIZE_TEAM_VIEW : PAGE_SIZE_PLAYER_VIEW
  const apiPage = teamView ? 1 : page
  const API_BASE = getApiBase()

  const { data: cache, isLoading } = useQuery({
    queryKey: [
      'all-players-gameweek-stats',
      gameweek,
      gwFilter,
      locationFilter,
      ...(API_BASE ? [apiPage, pageSize, sortBy, sortDir, positionFilter, searchQuery.trim(), teamView] : [])
    ],
    queryFn: async () => {
      if (!gameweek) return null
      const gw = Number(gameweek)

      if (API_BASE) {
        try {
          const params = new URLSearchParams({
            gw_filter: gwFilter,
            location: locationFilter,
            page: String(apiPage),
            page_size: String(pageSize),
            sort_by: sortBy,
            sort_dir: sortDir
          })
          if (positionFilter !== 'all' && positionFilter !== '') params.set('position', positionFilter)
          if (searchQuery.trim()) params.set('search', searchQuery.trim())
          const res = await fetch(`${API_BASE}/api/v1/stats?${params.toString()}`)
          const data = await res.json()
          if (!res.ok) return null
          return {
            source: 'api',
            players: data.players ?? [],
            team_goals_conceded: data.team_goals_conceded ?? {},
            total_count: data.total_count ?? (data.players ?? []).length,
            page: data.page ?? apiPage,
            page_size: data.page_size ?? pageSize,
            top_10_player_ids_by_field: data.top_10_player_ids_by_field ?? null
          }
        } catch {
          return null
        }
      }

      const mvTable = MV_TABLE_BY_GW[gwFilter]
      const { data: mvRows, error: mvError } = await supabase
        .from(mvTable)
        .select(MV_SELECT)
        .eq('location', locationFilter)

      if (!mvError && mvRows != null) {
        const playerIds = [...new Set((mvRows || []).map((r) => r.player_id).filter(Boolean))]
        if (playerIds.length === 0) return { source: 'mv', rows: [], playerMap: {} }

        const { data: players, error: playersError } = await supabase
          .from('players')
          .select('fpl_player_id, web_name, team_id, position, cost_tenths, selected_by_percent, teams(short_name, team_name)')
          .in('fpl_player_id', playerIds)

        if (playersError) {
          console.error('Error fetching players for stats table:', playersError)
          return { source: 'mv', rows: [], playerMap: {} }
        }

        const playerMap = {}
        ;(players || []).forEach((p) => {
          playerMap[p.fpl_player_id] = {
            web_name: p.web_name ?? 'Unknown',
            team_id: p.team_id ?? null,
            team_short_name: p.teams?.short_name ?? null,
            team_name: p.teams?.team_name ?? null,
            position: p.position != null ? Number(p.position) : null,
            cost_tenths: p.cost_tenths != null ? Number(p.cost_tenths) : null,
            selected_by_percent: p.selected_by_percent != null ? Number(p.selected_by_percent) : null
          }
        })

        const needPrice = playerIds.filter((id) => playerMap[id]?.cost_tenths == null)
        if (needPrice.length > 0) {
          const { data: priceRows } = await supabase
            .from('player_prices')
            .select('player_id, price_tenths, recorded_at')
            .eq('gameweek', gw)
            .in('player_id', needPrice)
            .order('recorded_at', { ascending: false })
          if (priceRows?.length) {
            const byPlayer = new Map()
            for (const row of priceRows) {
              if (row.player_id != null && !byPlayer.has(row.player_id) && row.price_tenths != null) {
                byPlayer.set(row.player_id, Number(row.price_tenths))
              }
            }
            byPlayer.forEach((tenths, id) => {
              if (playerMap[id]) playerMap[id].cost_tenths = tenths
            })
          }
        }

        return { source: 'mv', rows: mvRows || [], playerMap }
      }

      // Fallback: raw fetch + aggregate
      const baseQuery = supabase
        .from('player_gameweek_stats')
        .select(
          'gameweek, player_id, was_home, total_points, bonus_status, provisional_bonus, bonus, minutes, goals_scored, assists, clean_sheets, saves, bps, defensive_contribution, yellow_cards, red_cards, expected_goals, expected_assists, expected_goal_involvements, expected_goals_conceded, goals_conceded'
        )
        .gte('gameweek', 1)
        .lte('gameweek', gw)
        .order('gameweek', { ascending: true })

      let stats = []
      let offset = 0
      while (true) {
        const { data: page, error: statsError } = await baseQuery.range(offset, offset + PAGE_SIZE - 1)
        if (statsError) {
          console.error('Error fetching gameweek stats for all players:', statsError)
          return null
        }
        const list = page || []
        stats = stats.concat(list)
        if (list.length < PAGE_SIZE) break
        offset += PAGE_SIZE
      }

      const playerIds = [...new Set(stats.map((r) => r.player_id).filter(Boolean))]
      if (playerIds.length === 0) return { source: 'raw', rawStats: [], playerMap: {} }

      const { data: players, error: playersError } = await supabase
        .from('players')
        .select('fpl_player_id, web_name, team_id, position, cost_tenths, selected_by_percent, teams(short_name, team_name)')
        .in('fpl_player_id', playerIds)

      if (playersError) {
        console.error('Error fetching players for stats table:', playersError)
        return { source: 'raw', rawStats: stats, playerMap: {} }
      }

      const playerMap = {}
      ;(players || []).forEach((p) => {
        playerMap[p.fpl_player_id] = {
          web_name: p.web_name ?? 'Unknown',
          team_id: p.team_id ?? null,
          team_short_name: p.teams?.short_name ?? null,
          team_name: p.teams?.team_name ?? null,
          position: p.position != null ? Number(p.position) : null,
          cost_tenths: p.cost_tenths != null ? Number(p.cost_tenths) : null,
          selected_by_percent: p.selected_by_percent != null ? Number(p.selected_by_percent) : null
        }
      })

      const needPrice = playerIds.filter((id) => playerMap[id]?.cost_tenths == null)
      if (needPrice.length > 0) {
        const { data: priceRows } = await supabase
          .from('player_prices')
          .select('player_id, price_tenths, recorded_at')
          .eq('gameweek', gw)
          .in('player_id', needPrice)
          .order('recorded_at', { ascending: false })
        if (priceRows?.length) {
          const byPlayer = new Map()
          for (const row of priceRows) {
            if (row.player_id != null && !byPlayer.has(row.player_id) && row.price_tenths != null) {
              byPlayer.set(row.player_id, Number(row.price_tenths))
            }
          }
          byPlayer.forEach((tenths, id) => {
            if (playerMap[id]) playerMap[id].cost_tenths = tenths
          })
        }
      }

      return { source: 'raw', rawStats: stats, playerMap }
    },
    enabled: !!gameweek && !gwLoading,
    staleTime: isLive ? 25 * 1000 : 2 * 60 * 1000,
    refetchInterval: isLive ? 25 * 1000 : false,
    refetchIntervalInBackground: true
  })

  const teamGoalsConceded = useMemo(() => {
    if (!cache || cache.source !== 'api') return {}
    return cache.team_goals_conceded ?? {}
  }, [cache])

  const totalCount = useMemo(() => {
    if (!cache) return 0
    if (cache.source === 'api') return cache.total_count ?? (cache.players?.length ?? 0)
    return 0
  }, [cache])

  const pagination = useMemo(() => {
    if (!cache || cache.source !== 'api') return { page: 1, page_size: 0, total_count: 0 }
    return {
      page: cache.page ?? 1,
      page_size: cache.page_size ?? PAGE_SIZE_PLAYER_VIEW,
      total_count: cache.total_count ?? (cache.players?.length ?? 0)
    }
  }, [cache])

  /** Global top 10 player IDs per stat (from API only); same for every page so fill does not recalc per page */
  const top10PlayerIdsByField = useMemo(() => {
    if (!cache || cache.source !== 'api' || !cache.top_10_player_ids_by_field) return null
    const raw = cache.top_10_player_ids_by_field
    if (typeof raw !== 'object' || Object.keys(raw).length === 0) return null
    const sets = {}
    for (const [field, ids] of Object.entries(raw)) {
      if (Array.isArray(ids)) sets[field] = new Set(ids.map((id) => Number(id)).filter((n) => n > 0))
    }
    return Object.keys(sets).length > 0 ? sets : null
  }, [cache])

  const players = useMemo(() => {
    if (!cache) return []

    if (cache.source === 'api' && Array.isArray(cache.players)) {
      return cache.players
    }

    if (cache.source === 'mv' && cache.rows?.length) {
      return cache.rows.map((row) => mapRowToPlayer(row, cache.playerMap))
    }

    if (cache.source === 'raw' && cache.rawStats?.length) {
      const gw = Number(gameweek)
      let minGw = 1
      if (gwFilter === 'last6') minGw = Math.max(1, gw - 5)
      else if (gwFilter === 'last12') minGw = Math.max(1, gw - 11)
      const filtered = cache.rawStats.filter((r) => r.gameweek >= minGw && r.gameweek <= gw)
      const aggregated = aggregateByPlayer(filtered, locationFilter)
      const mapped = aggregated.map((s) => {
        const info = cache.playerMap[s.player_id] || { web_name: 'Unknown', team_id: null, team_short_name: null, team_name: null, position: null, cost_tenths: null, selected_by_percent: null }
        return {
          player_id: s.player_id,
          web_name: info.web_name,
          team_id: info.team_id,
          team_short_name: info.team_short_name,
          team_name: info.team_name,
          position: info.position,
          cost_tenths: info.cost_tenths,
          selected_by_percent: info.selected_by_percent != null ? Number(info.selected_by_percent) : null,
          points: s.effective_total_points ?? s.total_points ?? 0,
          minutes: s.minutes ?? 0,
          goals_scored: s.goals_scored ?? 0,
          assists: s.assists ?? 0,
          clean_sheets: s.clean_sheets ?? 0,
          saves: s.saves ?? 0,
          bps: s.bps ?? 0,
          defensive_contribution: s.defensive_contribution ?? 0,
          yellow_cards: s.yellow_cards ?? 0,
          red_cards: s.red_cards ?? 0,
          expected_goals: s.expected_goals ?? 0,
          expected_assists: s.expected_assists ?? 0,
          expected_goal_involvements: s.expected_goal_involvements ?? 0,
          expected_goals_conceded: s.expected_goals_conceded ?? 0,
          goals_conceded: s.goals_conceded ?? 0
        }
      })
      return mapped.filter((p) => (p.minutes ?? 0) >= 1)
    }

    return []
  }, [cache, gameweek, gwFilter, locationFilter])

  return {
    players,
    teamGoalsConceded,
    totalCount,
    pagination,
    top10PlayerIdsByField,
    loading: isLoading || gwLoading
  }
}
