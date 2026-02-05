import { useState, useRef, useEffect } from 'react'
import { Outlet, useNavigate, useLocation, useSearchParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Pencil, ChevronDown } from 'lucide-react'
import DebugModal from './DebugModal'
import UserAvatar from './UserAvatar'
import AccountModal from './AccountModal'
import { useConfiguration } from '../contexts/ConfigurationContext'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import './Dashboard.css'

const GAMEWEEK_VIEWS = [
  { id: 'matches', label: 'Matches', disabled: false },
  { id: 'bonus', label: 'Bonus', disabled: false },
  { id: 'defcon', label: 'DEFCON', disabled: false },
]

const RESEARCH_VIEWS = [
  { id: 'price-changes', label: 'Price Changes', disabled: false },
  { id: 'schedule', label: 'Schedule', disabled: false },
]

export default function Dashboard() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const { config, openConfigModal, loading: configLoading } = useConfiguration()
  const { user, loading: authLoading } = useAuth()
  const managerId = config?.managerId ?? null
  const leagueId = config?.leagueId ?? null
  const [gameweekDropdownOpen, setGameweekDropdownOpen] = useState(false)
  const gameweekDropdownRef = useRef(null)
  const gameweekCloseTimeoutRef = useRef(null)
  const [researchDropdownOpen, setResearchDropdownOpen] = useState(false)
  const researchDropdownRef = useRef(null)
  const researchCloseTimeoutRef = useRef(null)

  const hasHover = () => typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches
  const HOVER_LEAVE_MS = 180

  const gameweekView = searchParams.get('view') || 'defcon'
  const isOnGameweek = location.pathname === '/gameweek'
  const [toggleBonus, setToggleBonus] = useState(false)
  const [showH2H, setShowH2H] = useState(false)
  const [debugModalOpen, setDebugModalOpen] = useState(false)
  const [accountModalOpen, setAccountModalOpen] = useState(false)

  useEffect(() => {
    // Wait for auth to resolve before redirecting (prevents flash of login screen when already signed in)
    if (authLoading) return
    if (!configLoading && config == null) {
      navigate('/welcome', { replace: true })
    }
  }, [authLoading, configLoading, config, navigate])

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

  useEffect(() => {
    if (!researchDropdownOpen) return
    const handleClickOutside = (e) => {
      if (researchDropdownRef.current && !researchDropdownRef.current.contains(e.target)) {
        setResearchDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [researchDropdownOpen])

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

  const researchView = searchParams.get('view') || 'price-changes'
  const isOnResearch = location.pathname === '/research'
  const setResearchView = (view) => {
    if (isOnResearch) {
      setSearchParams({ view }, { replace: true })
    } else {
      navigate(`/research?view=${view}`)
    }
    setResearchDropdownOpen(false)
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div className="header-content">
          <div className="header-title-section">
            <Link to="/" className="header-title-link" aria-label="Go to home">
              <h1>FPL Mini League</h1>
            </Link>
            <div className="header-subtitle-row">
              {subtitle && <p className="header-subtitle">{subtitle}</p>}
              <button type="button" className="header-config-icon" aria-label="Configure league and manager" title="Configure league and manager" onClick={openConfigModal}>
                <Pencil size={12} strokeWidth={1.5} />
              </button>
            </div>
          </div>
          <nav className="header-nav page-selector-bottom tracking-mode-toggle" aria-label="Page navigation">
        {pages.map(page => {
          const isDisabled = !['home', 'mini-league', 'gameweek', 'research'].includes(page.id)
          if (page.id === 'gameweek') {
            return (
              <div
                key={page.id}
                className="nav-item-gameweek-wrap"
                ref={gameweekDropdownRef}
                onMouseEnter={() => {
                  if (gameweekCloseTimeoutRef.current) {
                    clearTimeout(gameweekCloseTimeoutRef.current)
                    gameweekCloseTimeoutRef.current = null
                  }
                  if (hasHover()) setGameweekDropdownOpen(true)
                }}
                onMouseLeave={() => {
                  if (!hasHover()) return
                  gameweekCloseTimeoutRef.current = setTimeout(() => {
                    setGameweekDropdownOpen(false)
                    gameweekCloseTimeoutRef.current = null
                  }, HOVER_LEAVE_MS)
                }}
              >
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
                    size={12}
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
          if (page.id === 'research') {
            return (
              <div
                key={page.id}
                className="nav-item-gameweek-wrap"
                ref={researchDropdownRef}
                onMouseEnter={() => {
                  if (researchCloseTimeoutRef.current) {
                    clearTimeout(researchCloseTimeoutRef.current)
                    researchCloseTimeoutRef.current = null
                  }
                  if (hasHover()) setResearchDropdownOpen(true)
                }}
                onMouseLeave={() => {
                  if (!hasHover()) return
                  researchCloseTimeoutRef.current = setTimeout(() => {
                    setResearchDropdownOpen(false)
                    researchCloseTimeoutRef.current = null
                  }, HOVER_LEAVE_MS)
                }}
              >
                <button
                  type="button"
                  className={`tracking-mode-button nav-item-gameweek-trigger ${currentPage.id === 'research' ? 'active' : ''}`}
                  onClick={() => {
                    setResearchDropdownOpen((open) => !open)
                  }}
                  disabled={isDisabled}
                  aria-expanded={researchDropdownOpen}
                  aria-haspopup="listbox"
                  aria-label="Research"
                >
                  <span>Research</span>
                  <ChevronDown
                    size={12}
                    strokeWidth={2}
                    className={`nav-item-gameweek-chevron ${researchDropdownOpen ? 'nav-item-gameweek-chevron--open' : ''}`}
                    aria-hidden
                  />
                </button>
                {researchDropdownOpen && (
                  <div
                    className="nav-item-gameweek-panel nav-item-gameweek-panel--open"
                    role="listbox"
                    aria-label="Research"
                  >
                    {RESEARCH_VIEWS.map((view) => (
                      <button
                        key={view.id}
                        type="button"
                        role="option"
                        aria-selected={currentPage.id === 'research' && researchView === view.id}
                        className={`nav-item-gameweek-option ${currentPage.id === 'research' && researchView === view.id ? 'nav-item-gameweek-option--active' : ''} ${view.disabled ? 'nav-item-gameweek-option--disabled' : ''}`}
                        onClick={() => {
                          if (view.disabled) return
                          setResearchView(view.id)
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
          <div className="header-buttons">
            {user ? (
              <button type="button" className="header-user-account" aria-label="Account" title="Account" onClick={() => setAccountModalOpen(true)}>
                <span className="header-user-avatar-wrap">
                  <UserAvatar user={user} className="header-user-avatar-img" alt="" />
                </span>
                <span className="header-user-name">{user.user_metadata?.full_name || user.email}</span>
              </button>
            ) : (
              <button type="button" className="header-login-google" aria-label="Sign in with Google" title="Sign in with Google" onClick={() => setAccountModalOpen(true)}>
                <svg className="header-google-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden>
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="dashboard-content">
        <Outlet context={{ toggleBonus, setToggleBonus, showH2H, setShowH2H, openDebugModal: () => setDebugModalOpen(true) }} />
      </main>
      <DebugModal isOpen={debugModalOpen} onClose={() => setDebugModalOpen(false)} />
      <AccountModal isOpen={accountModalOpen} onClose={() => setAccountModalOpen(false)} />
    </div>
  )
}
