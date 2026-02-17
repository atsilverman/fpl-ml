import { useMemo, useState, useCallback } from 'react'
import { Search, Filter, X, UserRound, UsersRound } from 'lucide-react'
import { useAllPlayersGameweekStats } from '../hooks/useAllPlayersGameweekStats'
import { useGameweekData } from '../hooks/useGameweekData'
import './ResearchPage.css'
import './BentoCard.css'
import './MiniLeaguePage.css'
import './StatsSubpage.css'

const GW_FILTER_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'last6', label: 'Last 6' },
  { key: 'last12', label: 'Last 12' }
]
const LOCATION_OPTIONS = [
  { key: 'all', label: 'All locations' },
  { key: 'home', label: 'Home' },
  { key: 'away', label: 'Away' }
]
const STAT_CATEGORY_OPTIONS = [
  { key: 'all', label: 'All stats' },
  { key: 'attacking', label: 'Attacking' },
  { key: 'defending', label: 'Defending' }
]

const SORT_COLUMNS_ALL = ['rank', 'player', 'pts', 'min', 'goals', 'assists', 'xg', 'xa', 'bps', 'cs', 'saves', 'defcon']
const DEFAULT_SORT = { column: 'pts', dir: 'desc' }

function SortTriangle({ direction }) {
  const isAsc = direction === 'asc'
  return (
    <span className="league-standings-sort-triangle" aria-hidden>
      <svg width="8" height="6" viewBox="0 0 8 6" fill="currentColor">
        {isAsc ? (
          <path d="M4 0L8 6H0L4 0Z" />
        ) : (
          <path d="M4 6L0 0h8L4 6Z" />
        )}
      </svg>
    </span>
  )
}

function formatX(value) {
  const n = Number(value)
  if (n === 0) return '0'
  return n.toFixed(2)
}

const POSITION_LABELS = { 1: 'GKP', 2: 'DEF', 3: 'MID', 4: 'FWD' }
function positionLabel(position) {
  if (position == null) return null
  return POSITION_LABELS[Number(position)] ?? null
}
function formatPriceTenths(costTenths) {
  if (costTenths == null) return null
  const n = Number(costTenths)
  if (Number.isNaN(n)) return null
  return `£${(n / 10).toFixed(1)}`
}

export default function StatsSubpage() {
  const { gameweek } = useGameweekData()
  const [gwFilter, setGwFilter] = useState('all')
  const [locationFilter, setLocationFilter] = useState('all')
  const [statCategory, setStatCategory] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [teamView, setTeamView] = useState(false)
  const { players, loading } = useAllPlayersGameweekStats(gwFilter, locationFilter)
  const [sort, setSort] = useState(DEFAULT_SORT)

  const handleSort = useCallback((column) => {
    if (!SORT_COLUMNS_ALL.includes(column)) return
    setSort((prev) => {
      if (prev.column === column) {
        return { column, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      }
      return { column, dir: column === 'player' ? 'asc' : 'desc' }
    })
  }, [])

  const cmp = useCallback(
    (mult, a, b, column) => {
      switch (column) {
        case 'rank':
          return mult * ((a.points ?? 0) - (b.points ?? 0))
        case 'player':
          return mult * (a.web_name || '').localeCompare(b.web_name || '')
        case 'pts':
          return mult * ((a.points ?? 0) - (b.points ?? 0))
        case 'min':
          return mult * ((a.minutes ?? 0) - (b.minutes ?? 0))
        case 'goals':
          return mult * ((a.goals_scored ?? 0) - (b.goals_scored ?? 0))
        case 'assists':
          return mult * ((a.assists ?? 0) - (b.assists ?? 0))
        case 'xg':
          return mult * ((a.expected_goals ?? 0) - (b.expected_goals ?? 0))
        case 'xa':
          return mult * ((a.expected_assists ?? 0) - (b.expected_assists ?? 0))
        case 'bps':
          return mult * ((a.bps ?? 0) - (b.bps ?? 0))
        case 'cs':
          return mult * ((a.clean_sheets ?? 0) - (b.clean_sheets ?? 0))
        case 'saves':
          return mult * ((a.saves ?? 0) - (b.saves ?? 0))
        case 'defcon':
          return mult * ((a.defensive_contribution ?? 0) - (b.defensive_contribution ?? 0))
        default:
          return 0
      }
    },
    []
  )

  const sortedRows = useMemo(() => {
    if (!players.length) return []
    const mult = sort.dir === 'asc' ? 1 : -1
    const sortCmp = (a, b) => cmp(mult, a, b, sort.column)
    return [...players].sort(sortCmp).map((p, i) => ({ ...p, _rank: i + 1 }))
  }, [players, sort.column, sort.dir, cmp])

  const teamRowsRaw = useMemo(() => {
    if (!players.length) return []
    const byTeam = new Map()
    for (const p of players) {
      const key = p.team_short_name ?? '—'
      const existing = byTeam.get(key)
      const row = {
        team_short_name: p.team_short_name ?? null,
        web_name: p.team_short_name ?? '—',
        points: (existing?.points ?? 0) + (p.points ?? 0),
        minutes: (existing?.minutes ?? 0) + (p.minutes ?? 0),
        goals_scored: (existing?.goals_scored ?? 0) + (p.goals_scored ?? 0),
        assists: (existing?.assists ?? 0) + (p.assists ?? 0),
        expected_goals: (existing?.expected_goals ?? 0) + (p.expected_goals ?? 0),
        expected_assists: (existing?.expected_assists ?? 0) + (p.expected_assists ?? 0),
        bps: (existing?.bps ?? 0) + (p.bps ?? 0),
        clean_sheets: (existing?.clean_sheets ?? 0) + (p.clean_sheets ?? 0),
        saves: (existing?.saves ?? 0) + (p.saves ?? 0),
        defensive_contribution: (existing?.defensive_contribution ?? 0) + (p.defensive_contribution ?? 0)
      }
      byTeam.set(key, row)
    }
    return Array.from(byTeam.values())
  }, [players])

  const sortedTeamRows = useMemo(() => {
    if (!teamRowsRaw.length) return []
    const mult = sort.dir === 'asc' ? 1 : -1
    const sortCmp = (a, b) => cmp(mult, a, b, sort.column)
    return [...teamRowsRaw].sort(sortCmp).map((r, i) => ({ ...r, _rank: i + 1 }))
  }, [teamRowsRaw, sort.column, sort.dir, cmp])

  const searchLower = (searchQuery || '').trim().toLowerCase()
  const filteredRows = useMemo(() => {
    if (!searchLower) return sortedRows
    return sortedRows.filter(
      (r) =>
        (r.web_name || '').toLowerCase().includes(searchLower) ||
        (r.team_short_name || '').toLowerCase().includes(searchLower)
    )
  }, [sortedRows, searchLower])

  const filteredTeamRows = useMemo(() => {
    if (!searchLower) return sortedTeamRows
    return sortedTeamRows.filter(
      (r) => (r.web_name || '').toLowerCase().includes(searchLower) || (r.team_short_name || '').toLowerCase().includes(searchLower)
    )
  }, [sortedTeamRows, searchLower])

  const activeRows = teamView ? filteredTeamRows : filteredRows
  const playerColMinCh = useMemo(() => {
    if (!activeRows.length) return 12
    const max = Math.max(...activeRows.map((r) => (r.web_name || '').length))
    return Math.min(Math.max(max + 1, 10), 28)
  }, [activeRows])

  return (
    <div className="research-stats-subpage research-stats-page league-standings-page">
      <div className="research-stats-card research-card bento-card bento-card-animate bento-card-expanded">
          <div className="research-stats-toolbar">
            <button
              type="button"
              className={`stats-filter-btn stats-view-toggle-btn ${teamView ? 'stats-view-toggle-btn--active' : ''}`}
              onClick={() => setTeamView((v) => !v)}
              aria-label={teamView ? 'Show player stats' : 'Show team stats'}
              aria-pressed={teamView}
            >
              {teamView ? (
                <UsersRound size={14} strokeWidth={2} fill="currentColor" />
              ) : (
                <UserRound size={14} strokeWidth={2} />
              )}
            </button>
            <div className="research-stats-search-wrap">
              <Search className="research-stats-search-icon" size={14} strokeWidth={2} aria-hidden />
              <input
                type="search"
                className="research-stats-search-input"
                placeholder="Search player or team"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Search players"
              />
            </div>
            {!showFilters ? (
              <button
                type="button"
                className="stats-filter-btn"
                onClick={() => setShowFilters(true)}
                aria-label="Show filters"
                aria-expanded={false}
              >
                <Filter size={14} strokeWidth={2} />
              </button>
            ) : (
              <button
                type="button"
                className="stats-filter-btn stats-filter-btn-close"
                onClick={() => setShowFilters(false)}
                aria-label="Close filters"
                aria-expanded={true}
              >
                <X size={14} strokeWidth={2} />
              </button>
            )}
          </div>
          {showFilters && (
          <div className="research-stats-filters" role="group" aria-label="Stats filters">
            <div className="stats-filter-section">
              <div className="stats-filter-section-title">Gameweeks</div>
              <div className="stats-filter-buttons">
                {GW_FILTER_OPTIONS.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    className={`stats-filter-option-btn ${gwFilter === key ? 'stats-filter-option-btn--active' : ''}`}
                    onClick={() => setGwFilter(key)}
                    aria-pressed={gwFilter === key}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="stats-filter-section">
              <div className="stats-filter-section-title">Location</div>
              <div className="stats-filter-buttons">
                {LOCATION_OPTIONS.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    className={`stats-filter-option-btn ${locationFilter === key ? 'stats-filter-option-btn--active' : ''}`}
                    onClick={() => setLocationFilter(key)}
                    aria-pressed={locationFilter === key}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="stats-filter-section">
              <div className="stats-filter-section-title">Stats</div>
              <div className="stats-filter-buttons">
                {STAT_CATEGORY_OPTIONS.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    className={`stats-filter-option-btn ${statCategory === key ? 'stats-filter-option-btn--active' : ''}`}
                    onClick={() => setStatCategory(key)}
                    aria-pressed={statCategory === key}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          )}
          <div className="research-stats-content">
            <div className="league-standings-bento league-standings-bento-page">
              <div className="league-standings-bento-body">
                <div className="league-standings-bento-table-wrapper">
                  {loading ? (
                    <div className="league-standings-bento-loading">Loading…</div>
                  ) : teamView ? !filteredTeamRows.length ? (
                    <div className="league-standings-bento-empty">
                      {searchLower ? 'No teams match your search.' : 'No stats for this period.'}
                    </div>
                  ) : (
                    <table
                        className={`league-standings-bento-table research-stats-table research-stats-table--${statCategory} research-stats-table--team`}
                        style={{ '--stats-player-min-ch': playerColMinCh }}
                      >
                      <colgroup>
                        {statCategory === 'all' && (
                          <>
                            <col className="league-standings-bento-col-rank" style={{ width: '10px' }} />
                            <col className="league-standings-bento-col-manager" style={{ width: '42px' }} />
                            <col style={{ width: '18px' }} />
                            <col style={{ width: '18px' }} />
                            <col style={{ width: '18px' }} />
                            <col style={{ width: '18px' }} />
                            <col style={{ width: '18px' }} />
                            <col style={{ width: '18px' }} />
                            <col style={{ width: '18px' }} />
                            <col style={{ width: '18px' }} />
                            <col style={{ width: '18px' }} />
                            <col style={{ width: '18px' }} />
                            <col style={{ width: '18px' }} />
                          </>
                        )}
                        {statCategory === 'attacking' && (
                          <>
                            <col className="league-standings-bento-col-rank" style={{ width: '10px' }} />
                            <col className="league-standings-bento-col-manager" style={{ width: '42px' }} />
                            <col style={{ width: '18px' }} />
                            <col style={{ width: '18px' }} />
                            <col style={{ width: '18px' }} />
                            <col style={{ width: '18px' }} />
                            <col style={{ width: '18px' }} />
                            <col style={{ width: '18px' }} />
                            <col style={{ width: '18px' }} />
                          </>
                        )}
                        {statCategory === 'defending' && (
                          <>
                            <col className="league-standings-bento-col-rank" style={{ width: '10px' }} />
                            <col className="league-standings-bento-col-manager" style={{ width: '42px' }} />
                            <col style={{ width: '18px' }} />
                            <col style={{ width: '18px' }} />
                            <col style={{ width: '18px' }} />
                            <col style={{ width: '18px' }} />
                            <col style={{ width: '18px' }} />
                          </>
                        )}
                      </colgroup>
                      <thead>
                        <tr>
                          <th className="league-standings-bento-rank">
                            <button
                              type="button"
                              className="league-standings-sort-header"
                              onClick={() => handleSort('rank')}
                              aria-sort={sort.column === 'rank' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                            >
                              #
                              <span className="league-standings-sort-triangle-slot">
                                {sort.column === 'rank' ? <SortTriangle direction={sort.dir} /> : null}
                              </span>
                            </button>
                          </th>
                          <th className="league-standings-bento-team">
                            <button
                              type="button"
                              className="league-standings-sort-header"
                              onClick={() => handleSort('player')}
                              aria-sort={sort.column === 'player' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                            >
                              Team
                              <span className="league-standings-sort-triangle-slot">
                                {sort.column === 'player' ? <SortTriangle direction={sort.dir} /> : null}
                              </span>
                            </button>
                          </th>
                          <th className="league-standings-bento-total">
                            <button
                              type="button"
                              className="league-standings-sort-header"
                              onClick={() => handleSort('pts')}
                              aria-sort={sort.column === 'pts' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                            >
                              Pts
                              <span className="league-standings-sort-triangle-slot">
                                {sort.column === 'pts' ? <SortTriangle direction={sort.dir} /> : null}
                              </span>
                            </button>
                          </th>
                          <th className="league-standings-bento-gw">
                            <button
                              type="button"
                              className="league-standings-sort-header"
                              onClick={() => handleSort('min')}
                              aria-sort={sort.column === 'min' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                            >
                              Min
                              <span className="league-standings-sort-triangle-slot">
                                {sort.column === 'min' ? <SortTriangle direction={sort.dir} /> : null}
                              </span>
                            </button>
                          </th>
                          {(statCategory === 'all' || statCategory === 'attacking') && (
                          <>
                          <th className="league-standings-bento-gw">
                            <button
                              type="button"
                              className="league-standings-sort-header"
                              onClick={() => handleSort('goals')}
                              aria-sort={sort.column === 'goals' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                            >
                              G
                              <span className="league-standings-sort-triangle-slot">
                                {sort.column === 'goals' ? <SortTriangle direction={sort.dir} /> : null}
                              </span>
                            </button>
                          </th>
                          <th className="league-standings-bento-gw">
                            <button
                              type="button"
                              className="league-standings-sort-header"
                              onClick={() => handleSort('assists')}
                              aria-sort={sort.column === 'assists' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                            >
                              A
                              <span className="league-standings-sort-triangle-slot">
                                {sort.column === 'assists' ? <SortTriangle direction={sort.dir} /> : null}
                              </span>
                            </button>
                          </th>
                          <th className="league-standings-bento-gw">
                            <button
                              type="button"
                              className="league-standings-sort-header"
                              onClick={() => handleSort('xg')}
                              aria-sort={sort.column === 'xg' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                            >
                              xG
                              <span className="league-standings-sort-triangle-slot">
                                {sort.column === 'xg' ? <SortTriangle direction={sort.dir} /> : null}
                              </span>
                            </button>
                          </th>
                          <th className="league-standings-bento-gw">
                            <button
                              type="button"
                              className="league-standings-sort-header"
                              onClick={() => handleSort('xa')}
                              aria-sort={sort.column === 'xa' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                            >
                              xA
                              <span className="league-standings-sort-triangle-slot">
                                {sort.column === 'xa' ? <SortTriangle direction={sort.dir} /> : null}
                              </span>
                            </button>
                          </th>
                          <th className="league-standings-bento-gw">
                            <button
                              type="button"
                              className="league-standings-sort-header"
                              onClick={() => handleSort('bps')}
                              aria-sort={sort.column === 'bps' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                            >
                              BPS
                              <span className="league-standings-sort-triangle-slot">
                                {sort.column === 'bps' ? <SortTriangle direction={sort.dir} /> : null}
                              </span>
                            </button>
                          </th>
                          </>
                          )}
                          {(statCategory === 'all' || statCategory === 'defending') && (
                          <>
                          <th className="league-standings-bento-gw">
                            <button type="button" className="league-standings-sort-header" onClick={() => handleSort('cs')} aria-sort={sort.column === 'cs' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                              CS<span className="league-standings-sort-triangle-slot">{sort.column === 'cs' ? <SortTriangle direction={sort.dir} /> : null}</span>
                            </button>
                          </th>
                          <th className="league-standings-bento-gw">
                            <button type="button" className="league-standings-sort-header" onClick={() => handleSort('saves')} aria-sort={sort.column === 'saves' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                              Saves<span className="league-standings-sort-triangle-slot">{sort.column === 'saves' ? <SortTriangle direction={sort.dir} /> : null}</span>
                            </button>
                          </th>
                          <th className="league-standings-bento-gw">
                            <button type="button" className="league-standings-sort-header" onClick={() => handleSort('defcon')} aria-sort={sort.column === 'defcon' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                              DEFCON<span className="league-standings-sort-triangle-slot">{sort.column === 'defcon' ? <SortTriangle direction={sort.dir} /> : null}</span>
                            </button>
                          </th>
                          </>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredTeamRows.map((row) => (
                          <tr key={row.team_short_name ?? `team-${row._rank}`} className="league-standings-bento-row">
                            <td className="league-standings-bento-rank">
                              <span className="league-standings-bento-rank-inner">
                                <span className="league-standings-bento-rank-value">{row._rank}</span>
                              </span>
                            </td>
                            <td className="league-standings-bento-team" title={row.web_name}>
                              <span className="research-stats-player-cell">
                                {row.team_short_name && row.team_short_name !== '—' && (
                                  <img
                                    src={`/badges/${row.team_short_name}.svg`}
                                    alt=""
                                    className="research-stats-badge"
                                    onError={(e) => { e.target.style.display = 'none' }}
                                  />
                                )}
                                <span className="research-stats-player-cell-lines">
                                  <span className="league-standings-bento-team-name">{row.web_name}</span>
                                </span>
                              </span>
                            </td>
                            <td className={`league-standings-bento-total ${(row.points ?? 0) === 0 ? 'league-standings-bento-cell-muted' : ''}`}>{row.points}</td>
                            <td className={`league-standings-bento-gw ${(row.minutes ?? 0) === 0 ? 'league-standings-bento-cell-muted' : ''}`}>{row.minutes}</td>
                            {(statCategory === 'all' || statCategory === 'attacking') && (
                              <>
                                <td className={`league-standings-bento-gw ${(row.goals_scored ?? 0) === 0 ? 'league-standings-bento-cell-muted' : ''}`}>{row.goals_scored}</td>
                                <td className={`league-standings-bento-gw ${(row.assists ?? 0) === 0 ? 'league-standings-bento-cell-muted' : ''}`}>{row.assists}</td>
                                <td className={`league-standings-bento-gw ${(row.expected_goals ?? 0) === 0 ? 'league-standings-bento-cell-muted' : ''}`}>{formatX(row.expected_goals)}</td>
                                <td className={`league-standings-bento-gw ${(row.expected_assists ?? 0) === 0 ? 'league-standings-bento-cell-muted' : ''}`}>{formatX(row.expected_assists)}</td>
                                <td className={`league-standings-bento-gw ${(row.bps ?? 0) === 0 ? 'league-standings-bento-cell-muted' : ''}`}>{row.bps}</td>
                              </>
                            )}
                            {(statCategory === 'all' || statCategory === 'defending') && (
                              <>
                                <td className={`league-standings-bento-gw ${(row.clean_sheets ?? 0) === 0 ? 'league-standings-bento-cell-muted' : ''}`}>{row.clean_sheets}</td>
                                <td className={`league-standings-bento-gw ${(row.saves ?? 0) === 0 ? 'league-standings-bento-cell-muted' : ''}`}>{row.saves}</td>
                                <td className={`league-standings-bento-gw ${(row.defensive_contribution ?? 0) === 0 ? 'league-standings-bento-cell-muted' : ''}`}>{row.defensive_contribution}</td>
                              </>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : !filteredRows.length ? (
                    <div className="league-standings-bento-empty">
                      {searchLower ? 'No players match your search.' : 'No stats for this period.'}
                    </div>
                  ) : (
                    <table
                        className={`league-standings-bento-table research-stats-table research-stats-table--${statCategory}`}
                        style={{ '--stats-player-min-ch': playerColMinCh }}
                      >
                      <colgroup>
                        {statCategory === 'all' && (
                          <>
                            <col className="league-standings-bento-col-rank" style={{ width: '10px' }} />
                            <col className="league-standings-bento-col-manager" style={{ width: '42px' }} />
                            <col style={{ width: '18px' }} />
                            <col style={{ width: '18px' }} />
                            <col style={{ width: '18px' }} />
                            <col style={{ width: '18px' }} />
                            <col style={{ width: '18px' }} />
                            <col style={{ width: '18px' }} />
                            <col style={{ width: '18px' }} />
                            <col style={{ width: '18px' }} />
                            <col style={{ width: '18px' }} />
                            <col style={{ width: '18px' }} />
                            <col style={{ width: '18px' }} />
                          </>
                        )}
                        {statCategory === 'attacking' && (
                          <>
                            <col className="league-standings-bento-col-rank" style={{ width: '10px' }} />
                            <col className="league-standings-bento-col-manager" style={{ width: '42px' }} />
                            <col style={{ width: '18px' }} />
                            <col style={{ width: '18px' }} />
                            <col style={{ width: '18px' }} />
                            <col style={{ width: '18px' }} />
                            <col style={{ width: '18px' }} />
                            <col style={{ width: '18px' }} />
                            <col style={{ width: '18px' }} />
                          </>
                        )}
                        {statCategory === 'defending' && (
                          <>
                            <col className="league-standings-bento-col-rank" style={{ width: '10px' }} />
                            <col className="league-standings-bento-col-manager" style={{ width: '42px' }} />
                            <col style={{ width: '18px' }} />
                            <col style={{ width: '18px' }} />
                            <col style={{ width: '18px' }} />
                            <col style={{ width: '18px' }} />
                            <col style={{ width: '18px' }} />
                          </>
                        )}
                      </colgroup>
                      <thead>
                        <tr>
                          <th className="league-standings-bento-rank">
                            <button
                              type="button"
                              className="league-standings-sort-header"
                              onClick={() => handleSort('rank')}
                              aria-sort={sort.column === 'rank' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                            >
                              #
                              <span className="league-standings-sort-triangle-slot">
                                {sort.column === 'rank' ? <SortTriangle direction={sort.dir} /> : null}
                              </span>
                            </button>
                          </th>
                          <th className="league-standings-bento-team">
                            <button
                              type="button"
                              className="league-standings-sort-header"
                              onClick={() => handleSort('player')}
                              aria-sort={sort.column === 'player' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                            >
                              Player
                              <span className="league-standings-sort-triangle-slot">
                                {sort.column === 'player' ? <SortTriangle direction={sort.dir} /> : null}
                              </span>
                            </button>
                          </th>
                          <th className="league-standings-bento-total">
                            <button
                              type="button"
                              className="league-standings-sort-header"
                              onClick={() => handleSort('pts')}
                              aria-sort={sort.column === 'pts' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                            >
                              Pts
                              <span className="league-standings-sort-triangle-slot">
                                {sort.column === 'pts' ? <SortTriangle direction={sort.dir} /> : null}
                              </span>
                            </button>
                          </th>
                          <th className="league-standings-bento-gw">
                            <button
                              type="button"
                              className="league-standings-sort-header"
                              onClick={() => handleSort('min')}
                              aria-sort={sort.column === 'min' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                            >
                              Min
                              <span className="league-standings-sort-triangle-slot">
                                {sort.column === 'min' ? <SortTriangle direction={sort.dir} /> : null}
                              </span>
                            </button>
                          </th>
                          {(statCategory === 'all' || statCategory === 'attacking') && (
                          <>
                          <th className="league-standings-bento-gw">
                            <button
                              type="button"
                              className="league-standings-sort-header"
                              onClick={() => handleSort('goals')}
                              aria-sort={sort.column === 'goals' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                            >
                              G
                              <span className="league-standings-sort-triangle-slot">
                                {sort.column === 'goals' ? <SortTriangle direction={sort.dir} /> : null}
                              </span>
                            </button>
                          </th>
                          <th className="league-standings-bento-gw">
                            <button
                              type="button"
                              className="league-standings-sort-header"
                              onClick={() => handleSort('assists')}
                              aria-sort={sort.column === 'assists' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                            >
                              A
                              <span className="league-standings-sort-triangle-slot">
                                {sort.column === 'assists' ? <SortTriangle direction={sort.dir} /> : null}
                              </span>
                            </button>
                          </th>
                          <th className="league-standings-bento-gw">
                            <button
                              type="button"
                              className="league-standings-sort-header"
                              onClick={() => handleSort('xg')}
                              aria-sort={sort.column === 'xg' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                            >
                              xG
                              <span className="league-standings-sort-triangle-slot">
                                {sort.column === 'xg' ? <SortTriangle direction={sort.dir} /> : null}
                              </span>
                            </button>
                          </th>
                          <th className="league-standings-bento-gw">
                            <button
                              type="button"
                              className="league-standings-sort-header"
                              onClick={() => handleSort('xa')}
                              aria-sort={sort.column === 'xa' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                            >
                              xA
                              <span className="league-standings-sort-triangle-slot">
                                {sort.column === 'xa' ? <SortTriangle direction={sort.dir} /> : null}
                              </span>
                            </button>
                          </th>
                          <th className="league-standings-bento-gw">
                            <button
                              type="button"
                              className="league-standings-sort-header"
                              onClick={() => handleSort('bps')}
                              aria-sort={sort.column === 'bps' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                            >
                              BPS
                              <span className="league-standings-sort-triangle-slot">
                                {sort.column === 'bps' ? <SortTriangle direction={sort.dir} /> : null}
                              </span>
                            </button>
                          </th>
                          </>
                          )}
                          {(statCategory === 'all' || statCategory === 'defending') && (
                          <>
                          <th className="league-standings-bento-gw">
                            <button type="button" className="league-standings-sort-header" onClick={() => handleSort('cs')} aria-sort={sort.column === 'cs' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                              CS<span className="league-standings-sort-triangle-slot">{sort.column === 'cs' ? <SortTriangle direction={sort.dir} /> : null}</span>
                            </button>
                          </th>
                          <th className="league-standings-bento-gw">
                            <button type="button" className="league-standings-sort-header" onClick={() => handleSort('saves')} aria-sort={sort.column === 'saves' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                              Saves<span className="league-standings-sort-triangle-slot">{sort.column === 'saves' ? <SortTriangle direction={sort.dir} /> : null}</span>
                            </button>
                          </th>
                          <th className="league-standings-bento-gw">
                            <button type="button" className="league-standings-sort-header" onClick={() => handleSort('defcon')} aria-sort={sort.column === 'defcon' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                              DEFCON<span className="league-standings-sort-triangle-slot">{sort.column === 'defcon' ? <SortTriangle direction={sort.dir} /> : null}</span>
                            </button>
                          </th>
                          </>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredRows.map((row) => (
                          <tr key={row.player_id} className="league-standings-bento-row">
                            <td className="league-standings-bento-rank">
                              <span className="league-standings-bento-rank-inner">
                                <span className="league-standings-bento-rank-value">{row._rank}</span>
                              </span>
                            </td>
                            <td className="league-standings-bento-team" title={row.web_name}>
                              <span className="research-stats-player-cell">
                                {row.team_short_name && (
                                  <img
                                    src={`/badges/${row.team_short_name}.svg`}
                                    alt=""
                                    className="research-stats-badge"
                                    onError={(e) => { e.target.style.display = 'none' }}
                                  />
                                )}
                                <span className="research-stats-player-cell-lines">
                                  <span className="league-standings-bento-team-name">{row.web_name}</span>
                                  {(positionLabel(row.position) != null || formatPriceTenths(row.cost_tenths) != null) && (
                                    <span className="research-stats-meta-line">
                                      {positionLabel(row.position) != null && (
                                        <span
                                          className={`research-stats-position gw-top-points-position gw-top-points-position--${row.position}`}
                                          title={`Position: ${positionLabel(row.position)}`}
                                          aria-label={positionLabel(row.position)}
                                        >
                                          {positionLabel(row.position)}
                                        </span>
                                      )}
                                      {positionLabel(row.position) != null && formatPriceTenths(row.cost_tenths) != null && (
                                        <span className="research-stats-meta-dot" aria-hidden> • </span>
                                      )}
                                      {formatPriceTenths(row.cost_tenths) != null && (
                                        <span className="research-stats-price" title="Current price">
                                          {formatPriceTenths(row.cost_tenths)}
                                        </span>
                                      )}
                                    </span>
                                  )}
                                </span>
                              </span>
                            </td>
                            <td className={`league-standings-bento-total ${(row.points ?? 0) === 0 ? 'league-standings-bento-cell-muted' : ''}`}>{row.points}</td>
                            <td className={`league-standings-bento-gw ${(row.minutes ?? 0) === 0 ? 'league-standings-bento-cell-muted' : ''}`}>{row.minutes}</td>
                            {(statCategory === 'all' || statCategory === 'attacking') && (
                              <>
                                <td className={`league-standings-bento-gw ${(row.goals_scored ?? 0) === 0 ? 'league-standings-bento-cell-muted' : ''}`}>{row.goals_scored}</td>
                                <td className={`league-standings-bento-gw ${(row.assists ?? 0) === 0 ? 'league-standings-bento-cell-muted' : ''}`}>{row.assists}</td>
                                <td className={`league-standings-bento-gw ${(row.expected_goals ?? 0) === 0 ? 'league-standings-bento-cell-muted' : ''}`}>{formatX(row.expected_goals)}</td>
                                <td className={`league-standings-bento-gw ${(row.expected_assists ?? 0) === 0 ? 'league-standings-bento-cell-muted' : ''}`}>{formatX(row.expected_assists)}</td>
                                <td className={`league-standings-bento-gw ${(row.bps ?? 0) === 0 ? 'league-standings-bento-cell-muted' : ''}`}>{row.bps}</td>
                              </>
                            )}
                            {(statCategory === 'all' || statCategory === 'defending') && (
                              <>
                                <td className={`league-standings-bento-gw ${(row.clean_sheets ?? 0) === 0 ? 'league-standings-bento-cell-muted' : ''}`}>{row.clean_sheets}</td>
                                <td className={`league-standings-bento-gw ${(row.saves ?? 0) === 0 ? 'league-standings-bento-cell-muted' : ''}`}>{row.saves}</td>
                                <td className={`league-standings-bento-gw ${(row.defensive_contribution ?? 0) === 0 ? 'league-standings-bento-cell-muted' : ''}`}>{row.defensive_contribution}</td>
                              </>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
    </div>
  )
}
