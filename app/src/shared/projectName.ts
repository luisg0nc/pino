// The name of a new project is the name of its folder, and what it may be given is capped here: one rule, so that
// the window says what main will refuse.

/** The longest name of a project, in characters. */
export const MAX_PROJECT_NAME = 64

/** The biggest photo a new project takes, in bytes: main copies no more, and the window reads no more. */
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024

/** The most pictures the first prompt of a new project carries (`main/onboard.ts`). */
export const MOST_IMAGES = 6
/** The most of each kind of reference a new project is made with: the window holds the draft to it, main holds the request to it. */
export const MOST_REFERENCES = { photos: 12, doodles: 6, pdfs: 6 }

/** A PDF (a datasheet, a drawing) a new project takes into `reference/`: the ending, and the most of it (25 MB) it copies. */
export const PDF_FORMATS = ['.pdf'] as const
export const MAX_PDF_BYTES = 25 * 1024 * 1024

/** What a new project takes of links: the most, the longest address, the longest note on one line (`main/projects/create.ts` holds a request to them, the page holds the draft). */
export const MAX_LINKS = 20
export const MAX_URL = 2_000
export const MAX_LINK_NOTE = 300

/** Why an address is not a link a new project takes (`http` or `https` only, one word, a host, at most 2000 characters), or null when it is. */
export function linkProblem(url: unknown): string | null {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return 'A link is an http or https address.'
  if (url.length > MAX_URL) return `A link is at most ${MAX_URL} characters.`
  if (/[\s\p{Cc}]/u.test(url)) return 'A link has no space, control character or line break in it.'
  try {
    if (new URL(url).hostname === '') return 'A link is an http or https address.'
  } catch {
    return 'A link is an http or https address.'
  }
  return null
}

/**
 * The files `reference/` is given for the files of a draft that keep their own names (PDFs), in the
 * order given: the file's own name (Claude reads it by that name), with what a folder name may hold of it and the
 * ending in lower case, which is the first of `endings` for a name with none; a name already taken, in any case, is
 * numbered (`-2`). One function, so that the window names the file as main writes it.
 */
export function referenceFiles(paths: readonly string[], endings: readonly string[]): string[] {
  const taken = new Set<string>()
  return paths.map((path) => {
    const base = path.split(/[\\/]/).pop() ?? ''
    const dot = base.lastIndexOf('.')
    const ending = dot > 0 ? base.slice(dot).toLowerCase() : endings[0]
    const stem = (dot > 0 ? base.slice(0, dot) : base).replace(/[^A-Za-z0-9._-]/g, '_').replace(/^[._-]+/, '').slice(0, 64) || 'part'
    for (let n = 1; ; n += 1) {
      const file = `reference/${n === 1 ? stem : `${stem}-${n}`}${ending}`
      if (!taken.has(file.toLowerCase())) {
        taken.add(file.toLowerCase())
        return file
      }
    }
  })
}

/**
 * Why `name` cannot be a new project's folder, in a sentence for the person; null when it can. `existing` is
 * every name in the workspace's folder (folders and files), compared without regard to case: a disk may not
 * tell `Clip` from `clip`.
 */
export function projectNameProblem(name: string, existing: readonly string[]): string | null {
  if (name === '') return 'Give the project a name.'
  if (name.length > MAX_PROJECT_NAME) return `A name is at most ${MAX_PROJECT_NAME} characters.`
  if (!/^[A-Za-z0-9]/.test(name)) return 'A name starts with a letter or a digit.'
  if (!/^[A-Za-z0-9_-]+$/.test(name)) return 'A name has only letters, digits, `-` and `_`.'
  const lower = name.toLowerCase()
  for (const other of existing) {
    if (other.toLowerCase() === lower) return `A folder \`${other}\` is there already.`
  }
  return null
}
