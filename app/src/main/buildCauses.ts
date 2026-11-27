import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isRecord, type BuildCause, type BuildTurn, type KeptCause } from '../shared/build'
import { ensureIgnored } from './ignored'
import { FOLDER, whyNotOwn, writeOwn } from './own'

// What made each build, kept by main in `<project>/.pino/build-causes.json`: the engine's `builds.json` says nothing of
// it. Main is the file's only writer. It is local to the machine, so git is told to pass over it.

export const CAUSES_FILE = 'build-causes.json'
const SCHEMA = 'pino.build-causes/1'
/** How many builds' causes are kept: the newest by number. */
export const KEPT_CAUSES = 200
const CAUSES: readonly string[] = ['agent', 'person', 'route', 'unknown'] satisfies BuildCause[]

const turnOf = (value: unknown): BuildTurn | null => {
  if (!isRecord(value) || typeof value.prompt !== 'string' || value.prompt === '') return null
  if (value.conversation === undefined) return { prompt: value.prompt }
  return typeof value.conversation === 'string' ? { prompt: value.prompt, conversation: value.conversation } : null
}

/** The causes on file, by build number; empty when there is none to read. A row that is not one is left out. */
export async function readCauses(dir: string): Promise<Map<number, KeptCause>> {
  const causes = new Map<number, KeptCause>()
  try {
    if (await whyNotOwn(dir)) return causes
    const file: unknown = JSON.parse(await readFile(join(dir, FOLDER, CAUSES_FILE), 'utf8'))
    if (!isRecord(file) || file.schema !== SCHEMA || !Array.isArray(file.builds)) return causes
    for (const row of file.builds as unknown[]) {
      if (!isRecord(row) || typeof row.number !== 'number' || !Number.isInteger(row.number) || row.number < 1) continue
      if (typeof row.cause !== 'string' || !CAUSES.includes(row.cause)) continue
      if (row.turn === undefined) {
        causes.set(row.number, { cause: row.cause as BuildCause })
        continue
      }
      const turn = turnOf(row.turn)
      if (turn) causes.set(row.number, { cause: row.cause as BuildCause, turn })
    }
  } catch {
    return new Map()
  }
  return causes
}

/** Keeps the newest `KEPT_CAUSES` of the causes in `<dir>/.pino/build-causes.json`, whole or not at all, and has git pass over it. */
export async function writeCauses(dir: string, causes: ReadonlyMap<number, KeptCause>): Promise<void> {
  const builds = [...causes]
    .sort((a, b) => a[0] - b[0])
    .slice(-KEPT_CAUSES)
    .map(([number, kept]) => ({ number, cause: kept.cause, ...(kept.turn ? { turn: kept.turn } : {}) }))
  await writeOwn(dir, CAUSES_FILE, `${JSON.stringify({ schema: SCHEMA, builds }, null, 2)}\n`)
  await ensureIgnored(dir, [CAUSES_FILE])
}
