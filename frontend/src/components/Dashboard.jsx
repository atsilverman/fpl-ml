import { useState, useRef, useEffect } from 'react'
import { Outlet, useNavigate, useLocation, useSearchParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Pencil, ChevronDown, House, Users, FlaskConical, Construction, CalendarDays, ListOrdered, ArrowRightLeft, Sparkles, Swords, UserStar, ShieldCheck, Radio, CirclePoundSterling } from 'lucide-react'
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
  { id: 'feed', label: 'Feed', disabled: false },
]

const RESEARCH_VIEWS = [
  { id: 'stats', label: 'Stats', disabled: false },
  { id: 'schedule', label: 'Schedule', disabled: false },
  { id: 'price-changes', label: 'Prices', disabled: false },
]

const LEAGUE_VIEWS = [
  { id: 'table', label: 'Standings', disabled: false },
  { id: 'captain', label: 'Captains', disabled: false },
  { id: 'transfers', label: 'Transfers', disabled: false },
  { id: 'chips', label: 'Chips', disabled: false },
]

/* Soccer ball icon (no Lucide equivalent); matches lucide size/stroke usage */
function SoccerBallIcon({ size = 20, strokeWidth = 2, className, ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
      {...props}
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      <path d="M2 12h20" />
    </svg>
  )
}

const NAV_ICONS = {
  home: House,
  'mini-league': Users,
  gameweek: SoccerBallIcon,
  research: FlaskConical,
}

export default function Dashboard() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const { config, openConfigModal, loading: configLoading } = useConfiguration()
  const { user, loading: authLoading } = useAuth()
  const isSignedIn = !!user
  const managerId = config?.managerId ?? null
  const leagueId = config?.leagueId ?? null
  const [gameweekDropdownOpen, setGameweekDropdownOpen] = useState(false)
  const gameweekDropdownRef = useRef(null)
  const gameweekCloseTimeoutRef = useRef(null)
  const [researchDropdownOpen, setResearchDropdownOpen] = useState(false)
  const researchDropdownRef = useRef(null)
  const researchCloseTimeoutRef = useRef(null)
  const [leagueDropdownOpen, setLeagueDropdownOpen] = useState(false)
  const leagueDropdownRef = useRef(null)
  const leagueCloseTimeoutRef = useRef(null)

  const hasHover = () => typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches
  const HOVER_LEAVE_MS = 180

  const gameweekView = searchParams.get('view') || 'matches'
  const isOnGameweek = location.pathname === '/gameweek'
  const leagueView = (() => {
    const v = searchParams.get('view')
    return v === 'captain' || v === 'transfers' ? v : 'table'
  })()
  const isOnMiniLeague = location.pathname === '/mini-league'
  const [toggleBonus, setToggleBonus] = useState(false)
  const [showH2H, setShowH2H] = useState(false)
  const [debugModalOpen, setDebugModalOpen] = useState(false)
  const [accountModalOpen, setAccountModalOpen] = useState(false)

  const dashboardRef = useRef(null)
  const headerRef = useRef(null)
  const navRef = useRef(null)
  const contentRef = useRef(null)

  /* Detect standalone (Add to Home Screen) so we can add extra safe-area padding for the bottom nav */
  const [isStandalone, setIsStandalone] = useState(false)
  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      !!window.navigator.standalone
    setIsStandalone(standalone)
  }, [])

  /* Mobile: no subpage dropdown in nav – use in-page toolbar only. Desktop: expanding list (dropdown). */
  const NAV_MOBILE_BREAKPOINT = 768
  const [isMobileNav, setIsMobileNav] = useState(() => typeof window !== 'undefined' && window.innerWidth <= NAV_MOBILE_BREAKPOINT)
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${NAV_MOBILE_BREAKPOINT}px)`)
    const handler = () => setIsMobileNav(mql.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])

  /* Set CSS variables from measured header and bottom nav height for dynamic top/bottom padding */
  useEffect(() => {
    const el = dashboardRef.current
    const header = headerRef.current
    const nav = navRef.current
    if (!el || !header) return

    const setVars = () => {
      el.style.setProperty('--dashboard-header-height', `${header.offsetHeight}px`)
      if (nav) {
        el.style.setProperty('--dashboard-nav-height', `${nav.offsetHeight}px`)
      }
    }

    setVars()
    const ro = new ResizeObserver(setVars)
    ro.observe(header)
    if (nav) ro.observe(nav)
    window.addEventListener('resize', setVars)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', setVars)
    }
  }, [])

  /* Scroll main content to top when route or subpage (search) changes */
  useEffect(() => {
    contentRef.current?.scrollTo(0, 0)
  }, [location.pathname, location.search])

  useEffect(() => {
    // Wait for auth to resolve before redirecting (prevents flash of login screen when already signed in)
    if (authLoading) return
    // Only send to configure-manager (welcome) when not signed in and no config; signed-in users go straight to dashboard
    if (!configLoading && config == null && !isSignedIn) {
      navigate('/welcome', { replace: true })
    }
  }, [authLoading, configLoading, config, isSignedIn, navigate])

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

  useEffect(() => {
    if (!leagueDropdownOpen) return
    const handleClickOutside = (e) => {
      if (leagueDropdownRef.current && !leagueDropdownRef.current.contains(e.target)) {
        setLeagueDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [leagueDropdownOpen])

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
  const pageSliderOffset = Math.max(0, pages.findIndex(p => p.id === currentPage.id))

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

  const setLeagueView = (view) => {
    if (isOnMiniLeague) {
      setSearchParams({ view }, { replace: true })
    } else {
      navigate(`/mini-league?view=${view}`)
    }
    setLeagueDropdownOpen(false)
  }

  return (
    <div ref={dashboardRef} className={`dashboard ${isStandalone ? 'standalone-mode' : ''}`}>
      <header ref={headerRef} className="dashboard-header">
        <div className="header-content">
          <div className="header-title-section">
            <Link to="/" className="header-title-link" aria-label="Go to home">
              <h1>FPL Mini League</h1>
            </Link>
            <div className="header-subtitle-row">
              {subtitle && <p className="header-subtitle">{subtitle}</p>}
              {!config && !configLoading && (
                <span className="header-configure-note">Configure league</span>
              )}
              <button type="button" className="header-config-icon" aria-label="Configure league and manager" title="Configure league and manager" onClick={openConfigModal}>
                <Pencil size={12} strokeWidth={1.5} />
              </button>
            </div>
          </div>
          <nav
            ref={navRef}
            className="header-nav page-selector-bottom tracking-mode-toggle"
            aria-label="Page navigation"
            style={{ '--slider-offset': pageSliderOffset }}
          >
            <span className="tracking-mode-slider" aria-hidden />
        {pages.map(page => {
          const isDisabled = !['home', 'mini-league', 'gameweek', 'research'].includes(page.id)
          if (page.id === 'mini-league') {
            const LeagueNavIcon = NAV_ICONS['mini-league']
            if (isMobileNav) {
              return (
                <button
                  key={page.id}
                  type="button"
                  className={`tracking-mode-button ${currentPage.id === 'mini-league' ? 'active' : ''}`}
                  onClick={() => navigate('/mini-league')}
                  disabled={isDisabled}
                  aria-label="League"
                >
                  <span className="nav-button-icon" aria-hidden>
                    <LeagueNavIcon size={20} strokeWidth={2} />
                  </span>
                  <span className="nav-button-label">League</span>
                </button>
              )
            }
            return (
              <div
                key={page.id}
                className="nav-item-gameweek-wrap"
                ref={leagueDropdownRef}
                onMouseEnter={() => {
                  if (leagueCloseTimeoutRef.current) {
                    clearTimeout(leagueCloseTimeoutRef.current)
                    leagueCloseTimeoutRef.current = null
                  }
                  if (hasHover()) setLeagueDropdownOpen(true)
                }}
                onMouseLeave={() => {
                  if (!hasHover()) return
                  leagueCloseTimeoutRef.current = setTimeout(() => {
                    setLeagueDropdownOpen(false)
                    leagueCloseTimeoutRef.current = null
                  }, HOVER_LEAVE_MS)
                }}
              >
                <button
                  type="button"
                  className={`tracking-mode-button nav-item-gameweek-trigger ${currentPage.id === 'mini-league' ? 'active' : ''}`}
                  onClick={() => setLeagueDropdownOpen((open) => !open)}
                  disabled={isDisabled}
                  aria-expanded={leagueDropdownOpen}
                  aria-haspopup="listbox"
                  aria-label="League view"
                >
                  <span className="nav-button-icon" aria-hidden>
                    <LeagueNavIcon size={20} strokeWidth={2} />
                  </span>
                  <span className="nav-button-label">League</span>
                  <ChevronDown
                    size={12}
                    strokeWidth={2}
                    className={`nav-item-gameweek-chevron ${leagueDropdownOpen ? 'nav-item-gameweek-chevron--open' : ''}`}
                    aria-hidden
                  />
                </button>
                {leagueDropdownOpen && (
                  <div
                    className="nav-item-gameweek-panel nav-item-gameweek-panel--open"
                    role="listbox"
                    aria-label="League view"
                  >
                    {LEAGUE_VIEWS.map((view) => {
                      const LeagueOptionIcon = { table: ListOrdered, captain: null, transfers: ArrowRightLeft, chips: Sparkles }[view.id]
                      return (
                        <button
                          key={view.id}
                          type="button"
                          role="option"
                          aria-selected={currentPage.id === 'mini-league' && leagueView === view.id}
                          className={`nav-item-gameweek-option nav-item-gameweek-option--with-icon ${currentPage.id === 'mini-league' && leagueView === view.id ? 'nav-item-gameweek-option--active' : ''} ${view.disabled ? 'nav-item-gameweek-option--disabled' : ''}`}
                          onClick={() => {
                            if (view.disabled) return
                            setLeagueView(view.id)
                          }}
                          disabled={view.disabled}
                        >
                          {view.id === 'captain' ? (
                            <span className="captain-badge-icon nav-item-gameweek-option-icon" style={{ '--captain-badge-size': '14px' }} aria-hidden>C</span>
                          ) : (
                            LeagueOptionIcon && <LeagueOptionIcon size={14} strokeWidth={2} className="nav-item-gameweek-option-icon" aria-hidden />
                          )}
                          {view.label}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          }
          if (page.id === 'gameweek') {
            const GameweekNavIcon = NAV_ICONS.gameweek
            if (isMobileNav) {
              return (
                <button
                  key={page.id}
                  type="button"
                  className={`tracking-mode-button ${currentPage.id === 'gameweek' ? 'active' : ''}`}
                  onClick={() => navigate('/gameweek')}
                  disabled={isDisabled}
                  aria-label="Gameweek"
                >
                  <span className="nav-button-icon" aria-hidden>
                    <GameweekNavIcon size={20} strokeWidth={2} />
                  </span>
                  <span className="nav-button-label">Gameweek</span>
                </button>
              )
            }
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
                  <span className="nav-button-icon" aria-hidden>
                    <GameweekNavIcon size={20} strokeWidth={2} />
                  </span>
                  <span className="nav-button-label">Gameweek</span>
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
                    {GAMEWEEK_VIEWS.map(view => {
                      const GameweekOptionIcon = { matches: Swords, bonus: UserStar, defcon: ShieldCheck, feed: Radio }[view.id]
                      return (
                        <button
                          key={view.id}
                          type="button"
                          role="option"
                          aria-selected={currentPage.id === 'gameweek' && gameweekView === view.id}
                          className={`nav-item-gameweek-option nav-item-gameweek-option--with-icon ${currentPage.id === 'gameweek' && gameweekView === view.id ? 'nav-item-gameweek-option--active' : ''} ${view.disabled ? 'nav-item-gameweek-option--disabled' : ''}`}
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
                          {GameweekOptionIcon && <GameweekOptionIcon size={14} strokeWidth={2} className="nav-item-gameweek-option-icon" aria-hidden />}
                          {view.label}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          }
          if (page.id === 'research') {
            const ResearchNavIcon = NAV_ICONS.research
            if (isMobileNav) {
              return (
                <button
                  key={page.id}
                  type="button"
                  className={`tracking-mode-button ${currentPage.id === 'research' ? 'active' : ''}`}
                  onClick={() => navigate('/research')}
                  disabled={isDisabled}
                  aria-label="Research"
                >
                  <span className="nav-button-icon" aria-hidden>
                    <ResearchNavIcon size={20} strokeWidth={2} />
                  </span>
                  <span className="nav-button-label">Research</span>
                </button>
              )
            }
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
                  <span className="nav-button-icon" aria-hidden>
                    <ResearchNavIcon size={20} strokeWidth={2} />
                  </span>
                  <span className="nav-button-label">Research</span>
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
                    {RESEARCH_VIEWS.map((view) => {
                      const isDisabled = view.disabled || (view.disabledOnLocalhost && typeof window !== 'undefined' && window.location.hostname === 'localhost')
                      const ResearchOptionIcon = view.id === 'price-changes' ? CirclePoundSterling : view.id === 'schedule' ? CalendarDays : view.id === 'stats' ? ListOrdered : view.comingSoon ? Construction : null
                      return (
                        <button
                          key={view.id}
                          type="button"
                          role="option"
                          aria-selected={currentPage.id === 'research' && researchView === view.id}
                          aria-label={view.comingSoon ? `${view.label} (coming soon)` : view.label}
                          title={view.comingSoon ? 'Coming soon' : undefined}
                          className={`nav-item-gameweek-option nav-item-gameweek-option--with-icon ${currentPage.id === 'research' && researchView === view.id ? 'nav-item-gameweek-option--active' : ''} ${isDisabled ? 'nav-item-gameweek-option--disabled' : ''} ${view.comingSoon ? 'nav-item-gameweek-option--coming-soon' : ''}`}
                          onClick={() => {
                            if (isDisabled) return
                            setResearchView(view.id)
                          }}
                          disabled={isDisabled}
                        >
                          {ResearchOptionIcon && (
                            <ResearchOptionIcon size={14} strokeWidth={2} className="nav-item-gameweek-option-icon" aria-hidden />
                          )}
                          {view.label}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          }
          const Icon = NAV_ICONS[page.id]
          return (
            <button
              key={page.id}
              className={`tracking-mode-button ${currentPage.id === page.id ? 'active' : ''}`}
              onClick={() => !isDisabled && navigate(page.path)}
              disabled={isDisabled}
              aria-label={page.label}
            >
              <span className="nav-button-icon" aria-hidden>
                {Icon && <Icon size={20} strokeWidth={2} />}
              </span>
              <span className="nav-button-label">{page.label}</span>
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

      <main ref={contentRef} className="dashboard-content">
        <Outlet context={{ toggleBonus, setToggleBonus, showH2H, setShowH2H, setGameweekView, openDebugModal: () => setDebugModalOpen(true) }} />
      </main>
      <DebugModal isOpen={debugModalOpen} onClose={() => setDebugModalOpen(false)} />
      <AccountModal isOpen={accountModalOpen} onClose={() => setAccountModalOpen(false)} />
    </div>
  )
}
