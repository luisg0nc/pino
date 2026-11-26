// The marks of the open project. Main is the only writer of `.pino/marks/marks.json`: one change at a time for each
// project, each written whole before anyone is told of it.

import { centreOf, hasTarget, shortLabel } from '../../shared/board/refs'
import { markLabel, markPayload, MAX_NOTE, MOST_MARKS, withCrossings, type Mark, type MarkPatch, type NewMark } from '../../shared/marks'
import type { ProjectInfo } from '../../shared/project'
import type { BuildModel } from '../model'
import { loadMarks, sanitiseMark, saveMarks, type MarksFile } from './file'
import { reanchor } from './reanchor'

interface Held {
  file: MarksFile
  /** What the person has not been told yet of the file. */
  problem: string | null
}

export class MarkStore {
  private readonly held = new Map<string, Promise<Held>>()
  private readonly lines = new Map<string, Promise<unknown>>()
  private readonly problems = new Map<string, string>()
  private readonly listeners = new Set<(projectId: string, marks: Mark[]) => void>()

  constructor(private readonly deps: { model: (p: ProjectInfo) => Promise<BuildModel | null>; now?: () => Date; notice?: (text: string) => void }) {}

  private load(p: ProjectInfo): Promise<Held> {
    let held = this.held.get(p.id)
    if (!held) {
      held = loadMarks(p.dir).then(({ file, problem }) => {
        if (problem) {
          this.problems.set(p.id, problem)
          this.deps.notice?.(problem)
        }
        return { file, problem: problem ?? null }
      })
      this.held.set(p.id, held)
      held.catch(() => this.held.delete(p.id))
    }
    return held
  }

  /** What the person should be told of the project's marks file, once. */
  takeProblem(projectId: string): string | null {
    const problem = this.problems.get(projectId) ?? null
    this.problems.delete(projectId)
    return problem
  }

  /** One change at a time for a project, each begun on what the one before left. */
  private change<T>(p: ProjectInfo, change: (file: MarksFile) => Promise<{ file: MarksFile; value: T } | { value: T }>): Promise<T> {
    const next = (this.lines.get(p.id) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const held = await this.load(p)
        const made = await change(held.file)
        if ('file' in made) {
          await saveMarks(p.dir, made.file)
          held.file = made.file
          for (const cb of this.listeners) cb(p.id, made.file.marks)
        }
        return made.value
      })
    this.lines.set(p.id, next)
    return next
  }

  async list(p: ProjectInfo): Promise<Mark[]> {
    await this.lines.get(p.id)?.catch(() => {})
    return (await this.load(p)).file.marks
  }

  /** The person's marks that have not been sent yet, oldest first. */
  async drafts(p: ProjectInfo): Promise<Mark[]> {
    return (await this.list(p)).filter((m) => m.status === 'draft' && m.author === 'user')
  }

  /** The marks sent and not resolved. */
  async open(p: ProjectInfo): Promise<Mark[]> {
    return (await this.list(p)).filter((m) => m.status === 'sent')
  }

  add(p: ProjectInfo, asked: NewMark, by: 'user' | 'agent'): Promise<Mark> {
    return this.change(p, async (file) => {
      if (file.marks.length >= MOST_MARKS) throw new Error(`pino keeps ${MOST_MARKS} marks: resolve or remove some`)
      const id = `M${file.next}`
      const checked = sanitiseMark({
        ...asked, id, author: by, status: by === 'agent' ? 'sent' : 'draft', anchor: 'ok', build: 0, payload: '', label: id,
        note: String((asked as { note?: unknown }).note ?? '').trim(), createdAt: (this.deps.now?.() ?? new Date()).toISOString()
      })
      if (!checked) throw new Error('that is not a mark')
      const model = await this.deps.model(p)
      if (!model) throw new Error('there is no build to mark yet')
      const { board, circuit } = boardOf(model)
      let mark: Mark = { ...checked, build: model.result.number, checkedBuild: model.result.number }
      const target = mark.kind === 'point' ? mark.target : mark.kind === 'arrow' ? mark.from : null
      if (target && !hasTarget(board, target)) throw new Error(`${shortLabel(board, target)} is not on this board`)
      // Where a thing is comes from the board, not from where it was clicked.
      if (mark.kind === 'point' && mark.space === 'board') mark = { ...mark, at: centreOf(board, mark.target)! }
      if (mark.kind === 'arrow' && mark.from && by === 'user') mark = { ...mark, fromAt: centreOf(board, mark.from)! }
      if (mark.kind === 'stroke' && (mark.points.length < 2 || !board.copper.includes(mark.layer))) throw new Error('that is not a stroke on this board')
      if (mark.kind === 'region' && (mark.points.length < 3 || !mark.layers.length || !mark.layers.every((l) => board.copper.includes(l)))) throw new Error('that is not a region on this board')
      mark = withCrossings(mark, board)
      mark = { ...mark, label: markLabel(mark), payload: markPayload(mark, board, circuit) }
      return { file: { ...file, next: file.next + 1, marks: [...file.marks, mark] }, value: mark }
    })
  }

  private edit(p: ProjectInfo, id: string, edit: (mark: Mark) => Promise<Mark>): Promise<Mark> {
    return this.change(p, async (file) => {
      const mark = file.marks.find((m) => m.id === id)
      if (!mark) throw new Error(`there is no mark ${id}`)
      const next = await edit(mark)
      return { file: { ...file, marks: file.marks.map((m) => (m === mark ? next : m)) }, value: next }
    })
  }

  update(p: ProjectInfo, id: string, patch: MarkPatch): Promise<Mark> {
    return this.edit(p, id, async (mark) => {
      let next: Mark = mark
      if (patch.note !== undefined) {
        const note = String(patch.note).trim()
        if (note.length > MAX_NOTE) throw new Error(`a note is ${MAX_NOTE} characters at most`)
        next = { ...next, note }
      }
      if (patch.status === 'draft' && next.author === 'user') {
        const { resolvedNote: _note, resolvedBy: _by, ...rest } = next
        next = { ...rest, status: 'draft' } as Mark
      }
      const redraws = patch.intent !== undefined || patch.layer !== undefined
      if (!redraws) return next
      const model = await this.deps.model(p)
      if (!model) throw new Error('there is no build to mark yet')
      const { board, circuit } = boardOf(model)
      if (patch.intent !== undefined && next.kind === 'region') next = { ...next, intent: patch.intent === 'keep-clear' || patch.intent === 'put-here' ? patch.intent : null }
      if (patch.layer !== undefined) {
        const layers = patch.layer === 'all' ? board.copper : [patch.layer]
        if (!layers.every((l) => board.copper.includes(l))) throw new Error(`this board has no layer ${patch.layer}`)
        if (next.kind === 'region') next = { ...next, layers: [...layers] }
        else if (next.kind === 'stroke' && patch.layer !== 'all') next = { ...next, layer: patch.layer }
      }
      next = withCrossings(next, board)
      return { ...next, payload: markPayload(next, board, circuit) }
    })
  }

  remove(p: ProjectInfo, id: string): Promise<void> {
    return this.change(p, async (file) => {
      const marks = file.marks.filter((m) => m.id !== id)
      return marks.length === file.marks.length ? { value: undefined } : { file: { ...file, marks }, value: undefined }
    })
  }

  /** The drafts the agent now has. */
  markSent(p: ProjectInfo, ids: string[]): Promise<void> {
    return this.change(p, async (file) => {
      let sent = 0
      const marks = file.marks.map((m): Mark => (m.status === 'draft' && ids.includes(m.id) ? (sent++, { ...m, status: 'sent' }) : m))
      return sent ? { file: { ...file, marks }, value: undefined } : { value: undefined }
    })
  }

  resolve(p: ProjectInfo, id: string, note: string, by: 'user' | 'agent'): Promise<Mark> {
    return this.edit(p, id, async (mark) => {
      if (mark.status === 'draft') throw new Error(`${id} has not been sent to you yet`)
      return { ...mark, status: 'resolved', resolvedNote: String(note).trim().slice(0, MAX_NOTE), resolvedBy: by }
    })
  }

  reanchor(p: ProjectInfo, model: BuildModel): Promise<void> {
    if (!model.result.hash) return Promise.resolve()
    return this.change(p, async (file) => {
      let changed = false
      const marks = file.marks.map((mark) => {
        const next = reanchor(mark, model)
        // A look that found everything as it was is not worth a write.
        const same = next === mark || (next.anchor === mark.anchor && next.payload === mark.payload && JSON.stringify(next) === JSON.stringify({ ...mark, checkedBuild: next.checkedBuild }))
        if (!same) changed = true
        return same ? mark : next
      })
      return changed ? { file: { ...file, marks }, value: undefined } : { value: undefined }
    })
  }

  onChange(cb: (projectId: string, marks: Mark[]) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }
}

/** The board a new mark is made on: the routed one while its route is current. */
function boardOf(model: BuildModel) {
  const board = model.result.routing?.state === 'current' && model.routeBoard ? model.routeBoard : model.board
  return { board, circuit: model.circuit }
}
