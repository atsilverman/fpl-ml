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
  'price-changes',
  'transfers',
  'settings'
]

const BentoOrderContext = createContext()

const VISIBILITY_STORAGE_KEY = 'bento_card_visibility'
const STATS_MIN_MINUTES_PERCENT_KEY = 'stats_min_minutes_percent'

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
          // Ensure price-changes appears above transfers
          const priceChangesIdx = merged.indexOf('price-changes')
          const transfersIdx = merged.indexOf('transfers')
          if (priceChangesIdx !== -1 && transfersIdx !== -1 && priceChangesIdx > transfersIdx) {
            merged = merged.filter((id) => id !== 'price-changes')
            merged.splice(transfersIdx, 0, 'price-changes')
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
  const [statsMinMinutesPercent, setStatsMinMinutesPercentState] = useState(() => {
    const saved = localStorage.getItem(STATS_MIN_MINUTES_PERCENT_KEY)
    if (saved != null) {
      const n = parseInt(saved, 10)
      if (!Number.isNaN(n) && n >= 0 && n <= 100) return n
    }
    return 20
  })

  useEffect(() => {
    localStorage.setItem('bento_card_order', JSON.stringify(cardOrder))
  }, [cardOrder])

  useEffect(() => {
    localStorage.setItem(VISIBILITY_STORAGE_KEY, JSON.stringify(cardVisibility))
  }, [cardVisibility])

  useEffect(() => {
    localStorage.setItem(STATS_MIN_MINUTES_PERCENT_KEY, String(statsMinMinutesPercent))
  }, [statsMinMinutesPercent])

  const setCardVisible = (id, visible) => {
    setCardVisibilityState((prev) => ({ ...prev, [id]: visible }))
  }

  const isCardVisible = (id) => id === 'settings' || cardVisibility[id] !== false

  const setStatsMinMinutesPercent = (value) => {
    const n = Math.min(100, Math.max(0, Number(value)))
    setStatsMinMinutesPercentState(Number.isNaN(n) ? 0 : n)
  }

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
        statsMinMinutesPercent,
        setStatsMinMinutesPercent,
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
