import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * Scrolls the window to the top when the route (pathname or search) changes.
 * Renders nothing; must be used inside a Router.
 */
export default function ScrollToTop() {
  const { pathname, search } = useLocation()

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname, search])

  return null
}
