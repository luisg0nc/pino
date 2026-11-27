import type { ChatItem } from '../../shared/chat'
import { addUsageFacts, addUsage, isResumedTurn, medianCost, usageFacts, usageOf, type ProjectUsage, type UsageRow } from '../../shared/usage'
import { readLog } from './chatlog'
import { listPrompts } from './prompts'

// What Claude Code spent on a project: each prompt of `listPrompts` with what its turns used, from the `turn`
// lines of `.pino/chat/` (the CLI's own `result` numbers and the builds that ran, kept by the transcript), and the
// pictures the items of each turn hold. Reads only.

/** Every line of a log is read: a turn's numbers are on its last line, its pictures on the lines before it. */
const ALL = Number.MAX_SAFE_INTEGER

/** The items of a log once each, where each first stood, as last written (an item is written again when it changes). */
function once(items: readonly ChatItem[]): ChatItem[] {
  const at = new Map<string, number>()
  const out: ChatItem[] = []
  for (const item of items) {
    const i = at.get(item.id)
    if (i === undefined) {
      at.set(item.id, out.length)
      out.push(item)
    } else out[i] = item
  }
  return out
}

type Took = Pick<UsageRow, 'usage' | 'resumed' | 'facts' | 'turns'>

/** What the turns of a conversation took, by the id of the prompt each answered: the last sent before it. */
function tookOf(items: readonly ChatItem[]): Map<string, Took> {
  const out = new Map<string, Took>()
  let prompt: string | undefined
  let turn: ChatItem[] = []
  for (const item of once(items)) {
    if (item.kind === 'user' && item.state === 'sent') prompt = item.id
    if (item.kind !== 'turn') {
      turn.push(item)
      continue
    }
    if (prompt !== undefined) {
      const was = out.get(prompt)
      const facts = usageFacts([...turn, item])
      const used = item.usage ? usageOf(item.usage) : undefined
      const usage = was?.usage && used ? addUsage(was.usage, used) : (was?.usage ?? used)
      const resumed = was?.resumed === true || isResumedTurn(item.usage)
      out.set(prompt, { facts: was ? addUsageFacts(was.facts, facts) : facts, turns: [...(was?.turns ?? []), item.id], ...(usage ? { usage } : {}), ...(resumed ? { resumed: true } : {}) })
    }
    turn = []
  }
  return out
}

/** The prompts of the project in `dir`, as `listPrompts` numbers them, with what each took, and the median cost of a prompt. */
export async function listUsage(dir: string): Promise<ProjectUsage> {
  const prompts = await listPrompts(dir)
  const conversations = [...new Set(prompts.map((p) => p.conversation))]
  // By conversation and prompt: two conversations may hold a prompt of the same id.
  const took = new Map<string, Map<string, Took>>()
  for (const conversation of conversations) took.set(conversation, tookOf(await readLog(dir, conversation, ALL)))
  const rows: UsageRow[] = prompts.map((p) => ({ ...p, ...(took.get(p.conversation)?.get(p.id) ?? { facts: { pictures: {}, builds: { count: 0 } }, turns: [] }) }))
  const median = medianCost(rows)
  return { rows, ...(median !== undefined ? { median } : {}) }
}
