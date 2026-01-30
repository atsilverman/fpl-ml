import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useConfiguration } from '../contexts/ConfigurationContext'
import { supabase } from '../lib/supabase'
import './Dashboard.css'

export default function Dashboard() {
  const navigate = useNavigate()
  const location = useLocation()
  const { config } = useConfiguration()
  const managerId = config?.managerId ?? null
  const leagueId = config?.leagueId ?? null

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
    { id: 'live', path: '/live', label: 'Gameweek' },
    { id: 'research', path: '/research', label: 'Research' }
  ]

  const currentPage = pages.find(p => location.pathname === p.path) || pages[0]

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div className="header-content">
          <div className="header-title-section">
            <h1>FPL Mini League</h1>
            {subtitle && <p className="header-subtitle">{subtitle}</p>}
          </div>
        </div>
      </header>

      <main className="dashboard-content">
        <Outlet />
      </main>

      <nav className="page-selector-bottom tracking-mode-toggle">
        {pages.map(page => {
          const isDisabled = !['home', 'mini-league'].includes(page.id)
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
    </div>
  )
}
