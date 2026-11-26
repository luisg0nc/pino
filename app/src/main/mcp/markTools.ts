// Claude's side of the marks: pointing back in orange, reading the marks, and saying one is done.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { toBoard } from '../../shared/board/coords'
import { gapSpan } from '../../shared/board/measure'
import { centreOf, shortLabel, type Target } from '../../shared/board/refs'
import { MAX_NOTE, MOST_AGENT_TARGETS, MOST_MARKS, type Mark, type NewMark } from '../../shared/marks'
import { sheetPlace } from '../../shared/sheet'
import type { BuildModel } from '../model'
import { boardOf, targetOfName } from './readTools'
import { refused, text } from './reply'
import { DESCRIPTIONS, marksInput, MOST_LINES, pointInput, resolveInput } from './schemas'
import { ALWAYS, type OnProject, type ToolDeps } from './tools'

const NOTHING_BUILT = 'Nothing has been built yet. pino builds board.py when it is saved.'

type Asked = string | { gap: [string, string] }

/** The mark one of `point`'s targets asks for, or why it cannot be made. */
function markFor(model: BuildModel, asked: Asked, space: 'board' | 'sheet', note: string): NewMark | { error: string } {
  const board = boardOf(model)
  const named = (name: string) => targetOfName(board, model.circuit, name)
  if (typeof asked !== 'string') {
    if (space === 'sheet') return { error: 'A gap is measured on the board: leave space out.' }
    const [a, b] = asked.gap.map(named)
    if ('error' in a) return a
    if ('error' in b) return b
    const span = gapSpan(board, a, b)
    return { kind: 'arrow', from: a, toward: b, fromAt: toBoard(span.from), to: toBoard(span.to), note }
  }
  const target: Target | { error: string } = named(asked)
  if ('error' in target) return target
  if (space === 'board') return { kind: 'point', space, target, at: centreOf(board, target) ?? { x: 0, y: 0 }, note }
  const at = model.sheet && sheetPlace(model.sheet, target)
  return at ? { kind: 'point', space, target, at, note } : { error: `The sheet does not draw ${shortLabel(board, target)}.` }
}

const WHO = { user: 'person', agent: 'you' } as const

function markLine(m: Mark): string {
  const said = m.status === 'resolved' && m.resolvedNote ? `resolved: "${m.resolvedNote}"` : m.note ? `note: "${m.note}"` : null
  return [m.id, m.status, WHO[m.author], m.payload, said].filter(Boolean).join(' · ')
}

export function registerMarkTools(server: McpServer, deps: ToolDeps, onProject: OnProject): void {
  server.registerTool('point', { description: DESCRIPTIONS.point, inputSchema: pointInput, _meta: ALWAYS }, (input) =>
    onProject(async (project) => {
      if (!input.targets.length || input.targets.length > MOST_AGENT_TARGETS) return refused(`point takes 1 to ${MOST_AGENT_TARGETS} targets.`)
      const long = (input.note ?? '').trim().length
      if (long > MAX_NOTE) return refused(`A note is ${MAX_NOTE} characters at most: this one is ${long}.`)
      const model = await deps.model(project)
      if (!model) return refused(NOTHING_BUILT)
      // Every target is looked up before any mark is made: all of them, or none.
      const asked = input.targets.map((t) => markFor(model, t, input.space ?? 'board', input.note ?? ''))
      const errors = [...new Set(asked.flatMap((m) => ('error' in m ? [m.error] : [])))]
      if (errors.length) return refused(errors.join('\n'))
      if ((await deps.marks.list(project)).length + asked.length > MOST_MARKS) return refused(`pino keeps ${MOST_MARKS} marks: resolve or remove some`)
      const made: Mark[] = []
      for (const mark of asked) made.push(await deps.marks.add(project, mark as NewMark, 'agent'))
      const names = made.map((m) => `${m.id} ${m.label}`).join(', ')
      return text(`Pointed: ${names}. They are orange in the view.`)
    })
  )

  server.registerTool('marks', { description: DESCRIPTIONS.marks, inputSchema: marksInput, _meta: ALWAYS }, (input) =>
    onProject(async (project) => {
      const all = await deps.marks.list(project)
      const open = all.filter((m) => m.status !== 'resolved')
      const shown = input.status === 'all' ? [...open, ...all.filter((m) => m.status === 'resolved')] : open
      if (!shown.length) return text(input.status === 'all' ? 'There are no marks.' : 'There are no open marks.')
      const lines = shown.map(markLine)
      return text((lines.length > MOST_LINES ? [...lines.slice(0, MOST_LINES), `and ${lines.length - MOST_LINES} more marks`] : lines).join('\n'))
    })
  )

  server.registerTool('resolve_mark', { description: DESCRIPTIONS.resolve_mark, inputSchema: resolveInput, _meta: ALWAYS }, (input) =>
    onProject(async (project) => {
      const mark = await deps.marks.resolve(project, input.id, input.note, 'agent')
      return text(`Resolved ${mark.id}: ${mark.resolvedNote}`)
    })
  )
}
