import { createContext, useContext, useState, useEffect } from 'react'
import CustomizeModal from '../components/CustomizeModal'

const DEFAULT_ORDER = [
  'gw-points',
  'overall-rank',
  'total-points',
  'league-rank',
  'captain',
  'team-value',
  'gw-rank',
  'chips',
  'transfers',
  'settings'
]

const BentoOrderContext = createContext()

const VISIBILITY_STORAGE_KEY = 'bento_card_visibility'

export function BentoOrderProvider({ children }) {
  const [cardOrder, setCardOrder] = useState(() => {
    const saved = localStorage.getItem('bento_card_order')
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length) {
          // Merge in any DEFAULT_ORDER ids that are missing (e.g. new cards like refresh-state)
          let merged = parsed.filter((id) => DEFAULT_ORDER.includes(id))
          DEFAULT_ORDER.forEach((id) => {
            if (!merged.includes(id)) merged.push(id)
          })
          // One-time migration: apply gw-rank / league-rank swap (gw-rank before league-rank)
          const gwRankIdx = merged.indexOf('gw-rank')
          const leagueRankIdx = merged.indexOf('league-rank')
          if (gwRankIdx !== -1 && leagueRankIdx !== -1 && leagueRankIdx < gwRankIdx) {
            merged = [...merged]
            merged[leagueRankIdx] = 'gw-rank'
            merged[gwRankIdx] = 'league-rank'
          }
          return merged
        }
      } catch (_) {}
    }
    return [...DEFAULT_ORDER]
  })
  const [cardVisibility, setCardVisibilityState] = useState(() => {
    const saved = localStorage.getItem(VISIBILITY_STORAGE_KEY)
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        if (parsed && typeof parsed === 'object') return parsed
      } catch (_) {}
    }
    return {}
  })
  const [customizeModalOpen, setCustomizeModalOpen] = useState(false)

  useEffect(() => {
    localStorage.setItem('bento_card_order', JSON.stringify(cardOrder))
  }, [cardOrder])

  useEffect(() => {
    localStorage.setItem(VISIBILITY_STORAGE_KEY, JSON.stringify(cardVisibility))
  }, [cardVisibility])

  const setCardVisible = (id, visible) => {
    setCardVisibilityState((prev) => ({ ...prev, [id]: visible }))
  }

  const isCardVisible = (id) => id === 'settings' || cardVisibility[id] !== false

  const openCustomizeModal = () => setCustomizeModalOpen(true)
  const closeCustomizeModal = () => setCustomizeModalOpen(false)

  return (
    <BentoOrderContext.Provider
      value={{
        cardOrder,
        setCardOrder,
        cardVisibility,
        setCardVisible,
        isCardVisible,
        openCustomizeModal,
        closeCustomizeModal,
        customizeModalOpen
      }}
    >
      {children}
      <CustomizeModal
        isOpen={customizeModalOpen}
        onClose={closeCustomizeModal}
      />
    </BentoOrderContext.Provider>
  )
}

export function useBentoOrder() {
  const context = useContext(BentoOrderContext)
  if (!context) {
    throw new Error('useBentoOrder must be used within BentoOrderProvider')
  }
  return context
}
