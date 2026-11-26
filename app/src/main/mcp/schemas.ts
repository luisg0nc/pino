// What the MCP server says of itself and of its tools, their inputs, and the caps on what they answer. Everything
// here costs on every turn (`turncost.test.ts`).

import { z } from 'zod'
import { MOST_AGENT_TARGETS } from '../../shared/marks'

/** The long edge of a picture, px. */
export const DEFAULT_SIZE = 1280
export const MIN_SIZE = 400
export const MAX_SIZE = 2000
/** The most characters of any tool's text, and the most lines of a list before the rest are counted. */
export const TOOL_TEXT_LIMIT = 8000
export const MOST_LINES = 40

/** A text no longer than `limit`, cut at a line, saying how much was left out. */
export function capText(text: string, limit: number = TOOL_TEXT_LIMIT): string {
  if (text.length <= limit) return text
  const room = limit - 40
  const cut = text.lastIndexOf('\n', room)
  const kept = text.slice(0, cut > room / 2 ? cut : room)
  return `${kept}\n(cut: ${text.length - kept.length} more characters)`
}

export const SERVER_INSTRUCTIONS = [
  "This server is pino's: the printed circuit board of the project open in pino. pino builds board.py on every save; the tools read the newest build, in the board's own frame: millimetres, origin at the outline centre, x right, y up. Name a thing as U1 (a part), U1.3 (a pad), net:VBUS, track:<uuid> or via:<uuid>.",
  "See: project (the folder, the newest build and the fab's limits), look (a picture of the views, with the marks), check (every check, and each finding with its place), measure (numbers from the board file), nets (nets by part and pin).",
  'Parts: parts (JLC parts by LCSC number or words: stock, price, basic or extended, and how board.py names them). The person makes the fab files with Fab files… in pino, from a routed board with no errors.',
  'Marks: point (show the person what you mean, in orange), marks (the marks and their exact lines), resolve_mark (when you have done what a mark asks).',
  'Routing: route (start, follow or cancel the router, which runs in the background).',
  'More, to load when needed: trace (where a pin leads and what copper joins it), ratsnest (the placement score and the open connections), diff (what changed between two builds), route_net (try one net), nudge (try a part moved), keep (a routed net as lines for board.py). route_net, nudge and keep change nothing: they answer with lines for you to write into board.py.'
].join('\n')

export const PROJECT_DESCRIPTION = "The project open in pino: its name, its folder, whether board.py and brief.md are there, the newest build in a line, and the limits of the fab it is built for."

export const DESCRIPTIONS = {
  look: 'One picture of what the person sees: the schematic, the board or the 3D view of the build on show, with the marks drawn and labelled by id. Without tab, the tab the person is on. layers chooses copper layers, the first on top; window crops the board or sheet to a box in millimetres. Take numbers from measure, never from the picture.',
  check: 'The newest build by its checks: each check with its verdict, then the findings with their places and parts. Narrow with source (erc, drc, netlist, expect, courtyard, fit, placement, lint, parts, copper, route, release, kernel, board.py), severity, or near (a part, pad or net).',
  measure: 'A number from the board file: gap (copper edge to copper edge between a and b), distance (centre to centre), edge (a to the board edge), length, width, area (of a net; area may take a layer such as F.Cu) or vias (all, or of a net). Names: U1, U1.3, net:VBUS, track:<uuid>, via:<uuid>.',
  nets: "The circuit's nets by part and pin: net names one net and lists its pins with their names; part lists a part's pins with their nets; neither lists every net with its size.",
  trace: 'Where a pin leads: its net, the other pins on it, and which of them copper joins already (groups of pins joined by tracks, vias or a pour). pin is written U1.3.',
  ratsnest: "How the placement is doing: the engine's score, the crossings and the length of what is still open, and each open connection by part and pin.",
  diff: 'What changed between two builds, in words: the circuit and the layout. from and to are build numbers; without them, the build before the newest and the newest.',
  point: `Show the person what you mean, in orange, on the board and the sheet: 1 to ${MOST_AGENT_TARGETS} targets, each a name (U1, U1.3, net:VBUS, track:<uuid>) or {"gap": [a, b]}, which draws the measured gap between two things. note says why. The answer gives each new mark's id.`,
  marks: "The marks, open ones first: each with its id, whether it is a draft, sent or resolved, whose it is, its exact line and the person's note.",
  resolve_mark: 'Say a mark is done: its id (M3) and a note saying what you did. A mark the person has not sent yet cannot be resolved.',
  route: "The autorouter, in the background on the newest build. start begins it (minutes; the view shows its progress), status says how it stands and which nets are open, cancel stops it.",
  route_net: 'Try routing one net on the routed board (or the unrouted one), with a region, layers, a corridor or nets to rip up. Changes nothing: the answer says what it would do, and gives the line to write into board.py when you want it.',
  nudge: "Try one part moved or turned: what it does to the courtyards, the fit and the ratsnest (and, with route, to the router's share). Changes nothing: the answer gives the line to write into board.py.",
  keep: "A routed net's copper as keep_route lines for board.py, so that the next route keeps it as it is. Changes nothing until you write them.",
  parts: "JLC parts: lcsc gives one part by its LCSC number (such as C25804) with how board.py names it; search looks parts up by words (package and basic narrow it). Each answer line says basic, preferred or extended, package, stock and price. Text search leaves out parts whose stock is not known, so look a known number up by lcsc."
} as const

export const noInput = z.strictObject({})

export const lookInput = z.strictObject({
  tab: z.enum(['schematic', 'board', '3d']).optional(),
  layers: z.array(z.string()).max(8).optional(),
  window: z.strictObject({ x0: z.number(), y0: z.number(), x1: z.number(), y1: z.number() }).optional(),
  marks: z.boolean().optional(),
  size: z.number().int().optional()
})

export const checkInput = z.strictObject({ source: z.string().optional(), severity: z.enum(['error', 'warning', 'info']).optional(), near: z.string().optional() })

export const measureInput = z.strictObject({
  what: z.enum(['gap', 'distance', 'length', 'width', 'area', 'vias', 'edge']),
  a: z.string().optional(),
  b: z.string().optional(),
  net: z.string().optional(),
  layer: z.string().optional()
})

export const netsInput = z.strictObject({ net: z.string().optional(), part: z.string().optional() })
export const traceInput = z.strictObject({ pin: z.string() })
export const diffInput = z.strictObject({ from: z.number().int().optional(), to: z.number().int().optional() })

export const pointInput = z.strictObject({
  targets: z.array(z.union([z.string(), z.strictObject({ gap: z.tuple([z.string(), z.string()]) })])),
  note: z.string().optional(),
  space: z.enum(['board', 'sheet']).optional()
})

export const marksInput = z.strictObject({ status: z.enum(['open', 'all']).optional() })
export const resolveInput = z.strictObject({ id: z.string(), note: z.string() })

export const routeInput = z.strictObject({ action: z.enum(['start', 'status', 'cancel']) })
export const routeNetInput = z.strictObject({
  net: z.string(),
  region: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  layers: z.array(z.string()).max(8).optional(),
  corridor: z.array(z.tuple([z.number(), z.number()])).max(64).optional(),
  rip: z.array(z.string()).max(64).optional()
})
export const nudgeInput = z.strictObject({ part: z.string(), by: z.tuple([z.number(), z.number()]).optional(), rot: z.number().optional(), back: z.boolean().optional(), route: z.boolean().optional() })
export const keepInput = z.strictObject({ net: z.string() })
export const partsInput = z.strictObject({ lcsc: z.string().optional(), search: z.string().optional(), package: z.string().optional(), basic: z.boolean().optional(), limit: z.number().int().min(1).max(20).optional() })
