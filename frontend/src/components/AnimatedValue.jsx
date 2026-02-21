/**
 * Wraps content for numeric or text values that update in place (e.g. points, minutes, DEFCON).
 * Renders with no animation on value change.
 */
export default function AnimatedValue({ value, className = '', as: Component = 'span', children, ...rest }) {
  return (
    <Component className={className} {...rest}>
      {children}
    </Component>
  )
}
