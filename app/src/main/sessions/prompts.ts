import type { PromptRow } from '../../shared/chat'
import { conversations, readPrompts } from './chatlog'

// The prompts of a project, across all its conversations: what the Brief numbers Claude's cards by. They are read from
// the logs of `.pino/chat/`: the person's prompts that were sent, never one still queued or not sent. Reads only.

export type { PromptRow }

/** The most rows listed: the newest. */
export const MOST_PROMPTS = 2000

/**
 * The prompts of the project in `dir`, oldest first, numbered from 1 across all its conversations (the number is the
 * prompt's wherever it is shown). `most` keeps the newest rows, with the numbers they have in the whole.
 */
export async function listPrompts(dir: string, opts: { most?: number } = {}): Promise<PromptRow[]> {
  const names = await conversations(dir)
  const logged = await Promise.all(names.map(async (conversation) => (await readPrompts(dir, conversation)).map((item) => ({ conversation, id: item.id, text: item.text, at: item.at }))))
  const rows = logged.flat()
  // A stable sort: prompts said in the same millisecond keep the order of their log.
  rows.sort((a, b) => a.at - b.at)
  const numbered = rows.map((row, at) => ({ ...row, number: at + 1 }))
  const most = Math.max(1, opts.most ?? MOST_PROMPTS)
  return numbered.length > most ? numbered.slice(numbered.length - most) : numbered
}
