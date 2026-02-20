import { useState, useEffect } from 'react'
import { GripVertical, ChevronDown, ChevronUp } from 'lucide-react'
import { useBentoOrder } from '../contexts/BentoOrderContext'
import { useToast } from '../contexts/ToastContext'
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
  'captain': 'Captains',
  'price-changes': 'Price Changes',
  'settings': 'Settings'
}

export default function CustomizeModal({ isOpen, onClose }) {
  const { cardOrder, setCardOrder, isCardVisible, setCardVisible, statsMinMinutesPercent, setStatsMinMinutesPercent } = useBentoOrder()
  const { toast } = useToast()
  const [draggedId, setDraggedId] = useState(null)
  const [dragOverId, setDragOverId] = useState(null)
  const [layoutExpanded, setLayoutExpanded] = useState(false)
  const [minutesExpanded, setMinutesExpanded] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setLayoutExpanded(false)
      setMinutesExpanded(false)
    }
  }, [isOpen])

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
  }

  const handleToggleVisible = (id) => {
    setCardVisible(id, !isCardVisible(id))
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
          <h2>Customize</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="modal-body">
          <section className="customize-section customize-section-layout" aria-labelledby="customize-layout-heading">
            <button
              type="button"
              className="customize-section-toggle"
              onClick={() => setLayoutExpanded((e) => !e)}
              aria-expanded={layoutExpanded}
              aria-controls="customize-layout-content"
              id="customize-layout-heading"
            >
              <span className="customize-section-toggle-label">Layout</span>
              {layoutExpanded ? (
                <ChevronUp size={18} strokeWidth={2} aria-hidden />
              ) : (
                <ChevronDown size={18} strokeWidth={2} aria-hidden />
              )}
            </button>
            <div
              id="customize-layout-content"
              className="customize-section-content"
              hidden={!layoutExpanded}
            >
              <p className="customize-section-subtitle">
                Drag rows to reorder bentos on the home page. Use the switch to show or hide each card.
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
          </section>

          <section className="customize-section customize-section-minutes" aria-labelledby="customize-minutes-heading">
            <button
              type="button"
              className="customize-section-toggle"
              onClick={() => setMinutesExpanded((e) => !e)}
              aria-expanded={minutesExpanded}
              aria-controls="customize-minutes-content"
              id="customize-minutes-heading"
            >
              <span className="customize-section-toggle-label">Player stats</span>
              {minutesExpanded ? (
                <ChevronUp size={18} strokeWidth={2} aria-hidden />
              ) : (
                <ChevronDown size={18} strokeWidth={2} aria-hidden />
              )}
            </button>
            <div
              id="customize-minutes-content"
              className="customize-section-content"
              hidden={!minutesExpanded}
            >
              <p className="customize-section-subtitle">
                Hide players who played below this share of possible minutes on the Stats subpage.
              </p>
              <div className="customize-minutes-slider-wrap">
                <label htmlFor="customize-minutes-threshold" className="customize-minutes-label">
                  Min. minutes played: {statsMinMinutesPercent === 0 ? 'Show all' : `${statsMinMinutesPercent}%`}
                </label>
                <input
                  id="customize-minutes-threshold"
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={statsMinMinutesPercent}
                  onChange={(e) => setStatsMinMinutesPercent(Number(e.target.value))}
                  className="customize-minutes-range"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={statsMinMinutesPercent}
                  aria-valuetext={statsMinMinutesPercent === 0 ? 'Show all players' : `${statsMinMinutesPercent}% of possible minutes`}
                />
              </div>
            </div>
          </section>
        </div>

        <div className="modal-footer customize-modal-footer">
          <button type="button" className="modal-button modal-button-cancel" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
