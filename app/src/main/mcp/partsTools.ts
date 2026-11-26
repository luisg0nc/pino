// JLC parts for Claude: stock, price and class from the engine (jlcsearch behind it), and how to name a part in
// board.py.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { FAB_UNAVAILABLE, type PartInfo, type PartsResult } from '../../shared/fab'
import { refused, text } from './reply'
import { capText, DESCRIPTIONS, MOST_LINES, partsInput } from './schemas'
import { ALWAYS, type OnProject, type ToolDeps } from './tools'

const DESCRIPTION_MOST = 80

function partLine(p: PartInfo): string {
  const words = p.description.length > DESCRIPTION_MOST ? `${p.description.slice(0, DESCRIPTION_MOST - 1)}…` : p.description
  const stock = p.stock === null ? 'stock not known at JLC' : `stock ${p.stock.toLocaleString('en-US')} at JLC`
  const checked = (p.checked_at ?? p.fetched_at).slice(0, 10)
  const price = p.price === null ? '' : ` · $${p.price} each`
  return `${p.lcsc} · ${p.class} · ${p.package} · ${words} · ${stock} (checked ${checked})${price}`
}

function boardLine(r: PartsResult['resolved'][number]): string {
  return r.how
    ? `In board.py: lcsc="${r.lcsc}" (pino maps it to ${r.symbol} and ${r.footprint})`
    : `In board.py: lcsc="${r.lcsc}" with symbol= and footprint=: pino has no KiCad part for it, so check the pins against its datasheet.`
}

export function partsAnswer(result: PartsResult): string {
  const lines = result.parts.slice(0, MOST_LINES).map(partLine)
  const left = result.parts.length - lines.length
  return capText([result.headline, ...lines, ...(left > 0 ? [`and ${left} more: narrow the search`] : []), ...result.resolved.map(boardLine)].join('\n'))
}

export function registerPartsTools(server: McpServer, deps: ToolDeps, onProject: OnProject): void {
  server.registerTool('parts', { description: DESCRIPTIONS.parts, inputSchema: partsInput, _meta: ALWAYS }, (input) =>
    onProject(async (project) => {
      if (!deps.fab?.available()) return refused(FAB_UNAVAILABLE)
      if ((input.lcsc === undefined) === (input.search === undefined)) return refused('Give lcsc (a part number) or search (words), one of the two.')
      return text(partsAnswer(await deps.fab.parts(project, input)))
    })
  )
}
