import { createContext, useContext, useState, useEffect } from 'react'

const ThemeContext = createContext()

const CYCLE_MODES = ['light', 'dark', 'system', 'ocean']

function getSystemThemePreference() {
  if (typeof window === 'undefined') return 'dark'
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light'
  }
  return 'dark'
}

function getActualDataTheme(mode) {
  if (mode === 'system') return getSystemThemePreference()
  if (mode === 'ocean') return 'light-ocean'
  return mode
}

export function ThemeProvider({ children }) {
  const [themeMode, setThemeMode] = useState(() => {
    const saved = localStorage.getItem('fpl-theme-mode')
    let mode = (saved && CYCLE_MODES.includes(saved)) ? saved : null
    if (!mode) {
      const legacy = localStorage.getItem('fpl-theme')
      if (legacy === 'dark' || legacy === 'light') mode = legacy
      else if (legacy === 'light-ocean') mode = 'ocean'
      else mode = 'system'
    }
    const resolved = getActualDataTheme(mode)
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', resolved)
    }
    return mode
  })

  const actualTheme = getActualDataTheme(themeMode)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', actualTheme)
    localStorage.setItem('fpl-theme-mode', themeMode)
    if (localStorage.getItem('fpl-theme')) {
      localStorage.removeItem('fpl-theme')
    }
  }, [themeMode, actualTheme])

  useEffect(() => {
    if (themeMode !== 'system' || !window.matchMedia) return
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => {
      document.documentElement.setAttribute('data-theme', getSystemThemePreference())
    }
    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [themeMode])

  const cycleTheme = () => {
    setThemeMode((prev) => {
      const i = CYCLE_MODES.indexOf(prev)
      return CYCLE_MODES[(i + 1) % CYCLE_MODES.length]
    })
  }

  return (
    <ThemeContext.Provider value={{ themeMode, actualTheme, cycleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider')
  }
  return context
}
