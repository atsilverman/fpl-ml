import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { ThemeProvider } from './contexts/ThemeContext'
import { AuthProvider } from './contexts/AuthContext'
import { ConfigurationProvider } from './contexts/ConfigurationContext'
import { BentoOrderProvider } from './contexts/BentoOrderContext'
import { ToastProvider } from './contexts/ToastContext'
import ScrollToTop from './components/ScrollToTop'
import Dashboard from './components/Dashboard'
import HomePage from './components/HomePage'
import MiniLeaguePage from './components/MiniLeaguePage'
import GameweekPage from './components/GameweekPage'
import ResearchPage from './components/ResearchPage'
import LivePage from './components/LivePage'
import AuthCallback from './components/AuthCallback'
import OnboardingPage from './components/OnboardingPage'
import { trackPageView } from './analytics'

function AnalyticsTracker() {
  const location = useLocation()
  useEffect(() => {
    trackPageView(location.pathname + location.search)
  }, [location.pathname, location.search])
  return null
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ConfigurationProvider>
          <ToastProvider>
            <BentoOrderProvider>
              <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <ScrollToTop />
                <AnalyticsTracker />
                <Routes>
                  <Route path="/auth/callback" element={<AuthCallback />} />
                  <Route path="/welcome" element={<OnboardingPage />} />
                  <Route path="/" element={<Dashboard />}>
                    <Route index element={<HomePage />} />
                    <Route path="mini-league" element={<MiniLeaguePage />} />
                    <Route path="gameweek" element={<GameweekPage />} />
                    <Route path="research" element={<ResearchPage />} />
                    <Route path="live" element={<LivePage />} />
                  </Route>
                </Routes>
              </Router>
            </BentoOrderProvider>
          </ToastProvider>
        </ConfigurationProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}

export default App
