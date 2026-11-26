import type { ReactNode } from 'react'

/**
 * The dyed plate: solder mask, as on a bare board, with its children on it. It is for the screens that show no board
 * (the first screen, an empty view) and for nothing else. It fills the box it is in; the screen that holds it sets the
 * box's width (the first screen's is 780 of 1440). What is drawn on it comes from the design mocks.
 */
export function Plate({ children }: { children: ReactNode }) {
  return (
    <section className="plate" data-plate>
      {children}
    </section>
  )
}
