import { useMemo } from 'react'
import { useCurrentGameweekPlayers } from './useCurrentGameweekPlayers'
import { useCurrentGameweekPlayersForManager } from './useCurrentGameweekPlayers'
import { useLeagueGameweekPicks } from './useLeagueGameweekPicks'
import { useConfiguration } from '../contexts/ConfigurationContext'
import { useGameweekData } from './useGameweekData'

/**
 * Computes "importance" (impact) per player for all 15 squad players (XI + bench).
 * Your % of this player's points vs league average (other managers).
 * Starters: our_pct = multiplier * 100; bench: our_pct = 0 (points don't count unless Bench Boost).
 * Formula: importance = our_pct - league_avg_percent.
 * Returns { impactByPlayerId: { [player_id]: number }, loading }.
 */
export function usePlayerImpact() {
  const { config } = useConfiguration()
  const { gameweek, loading: gwLoading } = useGameweekData()
  const MANAGER_ID = config?.managerId ?? null
  const LEAGUE_ID = config?.leagueId ?? null

  const { data: currentGameweekPlayers, isLoading: playersLoading } = useCurrentGameweekPlayers()
  const { picks: leaguePicks, managerCount, loading: leaguePicksLoading } = useLeagueGameweekPicks(
    LEAGUE_ID,
    gameweek
  )

  const impactByPlayerId = useMemo(() => {
    if (!currentGameweekPlayers?.length || !LEAGUE_ID || MANAGER_ID == null || managerCount <= 0) {
      return {}
    }

    const otherCount = managerCount - 1
    if (otherCount <= 0) {
      return currentGameweekPlayers.reduce((acc, p) => {
        const ourPct = p.position <= 11 ? (p.multiplier ?? 1) * 100 : 0
        acc[p.player_id] = ourPct
        return acc
      }, {})
    }

    const byPlayer = {}
    leaguePicks.forEach(({ manager_id, player_id, multiplier }) => {
      if (!byPlayer[player_id]) byPlayer[player_id] = { total: 0 }
      byPlayer[player_id].total += multiplier * 100
    })

    const result = {}
    currentGameweekPlayers.forEach((p) => {
      const pid = p.player_id
      const ourPct = p.position <= 11 ? (p.multiplier ?? 1) * 100 : 0
      const leagueTotalForPlayer = (byPlayer[pid] ?? { total: 0 }).total
      const ourContribution = p.position <= 11 ? (p.multiplier ?? 1) * 100 : 0
      const otherTotal = leagueTotalForPlayer - ourContribution
      const leagueAvg = otherTotal / otherCount
      result[pid] = Math.round(ourPct - leagueAvg)
    })

    return result
  }, [currentGameweekPlayers, leaguePicks, managerCount, LEAGUE_ID, MANAGER_ID])

  return {
    impactByPlayerId,
    loading: gwLoading || playersLoading || leaguePicksLoading
  }
}

/**
 * Computes "importance" (impact) per player for an arbitrary manager's squad.
 * Same formula as usePlayerImpact but for the given managerId (e.g. for manager detail popup).
 * Only runs when both managerId and leagueId are provided.
 */
export function usePlayerImpactForManager(managerId, leagueId) {
  const { gameweek, loading: gwLoading } = useGameweekData()

  const { data: currentGameweekPlayers, isLoading: playersLoading } = useCurrentGameweekPlayersForManager(managerId)
  const { picks: leaguePicks, managerCount, loading: leaguePicksLoading } = useLeagueGameweekPicks(
    leagueId,
    gameweek
  )

  const impactByPlayerId = useMemo(() => {
    if (!currentGameweekPlayers?.length || !leagueId || managerId == null || managerCount <= 0) {
      return {}
    }

    const otherCount = managerCount - 1
    if (otherCount <= 0) {
      return currentGameweekPlayers.reduce((acc, p) => {
        const ourPct = p.position <= 11 ? (p.multiplier ?? 1) * 100 : 0
        acc[p.player_id] = ourPct
        return acc
      }, {})
    }

    const byPlayer = {}
    leaguePicks.forEach(({ manager_id, player_id, multiplier }) => {
      if (!byPlayer[player_id]) byPlayer[player_id] = { total: 0 }
      byPlayer[player_id].total += multiplier * 100
    })

    const result = {}
    currentGameweekPlayers.forEach((p) => {
      const pid = p.player_id
      const ourPct = p.position <= 11 ? (p.multiplier ?? 1) * 100 : 0
      const leagueTotalForPlayer = (byPlayer[pid] ?? { total: 0 }).total
      const ourContribution = p.position <= 11 ? (p.multiplier ?? 1) * 100 : 0
      const otherTotal = leagueTotalForPlayer - ourContribution
      const leagueAvg = otherTotal / otherCount
      result[pid] = Math.round(ourPct - leagueAvg)
    })

    return result
  }, [currentGameweekPlayers, leaguePicks, managerCount, leagueId, managerId])

  return {
    impactByPlayerId,
    loading: gwLoading || playersLoading || leaguePicksLoading
  }
}
