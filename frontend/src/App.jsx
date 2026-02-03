import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { ThemeProvider } from './contexts/ThemeContext'
import { AuthProvider } from './contexts/AuthContext'
import { ConfigurationProvider } from './contexts/ConfigurationContext'
import { BentoOrderProvider } from './contexts/BentoOrderContext'
import { ToastProvider } from './contexts/ToastContext'
import Dashboard from './components/Dashboard'
import HomePage from './components/HomePage'
import MiniLeaguePage from './components/MiniLeaguePage'
import GameweekPage from './components/GameweekPage'
import ResearchPage from './components/ResearchPage'
import LivePage from './components/LivePage'
import AuthCallback from './components/AuthCallback'
import OnboardingPage from './components/OnboardingPage'

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ConfigurationProvider>
          <BentoOrderProvider>
          <ToastProvider>
          <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
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
          </ToastProvider>
          </BentoOrderProvider>
        </ConfigurationProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}

export default App
