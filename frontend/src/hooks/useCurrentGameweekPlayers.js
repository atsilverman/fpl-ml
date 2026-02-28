import { useQuery } from '@tanstack/react-query'
import { useGameweekData } from './useGameweekData'
import { useConfiguration } from '../contexts/ConfigurationContext'
import { useRefreshState } from './useRefreshState'
import { supabase } from '../lib/supabase'
import { logRefreshFetchDuration } from '../utils/logRefreshFetchDuration'

const getStats = (playerId, statsByPlayer) => {
  const key = playerId != null ? Number(playerId) : playerId
  return statsByPlayer[key] ?? statsByPlayer[playerId] ?? statsByPlayer[String(playerId)] ?? []
}
const getInfo = (playerId, playerInfoMap) =>
  playerInfoMap[playerId] ?? playerInfoMap[Number(playerId)] ?? playerInfoMap[String(playerId)] ?? {}
const getMatchFinishedForStarter = (playerId, statsByPlayer, playerInfoMap, fixtureList) => {
  const statsRows = getStats(playerId, statsByPlayer)
  if (statsRows.length > 0) {
    return statsRows.some((r) => r.match_finished || r.match_finished_provisional)
  }
  const info = getInfo(playerId, playerInfoMap)
  const teamId = info.team_id ?? null
  if (!teamId) return false
  const teamFixtures = fixtureList.filter(
    (f) => f.home_team_id === teamId || f.away_team_id === teamId
  )
  return teamFixtures.some(
    (f) => f.finished === true || f.finished === 'true' || f.finished_provisional === true || f.finished_provisional === 'true'
  )
}

/**
 * Infer automatic substitutions (applied subs only: first compatible bench who played).
 * Used for points logic. Returns [{ element_out, element_in }].
 */
function inferAutomaticSubsFromData(picks, statsByPlayer, playerInfoMap, fixtureList = []) {
  const automaticSubs = []
  const usedBenchPositions = new Set()
  const benchPlayers = picks.filter((p) => p.position > 11).sort((a, b) => a.position - b.position)
  const sortedPicks = [...picks].sort((a, b) => a.position - b.position)
  for (const pick of sortedPicks) {
    if (pick.position > 11) continue
    const playerId = pick.player_id
    const statsRows = getStats(playerId, statsByPlayer)
    const totalMinutes = statsRows.reduce((sum, r) => sum + (r.minutes ?? 0), 0)
    const matchFinished = getMatchFinishedForStarter(playerId, statsByPlayer, playerInfoMap, fixtureList)
    if (!(matchFinished && totalMinutes === 0)) continue
    const slotPlayerInfo = getInfo(playerId, playerInfoMap)
    const starterPositionType = slotPlayerInfo.position || 0
    let substituteId = null
    for (const benchPick of benchPlayers) {
      if (usedBenchPositions.has(benchPick.position)) continue
      const benchPlayerId = benchPick.player_id
      const benchInfo = getInfo(benchPlayerId, playerInfoMap)
      const benchPositionType = benchInfo.position || 0
      if (starterPositionType === 1) {
        if (benchPositionType !== 1) continue
      } else {
        if (benchPositionType === 1) continue
      }
      const benchStats = getStats(benchPlayerId, statsByPlayer)
      const benchMinutes = benchStats.reduce((sum, r) => sum + (r.minutes ?? 0), 0)
      const benchMatchFinished = benchStats.some((r) => r.match_finished || r.match_finished_provisional)
      if (benchMatchFinished && benchMinutes > 0) {
        substituteId = benchPlayerId
        usedBenchPositions.add(benchPick.position)
        break
      }
    }
    if (substituteId != null) {
      automaticSubs.push({ element_out: playerId, element_in: substituteId })
    }
  }
  return automaticSubs
}

/**
 * Infer display subs for UI: first position-compatible bench by order (designated),
 * so the correct name shows even before that bench player's match. If designated's
 * match is finished and they DNP, cascade to first compatible bench who played.
 * Returns [{ element_out, element_in }] for indicator/name display.
 */
function inferDisplaySubsFromData(picks, statsByPlayer, playerInfoMap, fixtureList = []) {
  const displaySubs = []
  const usedBenchDesignated = new Set()
  const usedBenchApplied = new Set()
  const benchPlayers = picks.filter((p) => p.position > 11).sort((a, b) => a.position - b.position)
  const sortedPicks = [...picks].sort((a, b) => a.position - b.position)
  for (const pick of sortedPicks) {
    if (pick.position > 11) continue
    const playerId = pick.player_id
    const statsRows = getStats(playerId, statsByPlayer)
    const totalMinutes = statsRows.reduce((sum, r) => sum + (r.minutes ?? 0), 0)
    const matchFinished = getMatchFinishedForStarter(playerId, statsByPlayer, playerInfoMap, fixtureList)
    if (!(matchFinished && totalMinutes === 0)) continue
    const slotPlayerInfo = getInfo(playerId, playerInfoMap)
    const starterPositionType = slotPlayerInfo.position || 0
    let designatedIn = null
    let appliedIn = null
    for (const benchPick of benchPlayers) {
      const benchPlayerId = benchPick.player_id
      const benchPosition = benchPick.position
      const benchInfo = getInfo(benchPlayerId, playerInfoMap)
      const benchPositionType = benchInfo.position || 0
      if (starterPositionType === 1) {
        if (benchPositionType !== 1) continue
      } else {
        if (benchPositionType === 1) continue
      }
      if (designatedIn == null && !usedBenchDesignated.has(benchPosition)) {
        designatedIn = benchPlayerId
        usedBenchDesignated.add(benchPosition)
      }
      const benchStats = getStats(benchPlayerId, statsByPlayer)
      const benchMinutes = benchStats.reduce((sum, r) => sum + (r.minutes ?? 0), 0)
      const benchMatchFinished = benchStats.some((r) => r.match_finished || r.match_finished_provisional)
      if (appliedIn == null && benchMatchFinished && benchMinutes > 0 && !usedBenchApplied.has(benchPosition)) {
        appliedIn = benchPlayerId
        usedBenchApplied.add(benchPosition)
      }
    }
    if (designatedIn == null) continue
    const designatedStats = getStats(designatedIn, statsByPlayer)
    const designatedMinutes = designatedStats.reduce((sum, r) => sum + (r.minutes ?? 0), 0)
    const designatedMatchFinished = designatedStats.some((r) => r.match_finished || r.match_finished_provisional)
    const displayIn =
      !designatedMatchFinished || designatedMinutes > 0
        ? designatedIn
        : (appliedIn != null ? appliedIn : designatedIn)
    displaySubs.push({ element_out: playerId, element_in: displayIn })
  }
  return displaySubs
}

/**
 * Shared fetcher for current gameweek players for a given manager.
 * Used by useCurrentGameweekPlayers and useCurrentGameweekPlayersForManager.
 */
async function fetchCurrentGameweekPlayersForManager(MANAGER_ID, gameweek) {
  if (!MANAGER_ID || !gameweek) {
    return []
  }

  // Fetch manager picks for current gameweek (all 15 positions)
  const picksResult = await supabase
        .from('manager_picks')
        .select(`
          position,
          player_id,
          is_captain,
          is_vice_captain,
          multiplier,
          was_auto_subbed_in,
          auto_sub_replaced_player_id
        `)
        .eq('manager_id', MANAGER_ID)
        .eq('gameweek', gameweek)
        .order('position', { ascending: true })

      if (picksResult.error) {
        console.error('Error fetching manager picks:', picksResult.error)
        throw picksResult.error
      }

      const picks = picksResult.data || []
      if (picks.length === 0) {
        return []
      }

      // Get all unique player IDs (including auto-sub replacements)
      const playerIds = new Set()
      picks.forEach(pick => {
        playerIds.add(pick.player_id)
        if (pick.auto_sub_replaced_player_id) {
          playerIds.add(pick.auto_sub_replaced_player_id)
        }
      })

      // Fetch player gameweek stats (default: MP, OPP, PTS; extra for horizontal scroll: G, A, CS, S, BPS, B, DEF)
      const statsResult = await supabase
        .from('player_gameweek_stats')
        .select(`
          player_id,
          fixture_id,
          total_points,
          minutes,
          opponent_team_id,
          was_home,
          started,
          kickoff_time,
          match_finished,
          match_finished_provisional,
          goals_scored,
          assists,
          clean_sheets,
          saves,
          bps,
          bonus,
          bonus_status,
          provisional_bonus,
          defensive_contribution,
          yellow_cards,
          red_cards,
          defcon_points_achieved,
          expected_goals,
          expected_assists,
          expected_goal_involvements,
          expected_goals_conceded
        `)
        .eq('gameweek', gameweek)
        .in('player_id', Array.from(playerIds))

      if (statsResult.error) {
        console.error('Error fetching player stats:', statsResult.error)
        throw statsResult.error
      }

      // player_id -> array of stats (1 or 2 for DGW), sorted by kickoff
      const statsByPlayer = {}
      ;(statsResult.data || []).forEach(stat => {
        const pid = stat.player_id
        if (!statsByPlayer[pid]) statsByPlayer[pid] = []
        statsByPlayer[pid].push(stat)
      })
      Object.keys(statsByPlayer).forEach(pid => {
        statsByPlayer[pid].sort((a, b) => {
          const tA = a.kickoff_time ? new Date(a.kickoff_time).getTime() : 0
          const tB = b.kickoff_time ? new Date(b.kickoff_time).getTime() : 0
          return tA - tB
        })
      })

      // Fetch player info and team info
      const playerInfoResult = await supabase
        .from('players')
        .select(`
          fpl_player_id,
          web_name,
          position,
          team_id,
          teams!fk_players_team(short_name)
        `)
        .in('fpl_player_id', Array.from(playerIds))

      if (playerInfoResult.error) {
        console.error('Error fetching player info:', playerInfoResult.error)
        throw playerInfoResult.error
      }

      // Create a map for quick lookup: player_id -> player info (support number and string keys)
      const playerInfoMap = {}
      ;(playerInfoResult.data || []).forEach(player => {
        const id = player.fpl_player_id
        playerInfoMap[id] = player
        if (typeof id === 'number') playerInfoMap[String(id)] = player
        else if (typeof id === 'string') playerInfoMap[Number(id)] = player
      })

      // Fetch opponent team info
      const opponentTeamIds = new Set()
      Object.values(statsByPlayer).flat().forEach(stat => {
        if (stat.opponent_team_id) opponentTeamIds.add(stat.opponent_team_id)
      })

      let opponentTeamsMap = {}
      if (opponentTeamIds.size > 0) {
        const opponentTeamsResult = await supabase
          .from('teams')
          .select('team_id, short_name')
          .in('team_id', Array.from(opponentTeamIds))

        if (opponentTeamsResult.error) {
          console.error('Error fetching opponent teams:', opponentTeamsResult.error)
          // Don't throw, just continue without opponent badges
        } else {
          ;(opponentTeamsResult.data || []).forEach(team => {
            const tid = team.team_id
            opponentTeamsMap[tid] = team
            if (typeof tid === 'number') opponentTeamsMap[String(tid)] = team
            else if (typeof tid === 'string') opponentTeamsMap[Number(tid)] = team
          })
        }
      }

      // Fetch fixtures for this gameweek (needed for schedule-derived OPP/kickoff and for auto-sub inference)
      const fixturesResult = await supabase
        .from('fixtures')
        .select('fpl_fixture_id, finished, started, finished_provisional, kickoff_time, home_team_id, away_team_id')
        .eq('gameweek', gameweek)
        .order('kickoff_time', { ascending: true })
      const fixturesById = {}
      const fixtureList = fixturesResult.data || []

      // Auto-sub state: when we have stats, use display subs (designated by bench order; cascade if DNP)
      const subbedOutSet = new Set()
      const replacedBySubIn = new Map() // sub_in_player_id -> replaced_player_id (element_out)
      const norm = (id) => (id != null ? Number(id) : id)
      const hasStats = Object.keys(statsByPlayer).length > 0
      const inferredDisplaySubs = inferDisplaySubsFromData(picks, statsByPlayer, playerInfoMap, fixtureList)
      if (hasStats) {
        inferredDisplaySubs.forEach((s) => {
          subbedOutSet.add(norm(s.element_out))
          replacedBySubIn.set(norm(s.element_in), norm(s.element_out))
        })
      } else {
        picks.forEach((p) => {
          if (p.was_auto_subbed_in && p.auto_sub_replaced_player_id != null) {
            subbedOutSet.add(norm(p.auto_sub_replaced_player_id))
            replacedBySubIn.set(norm(p.player_id), norm(p.auto_sub_replaced_player_id))
          }
        })
      }
      const fixtureTeamIds = new Set()
      fixtureList.forEach(f => {
        const id = f.fpl_fixture_id
        fixturesById[id] = f
        fixturesById[Number(id)] = f
        fixturesById[String(id)] = f
        if (f.home_team_id) fixtureTeamIds.add(f.home_team_id)
        if (f.away_team_id) fixtureTeamIds.add(f.away_team_id)
      })
      const allFixturesFinished = fixtureList.length > 0 && fixtureList.every(
        f => f.finished === true || f.finished === 'true'
      )

      // Team short names for schedule-derived opponent (players with no stats yet, or stats missing kickoff/opponent)
      let allTeamsMap = {}
      if (fixtureTeamIds.size > 0) {
        const teamsResult = await supabase
          .from('teams')
          .select('team_id, short_name')
          .in('team_id', Array.from(fixtureTeamIds))
        if (!teamsResult.error && teamsResult.data?.length) {
          teamsResult.data.forEach(t => {
            const tid = t.team_id
            allTeamsMap[tid] = t
            if (typeof tid === 'number') allTeamsMap[String(tid)] = t
            else if (typeof tid === 'string') allTeamsMap[Number(tid)] = t
          })
        }
      }
      // Merge with opponentTeamsMap so we have full coverage
      Object.assign(allTeamsMap, opponentTeamsMap)

      // Combine picks with stats: one row per (pick, stats row). DGW = two rows per pick.
      const rows = []
      picks.forEach(pick => {
        const statsPlayerId = pick.player_id
        const statsKey = statsPlayerId != null ? Number(statsPlayerId) : statsPlayerId
        const statsRows = statsByPlayer[statsKey] ?? statsByPlayer[statsPlayerId] ?? statsByPlayer[String(statsPlayerId)] ?? []
        const pickId = pick.player_id
        const slotPlayerInfo = playerInfoMap[pickId] ?? playerInfoMap[Number(pickId)] ?? playerInfoMap[String(pickId)] ?? {}
        const slotName = slotPlayerInfo.web_name || 'Unknown'
        const slotTeamShortName = slotPlayerInfo.teams?.short_name || null
        const multiplier = pick.multiplier || 1
        const wasAutoSubbedOut = subbedOutSet.has(norm(pick.player_id))
        // When we have stats, use only inferred display subs so 1 sub-off = 1 sub-on (ignore stale DB)
        const wasAutoSubbedIn = hasStats
          ? replacedBySubIn.has(norm(pick.player_id))
          : (pick.was_auto_subbed_in || replacedBySubIn.has(norm(pick.player_id)))

        if (statsRows.length === 0) {
          // No player_gameweek_stats yet (scheduled game before refresh) – derive fixture/kickoff/opponent from schedule
          const teamId = slotPlayerInfo.team_id ?? null
          const scheduleFixtures = teamId
            ? fixtureList.filter(f => f.home_team_id === teamId || f.away_team_id === teamId)
                .sort((a, b) => {
                  const tA = a.kickoff_time ? new Date(a.kickoff_time).getTime() : 0
                  const tB = b.kickoff_time ? new Date(b.kickoff_time).getTime() : 0
                  return tA - tB
                })
            : []
          const isDgw = scheduleFixtures.length > 1

          scheduleFixtures.forEach((scheduleFixture, idx) => {
            const derivedWasHome = scheduleFixture.home_team_id === teamId
            const derivedOpponentId = derivedWasHome ? scheduleFixture.away_team_id : scheduleFixture.home_team_id
            const derivedOpponentShort = derivedOpponentId ? (allTeamsMap[derivedOpponentId]?.short_name ?? null) : null

            rows.push({
              position: pick.position,
            player_id: pick.player_id,
            effective_player_id: pick.player_id,
            player_name: slotName,
            player_position: slotPlayerInfo.position || 0,
            player_team_id: slotPlayerInfo.team_id || null,
            player_team_short_name: slotTeamShortName,
            is_captain: pick.is_captain,
            is_vice_captain: pick.is_vice_captain,
            multiplier,
            was_auto_subbed_in: wasAutoSubbedIn,
            was_auto_subbed_out: wasAutoSubbedOut,
            points: 0,
            contributedPoints: 0,
            minutes: 0,
            match_started: scheduleFixture.started ?? false,
            match_finished: scheduleFixture.finished ?? false,
            match_finished_provisional: scheduleFixture.finished_provisional ?? false,
            fixture_id: scheduleFixture.fpl_fixture_id ?? null,
            kickoff_time: scheduleFixture.kickoff_time ?? null,
            opponent_team_id: derivedOpponentId ?? null,
            opponent_team_short_name: derivedOpponentShort ?? null,
            was_home: derivedWasHome ?? false,
            goals_scored: 0,
            assists: 0,
            clean_sheets: 0,
            saves: 0,
            bps: 0,
            bonus: 0,
            bonus_status: 'provisional',
            defensive_contribution: 0,
            yellow_cards: 0,
            red_cards: 0,
            defcon_points_achieved: false,
            expected_goals: 0,
            expected_assists: 0,
            expected_goal_involvements: 0,
            expected_goals_conceded: 0,
            isDgwRow: isDgw,
            dgwRowIndex: idx
            })
          })

          if (scheduleFixtures.length === 0) {
            rows.push({
              position: pick.position,
              player_id: pick.player_id,
              effective_player_id: pick.player_id,
              player_name: slotName,
              player_position: slotPlayerInfo.position || 0,
              player_team_id: slotPlayerInfo.team_id ?? null,
              player_team_short_name: slotTeamShortName,
              is_captain: pick.is_captain,
              is_vice_captain: pick.is_vice_captain,
              multiplier,
              was_auto_subbed_in: wasAutoSubbedIn,
              was_auto_subbed_out: wasAutoSubbedOut,
              points: 0,
              contributedPoints: 0,
              minutes: 0,
              match_started: false,
              match_finished: false,
              match_finished_provisional: false,
              fixture_id: null,
              kickoff_time: null,
              opponent_team_id: null,
              opponent_team_short_name: null,
              was_home: false,
              goals_scored: 0,
              assists: 0,
              clean_sheets: 0,
              saves: 0,
              bps: 0,
              bonus: 0,
              bonus_status: 'provisional',
              defensive_contribution: 0,
              yellow_cards: 0,
              red_cards: 0,
              defcon_points_achieved: false,
              expected_goals: 0,
              expected_assists: 0,
              expected_goal_involvements: 0,
              expected_goals_conceded: 0,
              isDgwRow: false,
              dgwRowIndex: 0
            })
          }
          return
        }

        const totalEffectivePoints = statsRows.reduce((sum, stats) => {
          const bonusStatus = stats.bonus_status ?? 'provisional'
          const provisionalBonus = Number(stats.provisional_bonus) || 0
          const officialBonus = Number(stats.bonus) ?? 0
          const isBonusConfirmed = bonusStatus === 'confirmed'
          const bonusToAdd = provisionalBonus || officialBonus
          const effectivePoints = isBonusConfirmed ? (stats.total_points || 0) : (stats.total_points || 0) + bonusToAdd
          return sum + effectivePoints
        }, 0)

        const teamIdForDgw = slotPlayerInfo.team_id ?? null
        const scheduleFixturesForDgw = teamIdForDgw
          ? fixtureList.filter(f => f.home_team_id === teamIdForDgw || f.away_team_id === teamIdForDgw)
              .sort((a, b) => {
                const tA = a.kickoff_time ? new Date(a.kickoff_time).getTime() : 0
                const tB = b.kickoff_time ? new Date(b.kickoff_time).getTime() : 0
                return tA - tB
              })
          : []

        // Build one stats row per schedule fixture, matching by fixture_id so DGW shows per-fixture stats on the correct row
        const expandedStatsRows = (() => {
          if (scheduleFixturesForDgw.length <= 1) {
            return statsRows
          }
          const zeroRowForScheduleFixture = (scheduleFixture) => ({
            fixture_id: scheduleFixture.fpl_fixture_id ?? null,
            kickoff_time: scheduleFixture.kickoff_time ?? null,
            opponent_team_id: scheduleFixture.home_team_id === teamIdForDgw
              ? scheduleFixture.away_team_id
              : scheduleFixture.home_team_id,
            was_home: scheduleFixture.home_team_id === teamIdForDgw,
            total_points: 0,
            minutes: 0,
            goals_scored: 0,
            assists: 0,
            clean_sheets: 0,
            saves: 0,
            bps: 0,
            bonus: 0,
            bonus_status: 'provisional',
            provisional_bonus: 0,
            defensive_contribution: 0,
            yellow_cards: 0,
            red_cards: 0,
            defcon_points_achieved: false,
            expected_goals: 0,
            expected_assists: 0,
            expected_goal_involvements: 0,
            expected_goals_conceded: 0,
            match_finished: false,
            match_finished_provisional: false,
            started: false
          })
          const kickoffEq = (a, b) => {
            if (a == null && b == null) return true
            if (a == null || b == null) return false
            const tA = typeof a === 'string' ? new Date(a).getTime() : (a && a.getTime ? a.getTime() : 0)
            const tB = typeof b === 'string' ? new Date(b).getTime() : (b && b.getTime ? b.getTime() : 0)
            return tA === tB || (tA > 0 && tB > 0 && Math.abs(tA - tB) < 60000)
          }
          const schedOpponentId = (f, teamId) => {
            if (!f || teamId == null) return null
            return f.home_team_id === teamId ? (f.away_team_id ?? null) : (f.home_team_id ?? null)
          }
          const usedStatsIndices = new Set()
          return scheduleFixturesForDgw.map((scheduleFixture, scheduleIdx) => {
            const schedFid = scheduleFixture.fpl_fixture_id != null ? Number(scheduleFixture.fpl_fixture_id) : null
            const schedKickoff = scheduleFixture.kickoff_time ?? null
            const schedOpponent = schedOpponentId(scheduleFixture, teamIdForDgw)
            // 1) Match by fixture_id (normalize to number so "123" === 123)
            let matched = statsRows.find((s, i) => {
              if (usedStatsIndices.has(i)) return false
              const fid = s.fixture_id != null && s.fixture_id !== 0 ? Number(s.fixture_id) : null
              if (schedFid != null && fid != null && fid === schedFid) {
                usedStatsIndices.add(i)
                return true
              }
              if ((fid == null || fid === 0) && scheduleIdx === 0) {
                usedStatsIndices.add(i)
                return true
              }
              return false
            })
            // 2) Fallback: match by kickoff_time so correct minutes land on correct row
            if (!matched && schedKickoff) {
              const byKickoff = statsRows.find((s, i) => {
                if (usedStatsIndices.has(i)) return false
                if (kickoffEq(s.kickoff_time, schedKickoff)) {
                  usedStatsIndices.add(i)
                  return true
                }
                return false
              })
              if (byKickoff) matched = byKickoff
            }
            // 3) Fallback: match by opponent_team_id (e.g. WOL-ARS row gets stats with opponent = Wolves)
            if (!matched && schedOpponent != null) {
              const oppId = Number(schedOpponent)
              const byOpponent = statsRows.find((s, i) => {
                if (usedStatsIndices.has(i)) return false
                const so = s.opponent_team_id != null ? Number(s.opponent_team_id) : null
                if (so != null && so === oppId) {
                  usedStatsIndices.add(i)
                  return true
                }
                return false
              })
              if (byOpponent) matched = byOpponent
            }
            if (matched) return matched
            return zeroRowForScheduleFixture(scheduleFixture)
          })
        })()

        expandedStatsRows.forEach((stats, idx) => {
          const fid = stats.fixture_id != null ? stats.fixture_id : null
          const fixture = fid != null && fid !== 0
            ? (fixturesById[fid] ?? fixturesById[Number(fid)] ?? fixturesById[String(fid)])
            : null
          const teamId = slotPlayerInfo.team_id ?? null
          // fixture_id 0 = legacy/placeholder; no fixture in fixturesById. Derive from schedule.
          // DGW: when fixture is null, get the fixture for this stats row index from schedule (by kickoff order)
          const scheduleFixturesForTeam = (!fixture && teamId)
            ? fixtureList.filter(f => f.home_team_id === teamId || f.away_team_id === teamId)
                .sort((a, b) => {
                  const tA = a.kickoff_time ? new Date(a.kickoff_time).getTime() : 0
                  const tB = b.kickoff_time ? new Date(b.kickoff_time).getTime() : 0
                  return tA - tB
                })
            : []
          const scheduleFixture = scheduleFixturesForTeam[idx] ?? scheduleFixturesForTeam[0] ?? null
          const effectiveFixture = fixture ?? scheduleFixture ?? null
          const opponentTeam = stats.opponent_team_id ? opponentTeamsMap[stats.opponent_team_id] : null
          const derivedOpponentFromFixture = effectiveFixture && teamId
            ? (effectiveFixture.home_team_id === teamId ? allTeamsMap[effectiveFixture.away_team_id] : allTeamsMap[effectiveFixture.home_team_id])
            : null
          const kickoffTime = stats.kickoff_time || effectiveFixture?.kickoff_time || null
          const opponentShortName = opponentTeam?.short_name || derivedOpponentFromFixture?.short_name || null
          const opponentTeamId = stats.opponent_team_id || (effectiveFixture && teamId
            ? (effectiveFixture.home_team_id === teamId ? effectiveFixture.away_team_id : effectiveFixture.home_team_id)
            : null)
          const bonusStatus = stats.bonus_status ?? 'provisional'
          const provisionalBonus = Number(stats.provisional_bonus) || 0
          const officialBonus = Number(stats.bonus) ?? 0
          const isBonusConfirmed = bonusStatus === 'confirmed'
          // When status is provisional, use only our BPS-based provisional_bonus (ignore bonus column until FPL confirms).
          const bonusToAdd = isBonusConfirmed ? officialBonus : provisionalBonus
          const fixtureFinished = effectiveFixture != null && (effectiveFixture.finished === true || effectiveFixture.finished === 'true')
          const matchFinished = fixtureFinished || stats.match_finished === true || (allFixturesFinished && (stats.minutes ?? 0) > 0)
          const effectivePoints = isBonusConfirmed ? (stats.total_points || 0) : (stats.total_points || 0) + bonusToAdd
          const effectiveBonus = (isBonusConfirmed || matchFinished) ? officialBonus : bonusToAdd
          const effectiveFid = effectiveFixture?.fpl_fixture_id ?? (fid && fid !== 0 ? fid : null)
          rows.push({
            position: pick.position,
            player_id: pick.player_id,
            effective_player_id: pick.player_id,
            player_name: slotName,
            player_position: slotPlayerInfo.position || 0,
            player_team_id: slotPlayerInfo.team_id || null,
            player_team_short_name: slotTeamShortName,
            is_captain: pick.is_captain,
            is_vice_captain: pick.is_vice_captain,
            multiplier,
            was_auto_subbed_in: wasAutoSubbedIn,
            was_auto_subbed_out: wasAutoSubbedOut,
            points: effectivePoints,
            contributedPoints: effectivePoints * multiplier,
            totalContributedPointsForSlot: totalEffectivePoints * multiplier,
            minutes: stats.minutes ?? 0,
            match_started: effectiveFixture ? (effectiveFixture.started ?? stats.started) : (stats.started ?? false),
            match_finished: stats.match_finished ?? false,
            match_finished_provisional: stats.match_finished_provisional ?? false,
            fixture_id: effectiveFid,
            kickoff_time: kickoffTime,
            opponent_team_id: opponentTeamId,
            opponent_team_short_name: opponentShortName,
            was_home: stats.was_home || false,
            goals_scored: stats.goals_scored ?? 0,
            assists: stats.assists ?? 0,
            clean_sheets: stats.clean_sheets ?? 0,
            saves: stats.saves ?? 0,
            bps: stats.bps ?? 0,
            bonus: effectiveBonus,
            bonus_status: bonusStatus,
            defensive_contribution: stats.defensive_contribution ?? 0,
            yellow_cards: stats.yellow_cards ?? 0,
            red_cards: stats.red_cards ?? 0,
            defcon_points_achieved: stats.defcon_points_achieved ?? false,
            expected_goals: stats.expected_goals ?? 0,
            expected_assists: stats.expected_assists ?? 0,
            expected_goal_involvements: stats.expected_goal_involvements ?? 0,
            expected_goals_conceded: stats.expected_goals_conceded ?? 0,
            isDgwRow: expandedStatsRows.length > 1,
            dgwRowIndex: idx
          })
        })
      })

      const players = rows
  // Sort by position then by dgwRowIndex so DGW second row is right under first
  players.sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position
    return a.dgwRowIndex - b.dgwRowIndex
  })

  return { players, fixtures: fixtureList }
}

/**
 * Hook to fetch current gameweek owned players (all 15) with their points and opponent info
 * Uses configured manager from context.
 */
export function useCurrentGameweekPlayers() {
  const { config } = useConfiguration()
  const { gameweek, loading: gwLoading } = useGameweekData()
  const { state: refreshState } = useRefreshState()
  const MANAGER_ID = config?.managerId || import.meta.env.VITE_MANAGER_ID || null

  const isLive = refreshState === 'live_matches' || refreshState === 'bonus_pending'
  const { data: playersData, isLoading, error } = useQuery({
    queryKey: ['current-gameweek-players', MANAGER_ID, gameweek],
    queryFn: async () => {
      const start = performance.now()
      const result = await fetchCurrentGameweekPlayersForManager(MANAGER_ID, gameweek)
      logRefreshFetchDuration('GW Players', performance.now() - start, refreshState)
      return result
    },
    enabled: !!MANAGER_ID && !!gameweek && !gwLoading,
    staleTime: isLive ? 6 * 1000 : 30 * 1000, // 6s when live so GW points / MP stay in sync with debug
    refetchInterval: isLive ? 8 * 1000 : 60 * 1000, // 8s when live so minutes don't lag
    refetchIntervalInBackground: true,
  })

  const playersList = Array.isArray(playersData) ? playersData : (playersData?.players ?? [])
  const fixturesList = playersData?.fixtures ?? []
  return {
    data: playersList,
    fixtures: fixturesList,
    isLoading: isLoading || gwLoading,
    error
  }
}

/**
 * Hook to fetch current gameweek players for an arbitrary manager (e.g. for manager detail popup).
 * Only runs when managerId is provided.
 */
export function useCurrentGameweekPlayersForManager(managerId) {
  const { gameweek, loading: gwLoading } = useGameweekData()
  const { state: refreshState } = useRefreshState()

  const isLive = refreshState === 'live_matches' || refreshState === 'bonus_pending'
  const { data: playersData, isLoading, error } = useQuery({
    queryKey: ['current-gameweek-players', managerId, gameweek],
    queryFn: () => fetchCurrentGameweekPlayersForManager(managerId, gameweek),
    enabled: !!managerId && !!gameweek && !gwLoading,
    staleTime: 30 * 1000,
    refetchInterval: isLive ? 25 * 1000 : 60 * 1000,
    refetchIntervalInBackground: true,
  })

  const playersList = Array.isArray(playersData) ? playersData : (playersData?.players ?? [])
  const fixturesList = playersData?.fixtures ?? []
  return {
    data: playersList,
    fixtures: fixturesList,
    isLoading: isLoading || gwLoading,
    error
  }
}
