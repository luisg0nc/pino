// `brief` and `add_card`: the project's Brief as Claude reads it, and the cards of its own it keeps there. What may
// be changed is the store's to say (`CardStore.agent`): nothing of the person's. A part's class, package, stock, price
// and date are main's, from the engine's lookup.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { z } from 'zod'
import { type AgentChange, CARD_ID, LCSC, type PartReading, readingLine, readingOf } from '../../shared/cards'
import { cardsText, readBrief } from '../cards/text'
import { refused, text, type Reply } from './reply'
import { addCardInput, briefInput, capText, DESCRIPTIONS, TOOL_TEXT_LIMIT } from './schemas'
import { ALWAYS, type OnProject, type ToolDeps } from './tools'
import type { ProjectInfo } from '../../shared/project'

type AddCard = z.infer<typeof addCardInput>

const NEEDS_MORE = 'add_card needs kind and text, size or lcsc: nothing was done.'
const NEEDS_ID = 'remove names a card of yours, and so does a change of it: give card with its id, such as "C9". Nothing was done.'

/** A part's reading from the engine, or why there is none. */
async function lookUp(deps: ToolDeps, lcsc: string): Promise<PartReading | { refused: string }> {
  try {
    return readingOf(await deps.fab.lookup({ lcsc }), lcsc, new Date())
  } catch (e) {
    return { refused: (e as Error).message }
  }
}

/** What is said of a part that was just named. */
function partSaid(lcsc: string, found: PartReading | { refused: string }): string {
  if ('refused' in found) return `stock not checked (${found.refused.replace(/\.$/, '')}). The person can check it again on the Brief.`
  if ('missing' in found) return `${lcsc}: ${readingLine(found)}. Check the number.`
  return `${lcsc} is ${readingLine(found)}.`
}

async function addCard(deps: ToolDeps, project: ProjectInfo, args: AddCard): Promise<Reply> {
  const lcsc = args.lcsc?.trim().toUpperCase()
  // The prompt this call answers, read before anything is waited for.
  const turn = deps.turnNow(project.id)
  const done = async (change: AgentChange, wanted: boolean): Promise<{ id: string; part: string | undefined }> => {
    // Looked up only for a number a card could take: the store refuses anything else.
    const found = wanted && lcsc !== undefined && LCSC.test(lcsc) ? await lookUp(deps, lcsc) : undefined
    const reading = found && !('refused' in found) ? found : undefined
    const { id } = await deps.cards.agent(project.id, change, { ...(turn ? { turn } : {}), ...(reading ? { reading } : {}) })
    return { id, part: found && lcsc !== undefined ? partSaid(lcsc, found) : undefined }
  }
  const said = { ...(args.text !== undefined ? { text: args.text } : {}), ...(args.size !== undefined ? { size: args.size } : {}), ...(lcsc !== undefined ? { lcsc } : {}) }

  // A card of its own, changed or taken down.
  if (args.card !== undefined || args.remove === true) {
    if (args.card === undefined || !CARD_ID.test(args.card)) return refused(NEEDS_ID)
    if (args.remove === true) {
      if (args.kind !== undefined || Object.keys(said).length > 0) return refused('remove takes only the id of the card to take down: nothing was done.')
      await done({ op: 'remove', id: args.card }, false)
      return text(`Removed ${args.card}.`)
    }
    if (Object.keys(said).length === 0) return refused('A change of a card gives text, size or lcsc: nothing was done.')
    const card = (await deps.cards.read(project.id)).cards.find((c) => c.id === args.card)
    if (card && args.kind !== undefined && args.kind !== card.kind) return refused(`A card keeps its kind, and ${card.id} is a ${card.kind} card: nothing was done. Remove it and add another.`)
    const changed = await done({ op: 'edit', id: args.card, ...said }, card?.kind === 'part' && card.by === 'agent')
    return text(changed.part === undefined ? `Changed ${changed.id}.` : `Changed ${changed.id}: ${changed.part}`)
  }

  if (args.kind === undefined || (!args.text && args.size === undefined && lcsc === undefined)) return refused(NEEDS_MORE)
  const added = await done({ op: 'add', kind: args.kind, ...said }, args.kind === 'part')
  return text(added.part === undefined ? `Added ${added.id}, ${args.kind}.` : `Added ${added.id}, ${args.kind}: ${added.part}`)
}

export function registerCardTools(server: McpServer, deps: ToolDeps, onProject: OnProject): void {
  server.registerTool('brief', { description: DESCRIPTIONS.brief, inputSchema: briefInput, _meta: ALWAYS }, ({ kind }) =>
    onProject(async (project) => {
      const file = await deps.cards.read(project.id)
      const rows = await deps.prompts(project).catch(() => [])
      const prompts = new Map(rows.map((r) => [r.id, r.number]))
      const brief = kind === undefined ? ((await readBrief(project.dir)) ?? '') : undefined
      return text(capText(cardsText(file, { ...(brief !== undefined ? { brief } : {}), ...(kind ? { kind } : {}), prompts, limit: TOOL_TEXT_LIMIT })))
    })
  )
  server.registerTool('add_card', { description: DESCRIPTIONS.add_card, inputSchema: addCardInput, _meta: ALWAYS }, (args) => onProject((project) => addCard(deps, project, args)))
}
