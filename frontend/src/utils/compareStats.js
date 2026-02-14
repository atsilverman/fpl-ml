/**
 * Shared compare-stats config and helpers for PlayerCompareModal and CompareSubpage.
 * Position: 1 = GK, 2 = DEF, 3 = MID, 4 = FWD.
 */

export const COMPARE_STATS = [
  { key: 'points', label: 'Points', higherBetter: true },
  { key: 'minutes', label: 'Minutes', higherBetter: true },
  { key: 'goals_scored', label: 'Goals', higherBetter: true },
  { key: 'assists', label: 'Assists', higherBetter: true },
  { key: 'clean_sheets', label: 'Clean sheets', higherBetter: true, showIfForward: true },
  { key: 'saves', label: 'Saves', higherBetter: true, showIfKeeper: true },
  { key: 'bps', label: 'BPS', higherBetter: true },
  { key: 'bonus', label: 'Bonus', higherBetter: true },
  { key: 'defensive_contribution', label: 'DEFCON', higherBetter: true, showIfForward: true },
  { key: 'yellow_cards', label: 'Yellow cards', higherBetter: false },
  { key: 'red_cards', label: 'Red cards', higherBetter: false },
  { key: 'expected_goals', label: 'xG', higherBetter: true, hideIfBothKeepers: true },
  { key: 'expected_assists', label: 'xA', higherBetter: true, hideIfBothKeepers: true },
  { key: 'expected_goal_involvements', label: 'xGI', higherBetter: true, hideIfBothKeepers: true },
  { key: 'expected_goals_conceded', label: 'xGC', higherBetter: false, showIfForward: true },
]

/** pos1, pos2: 1=GK, 2=DEF, 3=MID, 4=FWD or null if player not selected */
export function getVisibleStats(pos1, pos2) {
  const hasKeeper = pos1 === 1 || pos2 === 1
  const hasForward = pos1 === 4 || pos2 === 4
  const bothKeepers = pos1 === 1 && pos2 === 1
  return COMPARE_STATS.filter((stat) => {
    if (stat.hideIfBothKeepers && bothKeepers) return false
    if (stat.showIfKeeper && !hasKeeper) return false
    if (stat.showIfForward && !hasForward) return false
    return true
  })
}

const DECIMAL_STAT_KEYS = ['expected_goals', 'expected_assists', 'expected_goal_involvements', 'expected_goals_conceded']

/**
 * Format a stat value for display.
 * @param {string} key - Stat key
 * @param {number|null|undefined} value - Raw value
 * @param {{ per90?: boolean, perMillion?: boolean, minutes?: number, priceTenths?: number }} options - per90: value per 90 mins; perMillion: value per £1m (priceTenths = cost_tenths, price in millions = priceTenths/10).
 */
export function formatStatValue(key, value, options = {}) {
  const { per90 = false, perMillion = false, minutes, priceTenths } = options
  if (value == null) return '—'
  const num = Number(value)
  if (key === 'minutes') {
    if (perMillion) return '—'
    if (per90) return String(Math.round(num))
    return String(Math.round(num))
  }
  if (perMillion && priceTenths != null && priceTenths > 0) {
    const priceMillions = priceTenths / 10
    const perM = num / priceMillions
    if (DECIMAL_STAT_KEYS.includes(key)) return perM === 0 ? '0' : perM.toFixed(2)
    return (Math.round(perM * 10) / 10).toFixed(1)
  }
  if (per90 && minutes != null && minutes >= 90) {
    const per90Val = (num * 90) / minutes
    return per90Val.toFixed(1)
  }
  if (DECIMAL_STAT_KEYS.includes(key)) {
    return num === 0 ? '0' : num.toFixed(2)
  }
  return String(Math.round(num))
}

/**
 * Numeric value used for comparison (and for leader highlighting).
 * When per90 is on and player has minutes >= 90, returns per-90 rate. When perMillion and priceTenths > 0, returns value per £1m.
 */
export function getCompareValue(key, value, minutes, per90, perMillion = false, priceTenths = null) {
  if (value == null) return 0
  const num = Number(value)
  if (key === 'minutes') return num
  if (perMillion && priceTenths != null && priceTenths > 0) {
    const priceMillions = priceTenths / 10
    return num / priceMillions
  }
  if (per90 && minutes != null && minutes >= 90) return (num * 90) / minutes
  return num
}

/** Returns 'p1' | 'p2' | 'tie' */
export function getLeader(key, higherBetter, v1, v2) {
  const a = Number(v1) ?? 0
  const b = Number(v2) ?? 0
  if (a === b) return 'tie'
  const p1Wins = higherBetter ? a > b : a < b
  return p1Wins ? 'p1' : 'p2'
}

/**
 * Format rank for display: "T-2" when tied, else the rank number.
 * @param {Record<string, number|boolean>|null} ranks - from usePlayerCompareStatRanks (has key and key_tie)
 * @param {string} key - stat key
 * @returns {string} e.g. "1", "T-2", "—"
 */
export function formatRankDisplay(ranks, key) {
  if (ranks == null) return '—'
  const r = ranks[key]
  if (r == null) return '—'
  const tie = ranks[key + '_tie'] === true
  return tie ? `T-${r}` : String(r)
}
