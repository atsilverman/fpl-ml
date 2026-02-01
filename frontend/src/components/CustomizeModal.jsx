import { useState, useEffect } from 'react'
import { GripVertical } from 'lucide-react'
import { useBentoOrder } from '../contexts/BentoOrderContext'
import './ConfigurationModal.css'
import './CustomizeModal.css'

const BENTO_LABELS = {
  'overall-rank': 'Overall Rank',
  'gw-points': 'GW Points',
  'total-points': 'Total Points',
  'gw-rank': 'GW Rank',
  'team-value': 'Team Value',
  'chips': 'Chips',
  'transfers': 'Transfers',
  'league-rank': 'League Rank',
  'captain': 'Captaincy',
  'refresh-state': 'State (debug)',
  'settings': 'Settings'
}

export default function CustomizeModal({ isOpen, onClose }) {
  const { cardOrder, setCardOrder, isCardVisible, setCardVisible } = useBentoOrder()
  const [draggedId, setDraggedId] = useState(null)
  const [dragOverId, setDragOverId] = useState(null)
  const [hasChanges, setHasChanges] = useState(false)
  const [savedJustNow, setSavedJustNow] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setHasChanges(false)
      setSavedJustNow(false)
    }
  }, [isOpen])

  const handleSave = () => {
    if (!hasChanges) return
    setHasChanges(false)
    setSavedJustNow(true)
  }

  useEffect(() => {
    if (!savedJustNow) return
    const t = setTimeout(() => setSavedJustNow(false), 1500)
    return () => clearTimeout(t)
  }, [savedJustNow])

  const handleDragStart = (e, id) => {
    setDraggedId(id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
    e.dataTransfer.setData('application/json', JSON.stringify({ id }))
    // Slight delay so the drag image is the row
    requestAnimationFrame(() => {
      if (e.target) e.target.classList.add('customize-row-dragging')
    })
  }

  const handleDragEnd = (e) => {
    setDraggedId(null)
    setDragOverId(null)
    e.target?.classList?.remove('customize-row-dragging')
  }

  const handleDragOver = (e, id) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (draggedId && draggedId !== id) setDragOverId(id)
  }

  const handleDragLeave = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setDragOverId(null)
    }
  }

  const handleDrop = (e, dropId) => {
    e.preventDefault()
    setDragOverId(null)
    const dragId = draggedId || e.dataTransfer.getData('text/plain')
    if (!dragId || dragId === dropId) return

    const fromIndex = cardOrder.indexOf(dragId)
    const toIndex = cardOrder.indexOf(dropId)
    if (fromIndex === -1 || toIndex === -1) return

    const next = [...cardOrder]
    next.splice(fromIndex, 1)
    next.splice(toIndex, 0, dragId)
    setCardOrder(next)
    setDraggedId(null)
    setHasChanges(true)
  }

  const handleToggleVisible = (id) => {
    setCardVisible(id, !isCardVisible(id))
    setHasChanges(true)
  }

  if (!isOpen) return null

  const orderedRows = cardOrder
    .filter((id) => BENTO_LABELS[id] != null && id !== 'settings')
    .map((id) => ({ id, label: BENTO_LABELS[id] }))

  return (
    <div className="modal-overlay customize-modal-overlay" onClick={onClose}>
      <div
        className="modal-content customize-modal-content"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Customize layout</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="modal-body">
          <p className="customize-modal-description">
            Drag rows to change the order of bentos on the home page.
          </p>
          <div
            className="customize-rows"
            onDragLeave={handleDragLeave}
          >
            {orderedRows.map(({ id, label }) => (
              <div
                key={id}
                className={`customize-row ${draggedId === id ? 'customize-row-dragging' : ''} ${dragOverId === id ? 'customize-row-drag-over' : ''}`}
                draggable
                onDragStart={(e) => handleDragStart(e, id)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => handleDragOver(e, id)}
                onDrop={(e) => handleDrop(e, id)}
              >
                <span className="customize-row-handle" aria-hidden>
                  <GripVertical size={18} strokeWidth={1.5} />
                </span>
                <span className="customize-row-label">{label}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isCardVisible(id)}
                  className={`customize-row-slider ${isCardVisible(id) ? 'customize-row-slider-on' : 'customize-row-slider-off'}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    e.preventDefault()
                    handleToggleVisible(id)
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  aria-label={isCardVisible(id) ? 'Hide on home' : 'Show on home'}
                  title={isCardVisible(id) ? 'On – visible on home' : 'Off – hidden on home'}
                >
                  <span className="customize-row-slider-track">
                    <span className="customize-row-slider-thumb" />
                  </span>
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="modal-footer customize-modal-footer">
          <button
            type="button"
            className="modal-button modal-button-save"
            onClick={handleSave}
            disabled={!hasChanges && !savedJustNow}
            aria-live="polite"
          >
            {savedJustNow ? 'Saved' : 'Save'}
          </button>
          <button type="button" className="modal-button modal-button-cancel" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
