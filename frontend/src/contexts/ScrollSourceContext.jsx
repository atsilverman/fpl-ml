import { createContext, useContext, useState } from 'react'

/**
 * Lets child pages (e.g. League) register their main scroll container so the Dashboard
 * can drive the mobile nav hide/show from that element's scroll instead of the window.
 * When scrollSource is set, Dashboard listens to it; otherwise it uses window.
 */
const ScrollSourceContext = createContext(null)

export function ScrollSourceProvider({ children }) {
  const [scrollSource, setScrollSource] = useState(null)
  return (
    <ScrollSourceContext.Provider value={{ scrollSource, setScrollSource }}>
      {children}
    </ScrollSourceContext.Provider>
  )
}

export function useScrollSource() {
  const ctx = useContext(ScrollSourceContext)
  return ctx?.setScrollSource ?? null
}

export function useScrollSourceState() {
  const ctx = useContext(ScrollSourceContext)
  return ctx?.scrollSource ?? null
}
