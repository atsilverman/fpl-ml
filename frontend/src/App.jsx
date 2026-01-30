import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { ThemeProvider } from './contexts/ThemeContext'
import { AuthProvider } from './contexts/AuthContext'
import { ConfigurationProvider } from './contexts/ConfigurationContext'
import { BentoOrderProvider } from './contexts/BentoOrderContext'
import { ToastProvider } from './contexts/ToastContext'
import Dashboard from './components/Dashboard'
import HomePage from './components/HomePage'
import MiniLeaguePage from './components/MiniLeaguePage'
import ResearchPage from './components/ResearchPage'
import LivePage from './components/LivePage'
import AuthCallback from './components/AuthCallback'

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ConfigurationProvider>
          <BentoOrderProvider>
          <ToastProvider>
          <Router>
            <Routes>
              <Route path="/auth/callback" element={<AuthCallback />} />
              <Route path="/" element={<Dashboard />}>
                <Route index element={<HomePage />} />
                <Route path="mini-league" element={<MiniLeaguePage />} />
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
