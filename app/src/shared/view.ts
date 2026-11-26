// What the views show and what is chosen in them: the same rules for the window and for main, which tells Claude
// what the person sees.

import { toKicad } from './board/coords'
import type { Pt } from './board/geom'
import type { Target } from './board/refs'
import type { BuildState } from './build'
import type { Placement } from './circuit'

/** The three views over one build of a board. */
export type ViewTab = 'schematic' | 'board' | '3d'

/** The standard views of the 3D tab. */
export type ViewName = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right' | 'iso'

export const TAB_NAMES: Record<ViewTab, string> = { schematic: 'Schematic', board: 'Board', '3d': '3D' }

/** What is in hand in the views: the same thing in all three. */
export interface Selection {
  /** The view it was chosen in. */
  tab: ViewTab
  target: Target
  /** The exact reference Claude gets. */
  text: string
  /** The few words a tab or a tag shows. */
  label: string
}

/** A tab's name; on a tab not chosen, with what is selected, so that switching is seen to keep it. */
export function tabLabel(tab: ViewTab, chosen: ViewTab, selection: Selection | null): string {
  return tab !== chosen && selection ? `${TAB_NAMES[tab]} · ${selection.label}` : TAB_NAMES[tab]
}

export interface BoardLook {
  /** The copper layer looked at. */
  active: string
  pours: boolean
  ratsnest: boolean
  silk: boolean
  netColours: boolean
}

export const DEFAULT_LOOK: BoardLook = { active: 'F.Cu', pours: true, ratsnest: true, silk: true, netColours: false }

export type BandKind = 'failed' | 'older'

/** The sentence at the foot of a view when what it draws is not the latest build. `shown`: an older build chosen in the strip. */
export function bandFor(state: BuildState | null, shown: number | null): { kind: BandKind; text: string } | null {
  const latest = state?.latest
  if (!state || !state.lastGood) return null
  if (shown !== null && latest && shown !== latest.number) return { kind: 'older', text: `Showing h${shown}. The latest is h${latest.number}.` }
  if (state.problem) return { kind: 'failed', text: `Drawn from h${state.lastGood.number}. ${state.problem}` }
  return null
}

/**
 * The ratsnest in the board file's frame, as [from, to, net]: the placement's open lines, or, over a current route,
 * only those of the nets it left open.
 */
export function ratsFor(placement: Placement | null, open: ReadonlySet<string> | null): Array<[Pt, Pt, string]> {
  return (placement?.edges ?? [])
    .filter(([net]) => open === null || open.has(net))
    .map(([net, a, b]) => [toKicad({ x: a[0], y: a[1] }), toKicad({ x: b[0], y: b[1] }), net])
}

/** What a view with nothing to draw says: why, in a few words, and what happened when something did. */
export function emptyWords(state: BuildState | null): { title: string; lead: string | null } {
  if (state?.engine.state === 'failed') {
    const [what, ...why] = state.engine.reason.split(': ')
    return { title: `${what}.`, lead: why.join(': ') || null }
  }
  if (state?.building) return { title: 'Building the board.', lead: 'pino runs board.py and draws what it makes.' }
  const failed = state?.latest?.verdict === 'failed' ? state.latest : null
  if (failed) return { title: `h${failed.number} failed.`, lead: state!.problem?.replace(`h${failed.number} failed: `, '') ?? null }
  if (state?.problem) return { title: 'Nothing was built.', lead: state.problem }
  return { title: 'Nothing to draw yet.', lead: null }
}
