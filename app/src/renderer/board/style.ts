// The drafting look's colours and rules: which tone each piece of copper takes. Colours come from the tokens
// (styles/tokens.css); what is dimmed is mixed toward the paper, never drawn with alpha, so that overlaps inside a
// layer do not darken.

export interface BoardColours {
  paper: string
  cu: string
  cuFar: string
  hatch: string
  hatchFar: string
  silk: string
  rat: string
  accent: string
  accentWash: string
  warn: string
  fail: string
  muted: string
  userMark: string
  agentMark: string
}

const TOKENS: Record<keyof BoardColours, string> = {
  paper: '--board-paper',
  cu: '--cu',
  cuFar: '--cu-far',
  hatch: '--hatch',
  hatchFar: '--hatch-far',
  silk: '--silk',
  rat: '--rat',
  accent: '--accent',
  accentWash: '--accent-wash',
  warn: '--warn',
  fail: '--fail',
  muted: '--muted',
  userMark: '--user-mark',
  agentMark: '--agent-mark'
}

/** The board's colours as the theme has them now, read off an element of the page. */
export function boardColours(el: Element): BoardColours {
  const style = getComputedStyle(el)
  return Object.fromEntries(Object.entries(TOKENS).map(([key, token]) => [key, style.getPropertyValue(token).trim()])) as unknown as BoardColours
}

/** `keep` of the colour, the rest the other. */
export const mix = (colour: string, other: string, keep: number): string => `color-mix(in srgb, ${colour} ${Math.round(keep * 100)}%, ${other})`

/** What is kept of stale copper's colour: it is mixed 60 % toward the paper. */
export const STALE_KEEP = 0.4

export interface CopperAt {
  /** On the layer being looked at. */
  active: boolean
  throughHole: boolean
  net: string
  netColours: boolean
  stale: boolean
}

/**
 * Graphite on the layer looked at, a pencil tone on the others; a pad through the board is always graphite; a net's
 * own colour replaces the graphite only while net colours are on; stale copper fades toward the paper.
 */
export function copperColour(o: CopperAt, c: BoardColours, netColourOf: (net: string) => string | null): string {
  const base = o.throughHole ? c.cu : !o.active ? c.cuFar : ((o.netColours && netColourOf(o.net)) || c.cu)
  return o.stale ? mix(base, c.paper, STALE_KEEP) : base
}
