import type { Card, CardsFile, FabAsk, PartReading } from '../../shared/cards'
import { LCSC } from '../../shared/cards'
import type { SizeFact } from '../../shared/size'
import { type ConnectionRow, connectionText, type PartHad, type PowerRow, powerText } from '../../shared/slots'

// The cards a new project starts with: what the person gave in each slot, in a frame for the slot. Pure; `create.ts`
// writes them into the hidden folder before the folder takes its name. All of them are the person's; the description
// and the pictures are no cards, they are `brief.md` and `reference/`.

/** The slots as `create` has checked them, each part with the reading main gave, if it has one. */
export interface StartRequest {
  power: PowerRow[]
  connections: ConnectionRow[]
  sizes: SizeFact[]
  enclosure: string
  edges: string
  parts: Array<PartHad & { reading?: PartReading }>
  fab: FabAsk | null
  rules: string
  links: Array<{ url: string; note: string }>
}

export const START_FRAMES = ['Power', 'Connections', 'Size and shape', 'Parts I have', 'Fab and assembly', 'Rules', 'Links']

type Body = Omit<Card, 'id' | 'by' | 'frame'>

/** A part by its number carries it, with the person's note as its words; a module is its words. */
function partCard({ what, note, reading }: StartRequest['parts'][number]): Body {
  if (!LCSC.test(what)) return { kind: 'part', text: note === '' ? what : `${what}: ${note}` }
  return { kind: 'part', part: { lcsc: what, ...(reading ? { reading } : {}) }, ...(note !== '' ? { text: note } : {}) }
}

/** The cards of each frame, in the order of `START_FRAMES`. */
function groups(req: StartRequest): Body[][] {
  const requirement = (said: string, text: string): Body[] => (text === '' ? [] : [{ kind: 'requirement', text: `${said}: ${text}` }])
  return [
    req.power.map((row) => ({ kind: 'power', text: powerText(row) })),
    req.connections.map((row) => ({ kind: 'connection', text: connectionText(row) })),
    [...req.sizes.map((size): Body => ({ kind: 'size', size })), ...requirement('Fits an enclosure', req.enclosure), ...requirement('Connector edges', req.edges)],
    req.parts.map(partCard),
    req.fab ? [{ kind: 'fab', fab: req.fab }] : [],
    req.rules.trim() !== '' ? [{ kind: 'rule', text: req.rules.trim() }] : [],
    req.links.map((l) => ({ kind: 'link', text: l.note === '' ? l.url : `${l.url}\n${l.note}` }))
  ]
}

/** The cards file of a project made from `req`: a frame for each slot that holds something, ids `C1`, `C2`, and so on. */
export function startCards(req: StartRequest): CardsFile {
  const cards: Card[] = []
  let next = 1
  for (const [i, bodies] of groups(req).entries()) {
    if (bodies.length === 0) continue
    const frame = `C${next++}`
    cards.push({ id: frame, kind: 'frame', by: 'person', name: START_FRAMES[i] })
    for (const body of bodies) cards.push({ id: `C${next++}`, by: 'person', frame, ...body })
  }
  return { next, cards }
}
