import { useLayoutEffect, useRef, type ReactNode } from 'react'
import type { Box, Pt } from '../../../shared/leader'
import { placeTag, tagSubject, type Side } from '../../../shared/tagPlace'
import { publishTag, withdrawTag } from './useTagAt'

/** Room kept round what a tag stands clear of, in px. */
const AVOID_PAD = 4

/** A tag's neighbours it must not cover: what the view marks `data-tag-avoid` (the tabs, the stack, the band), and the tags before it. */
function avoidBoxes(self: HTMLElement, within: HTMLElement, origin: { left: number; top: number }): Box[] {
  const boxes: Box[] = []
  for (const other of within.querySelectorAll<HTMLElement>('[data-tag-avoid], [data-tag]')) {
    if (other === self || other.hidden) continue
    // Tags place themselves in the order they were mounted: each clears the ones before it, so that two never chase each other.
    if (other.hasAttribute('data-tag') && !(self.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_PRECEDING)) continue
    const r = other.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    boxes.push({ x: r.left - origin.left - AVOID_PAD, y: r.top - origin.top - AVOID_PAD, w: r.width + 2 * AVOID_PAD, h: r.height + 2 * AVOID_PAD })
  }
  return boxes
}

export interface TagProps {
  /** Names the tag, for its leader and the tests. */
  id: string
  /** What it is about, in the pixels of the view it stands in; null where there is none: the tag docks then. */
  subject: Pt | null
  /** The side it starts on, before it has one of its own. */
  prefer?: Exclude<Side, 'docked'>
  children: ReactNode
}

/**
 * A reading that stands beside what it is about, tied by a leader (torno's rule). It is placed by `placeTag` whenever
 * the view says its subject has moved, straight on the element: clear of the view's furniture and of the tags before
 * it. It keeps its side while that still fits. With no subject, or one off the view, it docks above the hint and has no
 * leader. Its leader is set through `publishTag`.
 */
export function Tag({ id, subject, prefer, children }: TagProps) {
  const element = useRef<HTMLDivElement>(null)
  const side = useRef<Exclude<Side, 'docked'> | undefined>(prefer)
  const subjectRef = useRef(subject)
  subjectRef.current = subject
  const place = useRef<() => void>(() => {})

  useLayoutEffect(() => {
    const self = element.current!
    place.current = () => {
      const within = self.offsetParent instanceof HTMLElement ? self.offsetParent : null
      if (!within) return
      const pane = within.getBoundingClientRect()
      const view: Box = { x: 0, y: 0, w: pane.width, h: pane.height }
      const at = tagSubject(subjectRef.current, view)
      const size = { w: self.offsetWidth, h: self.offsetHeight }
      const avoid = avoidBoxes(self, within, pane)
      const placed = placeTag(at, size, view, avoid, side.current)
      if (placed.side !== 'docked') side.current = placed.side
      self.style.transform = `translate(${Math.round(placed.box.x)}px, ${Math.round(placed.box.y)}px)`
      self.dataset.side = placed.side
      self.style.visibility = ''
      publishTag(id, { box: placed.box, side: placed.side, subject: placed.side === 'docked' ? null : at }, { x: pane.left, y: pane.top })
    }
    place.current()
    // The tag grows with what is in it, and the window moves the view.
    const sized = new ResizeObserver(() => place.current())
    sized.observe(self)
    const moved = () => place.current()
    window.addEventListener('resize', moved)
    return () => {
      sized.disconnect()
      window.removeEventListener('resize', moved)
      withdrawTag(id)
    }
  }, [id])

  useLayoutEffect(() => place.current(), [subject?.x, subject?.y])

  return (
    <div ref={element} className="tag" data-tag={id} style={{ visibility: 'hidden' }}>
      {children}
    </div>
  )
}
