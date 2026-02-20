/**
 * Shared compare-stats config and helpers for PlayerCompareModal and CompareSubpage.
 * Stats are filtered by category (all | attacking | defending | goalie | discipline) like Stats subpage.
 */

/** Section for "All" view: general | attacking | defending | discipline. */
const SECTION_ORDER = ['general', 'attacking', 'defending', 'discipline']

/** Category can be a string or array of strings (stat shown if selected category matches). */
export const COMPARE_STATS = [
  { key: 'points', label: 'Points', higherBetter: true, category: 'all', section: 'general' },
  { key: 'minutes', label: 'Minutes', higherBetter: true, category: 'all', section: 'general' },
  { key: 'cost_tenths', label: 'Cost', higherBetter: false, category: 'all', fromPlayer: true, section: 'general' },
  { key: 'selected_by_percent', label: 'TSB%', higherBetter: true, category: 'all', fromPlayer: true, section: 'general' },
  { key: 'position', label: 'Position', higherBetter: true, category: 'all', fromPlayer: true, section: 'general', noLeader: true },
  { key: 'bps', label: 'BPS', higherBetter: true, category: 'all', section: 'general' },
  { key: 'bonus', label: 'Bonus', higherBetter: true, category: 'all', section: 'general' },
  { key: 'goals_scored', label: 'Goals', higherBetter: true, category: 'attacking', section: 'attacking' },
  { key: 'assists', label: 'Assists', higherBetter: true, category: 'attacking', section: 'attacking' },
  { key: 'expected_goals', label: 'xG', higherBetter: true, category: 'attacking', section: 'attacking' },
  { key: 'expected_assists', label: 'xA', higherBetter: true, category: 'attacking', section: 'attacking' },
  { key: 'expected_goal_involvements', label: 'xGI', higherBetter: true, category: 'attacking', section: 'attacking' },
  { key: 'clean_sheets', label: 'CS', higherBetter: true, category: ['defending', 'goalie'], section: 'defending' },
  { key: 'saves', label: 'Saves', higherBetter: true, category: 'goalie', section: 'defending' },
  { key: 'defensive_contribution', label: 'DEFCON', higherBetter: true, category: 'defending', section: 'defending' },
  { key: 'goals_conceded', label: 'GC', higherBetter: false, category: ['defending', 'goalie'], section: 'defending' },
  { key: 'expected_goals_conceded', label: 'xGC', higherBetter: false, category: ['defending', 'goalie'], section: 'defending' },
  { key: 'yellow_cards', label: 'YC', higherBetter: false, category: 'discipline', section: 'discipline' },
  { key: 'red_cards', label: 'RC', higherBetter: false, category: 'discipline', section: 'discipline' },
]

export const COMPARE_SECTION_LABELS = {
  general: 'General',
  attacking: 'Attacking',
  defending: 'Defending',
  discipline: 'Discipline',
}

export const COMPARE_STAT_CATEGORIES = [
  { key: 'all', label: 'All' },
  { key: 'attacking', label: 'Attacking' },
  { key: 'defending', label: 'Defending' },
  { key: 'goalie', label: 'Goalie' },
]

/** Returns stats visible for the selected category (like Stats subpage). */
export function getVisibleStatsByCategory(category) {
  if (category === 'all') return [...COMPARE_STATS]
  return COMPARE_STATS.filter((stat) => {
    const c = stat.category
    if (Array.isArray(c)) return c.includes(category)
    return c === category
  })
}

/** Returns stats visible for compare view; pos1/pos2 are player positions (optional, for future position-based filtering). */
export function getVisibleStats(pos1, pos2) {
  return getVisibleStatsByCategory('all')
}

/**
 * When category is 'all', returns groups of { sectionKey, sectionLabel, stats } for section headers + rows.
 * Otherwise returns null (render visibleStats as a flat list).
 */
export function getCompareTableGroups(category, visibleStats) {
  if (category !== 'all' || !visibleStats.length) return null
  const bySection = {}
  for (const stat of visibleStats) {
    const sec = stat.section || 'general'
    if (!bySection[sec]) bySection[sec] = []
    bySection[sec].push(stat)
  }
  return SECTION_ORDER.filter((sec) => bySection[sec]?.length).map((sectionKey) => ({
    sectionKey,
    sectionLabel: COMPARE_SECTION_LABELS[sectionKey] || sectionKey,
    stats: bySection[sectionKey],
  }))
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
  if (value == null && key !== 'cost_tenths' && key !== 'selected_by_percent') return '—'
  const num = Number(value)

  if (key === 'cost_tenths') {
    if (value == null) return '—'
    return `£${(num / 10).toFixed(1)}`
  }
  if (key === 'selected_by_percent') {
    if (value == null) return '—'
    return `${num.toFixed(1)}%`
  }
  if (key === 'position') {
    const labels = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' }
    return value != null && labels[value] ? labels[value] : '—'
  }

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
  if (value == null) return key === 'cost_tenths' ? Infinity : 0
  const num = Number(value)
  if (key === 'cost_tenths') return num
  if (key === 'selected_by_percent') return num
  if (key === 'position') return num
  if (key === 'minutes') return num
  if (perMillion && priceTenths != null && priceTenths > 0) {
    const priceMillions = priceTenths / 10
    return num / priceMillions
  }
  if (per90 && minutes != null && minutes >= 90) return (num * 90) / minutes
  return num
}

/** Returns 'p1' | 'p2' | 'tie'. For cost_tenths, lower is better so higherBetter is false. */
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
