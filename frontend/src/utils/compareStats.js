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
  { key: 'defensive_contribution', label: 'DEF', higherBetter: true, showIfForward: true },
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
 * @param {{ per90?: boolean, minutes?: number }} options - When per90 true and minutes >= 90, show value per 90 (1 dp). Minutes is the player's minutes for per-90 divisor.
 */
export function formatStatValue(key, value, options = {}) {
  const { per90 = false, minutes } = options
  if (value == null) return '—'
  const num = Number(value)
  if (key === 'minutes') {
    if (per90) return String(Math.round(num))
    return String(Math.round(num))
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
 * When per90 is on and player has minutes >= 90, returns per-90 rate so highlight matches what's shown.
 */
export function getCompareValue(key, value, minutes, per90) {
  if (value == null) return 0
  const num = Number(value)
  if (key === 'minutes') return num
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
