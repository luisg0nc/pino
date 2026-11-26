// The marks of a project on disk: `.pino/marks/marks.json`, written whole or not at all, by main alone. A file that
// cannot be read is set aside, never overwritten, and nothing in it is dropped quietly.

import { lstat, readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import type { Pt } from '../../shared/board/geom'
import { isRecord } from '../../shared/build'
import { MAX_NOTE, MAX_STROKE_POINTS, type Mark, type MarkBase } from '../../shared/marks'
import { APP } from '../../shared/app'
import { writeFileAtomic } from '../atomic'
import { ownFolder, whyNotOwn } from '../own'
import { targetOfValue } from '../view'

export const MARKS_FILE = 'marks/marks.json'
const SCHEMA = 'pino.marks/1'

export interface MarksFile {
  schema: typeof SCHEMA
  /** The number the next mark takes: an id is never given twice. */
  next: number
  marks: Mark[]
}

const empty = (): MarksFile => ({ schema: SCHEMA, next: 1, marks: [] })

const MOST_TEXT = 4000
const MOST_LABEL = 120
const MOST_NAMES = 600

const text = (v: unknown, most: number): v is string => typeof v === 'string' && v.length <= most
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const pointOf = (v: unknown): Pt | null => (isRecord(v) && finite(v.x) && finite(v.y) ? { x: v.x, y: v.y } : null)
const pointsOf = (v: unknown): Pt[] | null => {
  if (!Array.isArray(v) || v.length > MAX_STROKE_POINTS) return null
  const points = v.map(pointOf)
  return points.every((p) => p !== null) ? (points as Pt[]) : null
}
const names = (v: unknown): v is string[] => Array.isArray(v) && v.length <= MOST_NAMES && v.every((n) => text(n, MOST_LABEL))

function baseOf(v: Record<string, unknown>): MarkBase | null {
  const ok =
    typeof v.id === 'string' && /^M[1-9]\d{0,8}$/.test(v.id) &&
    (v.author === 'user' || v.author === 'agent') &&
    ['draft', 'sent', 'resolved'].includes(v.status as string) &&
    ['ok', 'moved', 'stale'].includes(v.anchor as string) &&
    finite(v.build) && text(v.note, MAX_NOTE) && text(v.payload, MOST_TEXT) && text(v.label, MOST_LABEL) && text(v.createdAt, 40)
  if (!ok) return null
  const base = { id: v.id, author: v.author, status: v.status, anchor: v.anchor, build: v.build, note: v.note, payload: v.payload, label: v.label, createdAt: v.createdAt } as MarkBase
  if (finite(v.checkedBuild)) base.checkedBuild = v.checkedBuild
  if (text(v.resolvedNote, MOST_TEXT)) base.resolvedNote = v.resolvedNote
  if (v.resolvedBy === 'user' || v.resolvedBy === 'agent') base.resolvedBy = v.resolvedBy
  if (isRecord(v.was) && pointOf(v.was.at) && text(v.was.text, MOST_TEXT)) base.was = { at: pointOf(v.was.at)!, text: v.was.text }
  return base
}

/** The value as a mark with only the fields pino knows, or null when it is none. */
export function sanitiseMark(value: unknown): Mark | null {
  if (!isRecord(value)) return null
  const base = baseOf(value)
  if (!base) return null
  const v = value
  if (v.kind === 'point') {
    const target = targetOfValue(v.target)
    const at = pointOf(v.at)
    return target && at && (v.space === 'board' || v.space === 'sheet') ? { ...base, kind: 'point', space: v.space, target, at } : null
  }
  if (v.kind === 'arrow') {
    const from = v.from === null ? null : targetOfValue(v.from)
    const fromAt = pointOf(v.fromAt)
    const to = pointOf(v.to)
    // Only Claude's arrow spans a gap, and then between two things.
    const toward = v.toward === undefined ? undefined : targetOfValue(v.toward)
    if (toward === null || (toward && (!from || base.author !== 'agent'))) return null
    return fromAt && to && (v.from === null || from) ? { ...base, kind: 'arrow', from, fromAt, to, ...(toward ? { toward } : {}) } : null
  }
  if (v.kind === 'stroke') {
    const points = pointsOf(v.points)
    const crosses = v.crosses
    return points && text(v.layer, MOST_LABEL) && isRecord(crosses) && names(crosses.nets) && names(crosses.parts)
      ? { ...base, kind: 'stroke', layer: v.layer, points, crosses: { nets: crosses.nets, parts: crosses.parts } }
      : null
  }
  if (v.kind === 'region') {
    const points = pointsOf(v.points)
    return points && names(v.layers) && names(v.holds) && (v.intent === null || v.intent === 'keep-clear' || v.intent === 'put-here')
      ? { ...base, kind: 'region', layers: v.layers, intent: v.intent, points, holds: v.holds }
      : null
  }
  return null
}

function fileOf(value: unknown): MarksFile | null {
  if (!isRecord(value) || value.schema !== SCHEMA || !finite(value.next) || !Array.isArray(value.marks)) return null
  const marks = value.marks.map(sanitiseMark)
  if (marks.some((m) => m === null)) return null
  const highest = Math.max(0, ...(marks as Mark[]).map((m) => Number(m.id.slice(1))))
  return { schema: SCHEMA, next: Math.max(value.next, highest + 1), marks: marks as Mark[] }
}

/** The project's marks. `problem`: what the person should be told, when the file could not be used. */
export async function loadMarks(dir: string): Promise<{ file: MarksFile; problem?: string }> {
  const why = await whyNotOwn(dir, 'marks')
  if (why) return { file: empty(), problem: why }
  const path = join(dir, APP.folder, MARKS_FILE)
  const there = await lstat(path).catch(() => null)
  if (!there) return { file: empty() }
  try {
    if (!there.isFile()) throw new Error('not a file')
    const read = fileOf(JSON.parse(await readFile(path, 'utf8')))
    if (read) return { file: read }
  } catch {
    // Set aside below.
  }
  await ownFolder(dir, 'marks')
  let n = 1
  while (await lstat(`${path}.bad-${n}`).catch(() => null)) n += 1
  await rename(path, `${path}.bad-${n}`)
  return { file: empty(), problem: `Your marks file could not be read. It was kept as ${APP.folder}/${MARKS_FILE}.bad-${n}.` }
}

export async function saveMarks(dir: string, file: MarksFile): Promise<void> {
  const folder = await ownFolder(dir, 'marks')
  await writeFileAtomic(join(folder, 'marks.json'), `${JSON.stringify(file, null, 1)}\n`)
}
