import { useRef, useEffect, useState } from 'react'
import './AnimatedValue.css'

const ANIMATION_DURATION_MS = 400

/**
 * Wraps content and adds a subtle "value-just-changed" animation when the value prop changes.
 * Use for numeric or text values that update in place (e.g. points, minutes, DEFCON) so users
 * see a brief highlight when data refreshes.
 */
export default function AnimatedValue({ value, className = '', as: Component = 'span', children, ...rest }) {
  const prevValueRef = useRef(value)
  const isFirstRenderRef = useRef(true)
  const [justChanged, setJustChanged] = useState(false)

  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false
      prevValueRef.current = value
      return
    }
    if (value !== prevValueRef.current) {
      prevValueRef.current = value
      setJustChanged(true)
      const t = setTimeout(() => setJustChanged(false), ANIMATION_DURATION_MS)
      return () => clearTimeout(t)
    }
  }, [value])

  const combinedClass = [className, justChanged ? 'value-just-changed' : ''].filter(Boolean).join(' ')
  return (
    <Component className={combinedClass} {...rest}>
      {children}
    </Component>
  )
}
