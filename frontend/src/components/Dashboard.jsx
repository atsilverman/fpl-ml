import { useState, useRef, useEffect } from 'react'
import { Outlet, useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { UserSearch, ChevronDown } from 'lucide-react'
import { useConfiguration } from '../contexts/ConfigurationContext'
import { supabase } from '../lib/supabase'
import './Dashboard.css'

const GAMEWEEK_VIEWS = [
  { id: 'matches', label: 'Matches', disabled: false },
  { id: 'bonus', label: 'Bonus', disabled: false },
  { id: 'defcon', label: 'DEFCON', disabled: false },
]

export default function Dashboard() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const { config, openConfigModal } = useConfiguration()
  const managerId = config?.managerId ?? null
  const leagueId = config?.leagueId ?? null
  const [gameweekDropdownOpen, setGameweekDropdownOpen] = useState(false)
  const gameweekDropdownRef = useRef(null)

  const gameweekView = searchParams.get('view') || 'defcon'
  const isOnGameweek = location.pathname === '/gameweek'

  useEffect(() => {
    if (!gameweekDropdownOpen) return
    const handleClickOutside = (e) => {
      if (gameweekDropdownRef.current && !gameweekDropdownRef.current.contains(e.target)) {
        setGameweekDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [gameweekDropdownOpen])

  const { data: managerRow } = useQuery({
    queryKey: ['manager-name', managerId],
    queryFn: async () => {
      if (!managerId) return null
      const { data } = await supabase.from('managers').select('manager_name, manager_team_name').eq('manager_id', managerId).single()
      return data
    },
    enabled: !!managerId,
    staleTime: 5 * 60 * 1000,
  })
  const { data: leagueRow } = useQuery({
    queryKey: ['league', leagueId],
    queryFn: async () => {
      if (!leagueId) return null
      const { data } = await supabase.from('mini_leagues').select('league_name').eq('league_id', leagueId).single()
      return data
    },
    enabled: !!leagueId,
    staleTime: 5 * 60 * 1000,
  })
  const managerDisplayName = managerRow?.manager_team_name || managerRow?.manager_name || (managerId ? `Manager ${managerId}` : null)
  const leagueName = leagueRow?.league_name || (leagueId ? `League ${leagueId}` : null)
  const subtitle = [managerDisplayName, leagueName].filter(Boolean).join(' · ') || null

  const pages = [
    { id: 'home', path: '/', label: 'Home' },
    { id: 'mini-league', path: '/mini-league', label: 'League' },
    { id: 'gameweek', path: '/gameweek', label: 'Gameweek' },
    { id: 'research', path: '/research', label: 'Research' }
  ]

  const currentPage = pages.find(p => location.pathname === p.path) || pages[0]

  const setGameweekView = (view) => {
    setSearchParams({ view }, { replace: true })
    setGameweekDropdownOpen(false)
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div className="header-content">
          <div className="header-title-section">
            <h1>FPL Mini League</h1>
            {subtitle && <p className="header-subtitle">{subtitle}</p>}
          </div>
          <button type="button" className="header-user-button" aria-label="Account" title="Account" onClick={openConfigModal}>
            <UserSearch size={16} strokeWidth={1.5} />
          </button>
        </div>
      </header>

      <nav className="page-selector-bottom tracking-mode-toggle" aria-label="Page navigation">
        {pages.map(page => {
          const isDisabled = !['home', 'mini-league', 'gameweek'].includes(page.id)
          if (page.id === 'gameweek') {
            return (
              <div key={page.id} className="nav-item-gameweek-wrap" ref={gameweekDropdownRef}>
                <button
                  type="button"
                  className={`tracking-mode-button nav-item-gameweek-trigger ${currentPage.id === 'gameweek' ? 'active' : ''}`}
                  onClick={() => {
                    setGameweekDropdownOpen(open => !open)
                  }}
                  disabled={isDisabled}
                  aria-expanded={gameweekDropdownOpen}
                  aria-haspopup="listbox"
                  aria-label="Gameweek view"
                >
                  <span>Gameweek</span>
                  <ChevronDown
                    size={16}
                    strokeWidth={2}
                    className={`nav-item-gameweek-chevron ${gameweekDropdownOpen ? 'nav-item-gameweek-chevron--open' : ''}`}
                    aria-hidden
                  />
                </button>
                {gameweekDropdownOpen && (
                  <div
                    className={`nav-item-gameweek-panel nav-item-gameweek-panel--open`}
                    role="listbox"
                    aria-label="Gameweek view"
                  >
                    {GAMEWEEK_VIEWS.map(view => (
                      <button
                        key={view.id}
                        type="button"
                        role="option"
                        aria-selected={currentPage.id === 'gameweek' && gameweekView === view.id}
                        className={`nav-item-gameweek-option ${currentPage.id === 'gameweek' && gameweekView === view.id ? 'nav-item-gameweek-option--active' : ''} ${view.disabled ? 'nav-item-gameweek-option--disabled' : ''}`}
                        onClick={() => {
                          if (view.disabled) return
                          if (currentPage.id !== 'gameweek') {
                            navigate(`/gameweek?view=${view.id}`)
                          } else {
                            setGameweekView(view.id)
                          }
                          setGameweekDropdownOpen(false)
                        }}
                        disabled={view.disabled}
                      >
                        {view.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          }
          return (
            <button
              key={page.id}
              className={`tracking-mode-button ${currentPage.id === page.id ? 'active' : ''}`}
              onClick={() => !isDisabled && navigate(page.path)}
              disabled={isDisabled}
            >
              {page.label}
            </button>
          )
        })}
      </nav>

      <main className="dashboard-content">
        <Outlet />
      </main>
    </div>
  )
}
