import { useId, type ReactNode } from 'react'
import { numbered } from '../numbered'

/** A block of the route card: a dot on the route down the card, its title, what is counted beside it, and its rows. */
export function Section({ title, count, lit = false, children }: { title: ReactNode; count?: string; lit?: boolean; children: ReactNode }) {
  const id = useId()
  return (
    <section className="route-section" data-lit={lit || undefined} aria-labelledby={id}>
      <h3 id={id} className="route-title">
        {title}
        {count !== undefined && <span className="route-count">{numbered(count)}</span>}
      </h3>
      {children}
    </section>
  )
}

/** One row: what it is, and its value at the right. */
export function Row({ name, value, tone }: { name: ReactNode; value: ReactNode; tone?: string }) {
  return (
    <p className="route-row">
      <span className="route-grow">{name}</span>
      <span className="route-value" data-tone={tone}>
        {value}
      </span>
    </p>
  )
}
