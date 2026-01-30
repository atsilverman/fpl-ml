import { createContext, useContext, useState, useEffect } from 'react'

const ThemeContext = createContext()

// Helper function to detect system-level dark/light mode preference
function getSystemThemePreference() {
  if (typeof window === 'undefined') return 'dark'
  
  // Check if prefers-color-scheme is supported
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  
  // Default to light if system prefers light, or dark as fallback
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light'
  }
  
  // Fallback to dark if media query is not supported
  return 'dark'
}

export function ThemeProvider({ children }) {
  const [themeMode, setThemeMode] = useState(() => {
    // Get from localStorage first (user's manual preference takes priority)
    const saved = localStorage.getItem('fpl-theme-mode')
    if (saved && ['light', 'dark', 'system'].includes(saved)) {
      return saved
    }
    
    // Default to system if no preference saved
    return 'system'
  })

  // Get the actual theme to apply (resolves 'system' to actual theme)
  const getActualTheme = (mode) => {
    if (mode === 'system') {
      return getSystemThemePreference()
    }
    return mode
  }

  const [actualTheme, setActualTheme] = useState(() => {
    const saved = localStorage.getItem('fpl-theme-mode')
    const mode = (saved && ['light', 'dark', 'system'].includes(saved)) ? saved : 'system'
    const theme = getActualTheme(mode)
    // Apply immediately to avoid flash
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme)
    }
    return theme
  })

  // Update actual theme when mode changes
  useEffect(() => {
    const theme = getActualTheme(themeMode)
    setActualTheme(theme)
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('fpl-theme-mode', themeMode)
  }, [themeMode])

  // Listen for system theme changes when in system mode
  useEffect(() => {
    if (themeMode !== 'system' || !window.matchMedia) return
    
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    
    const handleSystemThemeChange = (e) => {
      // Only update if we're in system mode
      if (themeMode === 'system') {
        const newTheme = e.matches ? 'dark' : 'light'
        setActualTheme(newTheme)
        document.documentElement.setAttribute('data-theme', newTheme)
      }
    }
    
    // Modern browsers
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleSystemThemeChange)
      return () => mediaQuery.removeEventListener('change', handleSystemThemeChange)
    }
    // Legacy browsers
    else if (mediaQuery.addListener) {
      mediaQuery.addListener(handleSystemThemeChange)
      return () => mediaQuery.removeListener(handleSystemThemeChange)
    }
  }, [themeMode])

  const cycleTheme = () => {
    setThemeMode(prev => {
      if (prev === 'light') return 'dark'
      if (prev === 'dark') return 'system'
      return 'light'
    })
  }

  return (
    <ThemeContext.Provider value={{ theme: actualTheme, themeMode, cycleTheme }}>
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
