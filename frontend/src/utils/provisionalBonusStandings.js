/**
 * Provisional BPS bonus is shown immediately on bonus/fixture-focused UI.
 * For league standings, manager totals, home GW points, and related aggregates we wait
 * until max(player minutes) in the fixture >= this threshold.
 */
export const STANDINGS_PROVISIONAL_BONUS_MIN_FIXTURE_MINUTES = 60

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {number} gameweek
 * @returns {Promise<Record<number, number>>} fixture_id -> max player minutes in that fixture
 */
export async function fetchFixtureMaxMinutesByGameweek(supabase, gameweek) {
  const map = {}
  if (gameweek == null) return map
  const pageSize = 1000
  let from = 0
  for (;;) {
    const { data, error } = await supabase
      .from('player_gameweek_stats')
      .select('fixture_id, minutes')
      .eq('gameweek', gameweek)
      .range(from, from + pageSize - 1)
    if (error) throw error
    if (!data?.length) break
    for (const row of data) {
      const fid = row.fixture_id
      if (fid == null || fid === 0) continue
      const m = Number(row.minutes) || 0
      const k = Number(fid)
      if (map[k] == null || m > map[k]) map[k] = m
    }
    if (data.length < pageSize) break
    from += pageSize
  }
  return map
}

export function maxMinutesForFixture(maxByFixtureId, fixtureId) {
  if (fixtureId == null || fixtureId === 0) return 0
  const v = maxByFixtureId[Number(fixtureId)]
  return v != null ? v : 0
}

/** Extra points to add to total_points when bonus is not yet confirmed (standings / home GW). */
export function standingsProvisionalBonusToAdd(isBonusConfirmed, provisionalBonus, fixtureMaxMinutes) {
  if (isBonusConfirmed) return 0
  const maxM = Number(fixtureMaxMinutes) || 0
  if (maxM < STANDINGS_PROVISIONAL_BONUS_MIN_FIXTURE_MINUTES) return 0
  return Number(provisionalBonus) || 0
}
