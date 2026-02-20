import { RectangleVertical } from 'lucide-react'
import './CardStatLabel.css'

/**
 * Renders stat column label. For yellow_cards/red_cards shows a filled
 * RectangleVertical icon (yellow/red) plus "YC" or "RC"; otherwise returns the label as-is.
 */
export function CardStatLabel({ statKey, label }) {
  if (statKey === 'yellow_cards') {
    return (
      <span className="card-stat-label card-stat-label--yc" title="Yellow cards">
        <RectangleVertical className="card-stat-label-icon" width={8} height={12} strokeWidth={0} fill="currentColor" aria-hidden />
        <span>YC</span>
      </span>
    )
  }
  if (statKey === 'red_cards') {
    return (
      <span className="card-stat-label card-stat-label--rc" title="Red cards">
        <RectangleVertical className="card-stat-label-icon" width={8} height={12} strokeWidth={0} fill="currentColor" aria-hidden />
        <span>RC</span>
      </span>
    )
  }
  return label
}
