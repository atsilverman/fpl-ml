import { createContext, useContext, useState, useEffect } from 'react'
import CustomizeModal from '../components/CustomizeModal'

const DEFAULT_ORDER = [
  'overall-rank',
  'gw-points',
  'total-points',
  'gw-rank',
  'team-value',
  'chips',
  'transfers',
  'league-rank',
  'captain',
  'settings'
]

const BentoOrderContext = createContext()

export function BentoOrderProvider({ children }) {
  const [cardOrder, setCardOrder] = useState(() => {
    const saved = localStorage.getItem('bento_card_order')
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length) return parsed
      } catch (_) {}
    }
    return [...DEFAULT_ORDER]
  })
  const [customizeModalOpen, setCustomizeModalOpen] = useState(false)

  useEffect(() => {
    localStorage.setItem('bento_card_order', JSON.stringify(cardOrder))
  }, [cardOrder])

  const openCustomizeModal = () => setCustomizeModalOpen(true)
  const closeCustomizeModal = () => setCustomizeModalOpen(false)

  return (
    <BentoOrderContext.Provider
      value={{
        cardOrder,
        setCardOrder,
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
