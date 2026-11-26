import { relative, sep } from 'node:path'
import { watch as chokidarWatch } from 'chokidar'
import { APP } from '../../shared/app'
import { realPathOrNearest } from '../sessions/inside'

/** What changed of what the Brief follows: `brief.md` (`brief`) and `.pino/brief/cards.json` (`cards`). */
export interface BriefChange {
  brief: boolean
  cards: boolean
}

const DEBOUNCE_MS = 300

/**
 * Watches the two things of a project the Brief follows, and calls `onChange` once per burst, 300 ms after the last
 * change: `brief.md` written, made or removed (the person edits it in their own editor), and `cards.json` changed from
 * outside (a pull). Nothing else of the folder is watched: the walk goes into no other folder. The folders need not
 * exist yet. Returns a function that stops the watch.
 */
export function watchBrief(dir: string, onChange: (what: BriefChange) => void, debounceMs: number = DEBOUNCE_MS): () => void {
  const realDir = realPathOrNearest(dir)
  let timer: NodeJS.Timeout | undefined
  let what: BriefChange = { brief: false, cards: false }
  /** The path under the project's folder, by whichever of its two spellings it is under (macOS reaches `/var` as `/private/var`). */
  const parts = (path: string): string[] => {
    let from = relative(dir, path)
    if (from.startsWith('..')) from = relative(realDir, path)
    return from === '' ? [] : from.split(sep)
  }
  const kind = (path: string): 'brief' | 'cards' | 'way' | null => {
    const [a, b, c, ...more] = parts(path)
    if (a === undefined) return 'way'
    if (a === 'brief.md' && b === undefined) return 'brief'
    if (a === APP.folder && (b === undefined || (b === 'brief' && (c === undefined || (c === 'cards.json' && more.length === 0))))) return c === 'cards.json' ? 'cards' : 'way'
    return null
  }
  const watcher = chokidarWatch(dir, { ignoreInitial: true, ignored: (path) => kind(path) === null })
  watcher.on('all', (_event, path) => {
    const of = kind(path)
    if (of === null || of === 'way') return
    what = { brief: what.brief || of === 'brief', cards: what.cards || of === 'cards' }
    clearTimeout(timer)
    timer = setTimeout(() => {
      const told = what
      what = { brief: false, cards: false }
      onChange(told)
    }, debounceMs)
  })
  // A watch that fails (the folder became unreadable) just reports nothing more.
  watcher.on('error', () => {})
  return () => {
    clearTimeout(timer)
    void watcher.close()
  }
}
