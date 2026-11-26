import type { CreateRequest, OnboardDraft, Onboarded, PromptPreviewDraft } from '../../../shared/bridge'
import type { AgentChoice } from '../../../shared/chat'
import type { ProjectInfo } from '../../../shared/project'
import { sizeBlank, sizeFact, sizeProblem, type ConnectionDraft, type Draft, type Held, type PartDraft, type PowerDraft } from '../../state/onboard'
import { PDF_FORMATS, referenceFiles as namedReferences } from '../../../shared/projectName'
import { checkConnection, checkFab, checkPartHad, checkPower } from '../../../shared/slots'
import { extensionOf } from './images'

/** What an IPC call failed with, without Electron's wrapping. */
export const reason = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']*': (Error: )?/, '')

/** What Start leans on: main's calls, the workspace, the window's page and the place a prompt is held. */
export interface MakeDeps {
  /** Makes the project and opens it in main. */
  create(req: CreateRequest): Promise<ProjectInfo>
  onboard(projectId: string, draft: OnboardDraft): Promise<Onboarded>
  /** The names of the workspace's projects, as main lists them now; the window's list is refreshed by this. */
  listed(): Promise<string[]>
  /** Shows the project main has just made and opened. */
  show(project: ProjectInfo): Promise<void>
  /** Opens a project of the workspace by its name, as a click on its card does. */
  open(name: string): Promise<ProjectInfo>
  /** The draft is spent. */
  discard(): void
  hold(projectId: string, held: Held): void
  /** Whether the workspace is still the one the project was made in. */
  sameWorkspace(): boolean
  /** Where the project's folder is. */
  folderOf(name: string): string
}

export type Outcome =
  /** Another Start is under way: this one did nothing. */
  | { kind: 'busy' }
  /** Nothing was made: the reason, and the page and its draft stay. */
  | { kind: 'refused'; message: string }
  /** The project was made but something after failed: it is not to be made again. `opened` says whether it could be opened. */
  | { kind: 'made'; name: string; message: string; opened: boolean }
  /** Made and open; `problem` is why the first prompt was not sent, and then it is held for the next session. */
  | { kind: 'done'; name: string; problem?: string; /** False when the window could not show the project (another was chosen meanwhile). */ shown?: false }

/** What `create` will name the photos and the doodles of the draft: photo-<n> with the extension of the file, doodle-<n>.png. */
export function referenceFiles(draft: Draft): OnboardDraft['items'] {
  const photoFile = (n: number): string => `reference/photo-${n + 1}${draft.photos[n].pasted ? '.png' : extensionOf(draft.photos[n].path)}`
  return [
    ...draft.photos.map((p, n) => ({ file: photoFile(n), note: p.note, image: p.image })),
    ...draft.doodles.map((d, n) => {
      // The words `create` puts on the card of a doodle drawn over a photo, so that the prompt and the board agree.
      const over = overIndex(draft, d)
      const said = over !== undefined ? `drawn over ${photoFile(over)}` : d.onPhoto ? 'drawn over a photo' : ''
      return { file: `reference/doodle-${n + 1}.png`, note: said === '' ? d.note : d.note === '' ? said : `${d.note} (${said})`, image: d.png, ...(said !== '' ? { over: true as const } : {}) }
    })
  ]
}

/** The index in the draft's photos of the photo a doodle is drawn over, if it still is in the draft. */
function overIndex(draft: Draft, doodle: Draft['doodles'][number]): number | undefined {
  if (doodle.over === undefined) return undefined
  const at = draft.photos.findIndex((p) => p.uid === doodle.over)
  return at < 0 ? undefined : at
}

/** A row of Power is whole by its source alone: it is never blank. */
export const connectionBlank = (row: ConnectionDraft): boolean => row.what.trim() === '' && row.connector.trim() === ''
export const partBlank = (row: PartDraft): boolean => row.what.trim() === '' && row.note.trim() === ''

/** The rows of the PCB slots as main takes them, those nothing was typed in left out; or why the first that is not whole is refused. */
function pcbRows(draft: Draft): { rows: Pick<CreateRequest, 'power' | 'connections' | 'parts' | 'fab'>; wrong: string | null } {
  let wrong: string | null = null
  const whole = <R, T>(list: readonly R[], check: (raw: unknown) => T | string): T[] =>
    list.flatMap((row): T[] => {
      const checked = check(row as unknown)
      if (typeof checked !== 'string') return [checked]
      wrong ??= checked
      return []
    })
  const power = whole(draft.power, (raw) => checkPower(raw as PowerDraft))
  const connections = whole(draft.connections.filter((r) => !connectionBlank(r)), checkConnection)
  // A reading is main's: `checkPartHad` takes the number and the note alone.
  const parts = whole(draft.parts.filter((r) => !partBlank(r)), checkPartHad)
  const [fab = null] = whole(draft.fab ? [draft.fab] : [], checkFab)
  return { rows: { power, connections, parts, fab }, wrong }
}

/** Why a row of a PCB slot holds the project back, or null. */
export const rowsWrong = (draft: Draft): string | null => pcbRows(draft).wrong

/** What `create` will name the PDFs of a request: their own names (`referenceFiles`), with the person's note on each. */
export function pdfReferences(pdfs: CreateRequest['pdfs']): OnboardDraft['pdfs'] {
  const files = namedReferences(pdfs.map((p) => p.path), PDF_FORMATS)
  return pdfs.map((p, n) => ({ file: files[n], note: p.note }))
}

/** The sizes of the draft that are whole, as main takes them. */
const wholeSizes = (draft: Draft): CreateRequest['sizes'] => draft.sizes.flatMap((s) => sizeFact(s) ?? [])

/** The links of a draft, as main takes them. */
const linksOf = (draft: Draft): CreateRequest['links'] => draft.links.map((l) => ({ url: l.url, note: l.note }))

/** The PDFs of a draft, by the path they are at. */
const pdfsOf = (draft: Draft): CreateRequest['pdfs'] => draft.pdfs.map((p) => ({ path: p.path, note: p.note }))

/** The slots of the draft that go both into the folder and into the first prompt. A row that is not whole is left out. */
const slotsOf = (draft: Draft) => ({
  ...pcbRows(draft).rows,
  sizes: wholeSizes(draft),
  enclosure: draft.enclosure.trim(),
  edges: draft.edges.trim(),
  rules: draft.rules,
  links: linksOf(draft)
})

/** The request main makes the project from. */
export function createRequest(draft: Draft): CreateRequest {
  return {
    name: draft.name,
    description: draft.description.trim(),
    photos: draft.photos.map((p) => (p.pasted ? { png: p.image, note: p.note } : { path: p.path, note: p.note })),
    doodles: draft.doodles.map((d) => {
      const over = overIndex(draft, d)
      return { png: d.png, note: d.note, ...(over !== undefined ? { over } : d.onPhoto ? { onPhoto: true as const } : {}) }
    }),
    pdfs: pdfsOf(draft),
    ...slotsOf(draft)
  }
}

/** The draft as `project.previewPrompt` takes it: no picture, only whether there is one. A row not whole yet is left out, as main leaves it: the page is still being filled. */
export function previewDraft(draft: Draft): PromptPreviewDraft {
  return {
    description: draft.description.trim(),
    items: referenceFiles(draft).map((i) => ({ file: i.file, note: i.note, hasImage: (i.image?.byteLength ?? 0) > 0, ...(i.over ? { over: true as const } : {}) })),
    pdfs: pdfReferences(pdfsOf(draft)),
    ...slotsOf(draft)
  }
}

let running = false

/** The message of `project:create` for a project that is on the disk whatever else went wrong. */
const WAS_MADE = /^\S+ was made, but /

/**
 * Start: makes the folder, shows the project, then hands the first prompt over, once, with the model and effort
 * chosen for its session (`choice`: empty for the person's defaults); without `start` ("Make it without starting
 * Claude") nothing is asked of an agent. A second call while one runs does nothing. The draft is spent as soon as the
 * folder exists, never before: a refusal leaves the page as it was.
 */
export async function makeProject(draft: Draft, deps: MakeDeps, choice: AgentChoice = {}, start = true): Promise<Outcome> {
  if (running) return { kind: 'busy' }
  running = true
  try {
    for (const size of draft.sizes) {
      if (sizeBlank(size)) continue
      const wrong = sizeProblem(size)
      if (wrong !== null) return { kind: 'refused', message: wrong }
    }
    const wrongRow = rowsWrong(draft)
    if (wrongRow !== null) return { kind: 'refused', message: wrongRow }
    const request = createRequest(draft)
    // What `onboard` names is what `create` wrote: photo-<n> with the extension of the file, doodle-<n>.png.
    const items = referenceFiles(draft)
    let project: ProjectInfo
    try {
      project = await deps.create(request)
    } catch (e) {
      const message = reason(e)
      if (!WAS_MADE.test(message)) return { kind: 'refused', message }
      // On the disk, whatever else failed: not made again. Opened if the workspace lists it now.
      const name = message.split(' ')[0]
      const told = `${message} The folder is ${deps.folderOf(name)}.`
      const names = await deps.listed().catch(() => [] as string[])
      deps.discard()
      // Of this workspace only: one left meanwhile may have a project of the same name.
      const opened =
        names.includes(name) && deps.sameWorkspace()
          ? await deps.open(name).catch(() => null)
          : null
      // The page is gone once the project opens: the reason is said where the session is.
      if (opened) deps.hold(opened.id, { text: '', reason: told })
      return { kind: 'made', name, message: told, opened: opened !== null }
    }
    const { name } = project
    await deps.listed().catch(() => [])
    deps.discard()
    if (!deps.sameWorkspace()) return { kind: 'made', name, message: `${name} was made, but its folder of boards was left before it could be shown.`, opened: false }
    let shown = true
    await deps.show(project).catch(() => void (shown = false))
    const done = (problem?: string): Outcome => ({ kind: 'done', name, ...(problem === undefined ? {} : { problem }), ...(shown ? {} : { shown: false as const }) })
    if (!start) return done()
    let told: Onboarded
    try {
      const { name: _name, photos: _photos, doodles: _doodles, pdfs, ...slots } = request
      told = await deps.onboard(project.id, { ...slots, items, pdfs: pdfReferences(pdfs), ...(choice.model || choice.effort ? { choice } : {}) })
    } catch (e) {
      // Nothing is known of the text: the project is made and open, and the reason is said where the chat would be.
      const message = reason(e)
      deps.hold(project.id, { text: '', reason: message })
      return done(message)
    }
    if (told.sessionId === null || told.problem !== undefined) {
      const why = told.problem ?? 'A chat session could not be started.'
      deps.hold(project.id, { text: told.held, reason: why })
      return done(why)
    }
    return done()
  } finally {
    running = false
  }
}
