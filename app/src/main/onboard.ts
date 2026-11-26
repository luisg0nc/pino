import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { toolName as pinoTool } from '../shared/app'
import type { OnboardDraft, Onboarded, PromptPreview, PromptPreviewDraft } from '../shared/bridge'
import { type FabAsk, fabText, LCSC, type PartReading, readingLine } from '../shared/cards'
import { agentChoiceOf } from '../shared/chat'
import { MAX_LINKS, MOST_IMAGES, MOST_REFERENCES } from '../shared/projectName'
import { MAX_SIZES, type SizeFact, checkSize, saySize } from '../shared/size'
import { checkConnection, checkFab, checkPartHad, checkPower, type ConnectionRow, connectionText, MAX_CONNECTIONS, MAX_PARTS_HAD, MAX_POWER, MAX_SHAPE_NOTE, type PartHad, type PowerRow, powerText } from '../shared/slots'
import type { ProjectInfo } from '../shared/project'
import type { CardStore } from './cards/store'
import { cardsLine, readBrief } from './cards/text'
import { MAX_RULES, checkLink, oneLine } from './projects/create'
import type { Readings } from './projects/readings'
import type { Sessions } from './sessions/manager'
import type { PromptBlock } from './sessions/transport'
import { type ImageBytes, checkedImage } from './images'
// The rule of a picture main attaches (`images.ts`), named here too.
export { type ImageBytes, MAX_EDGE, MAX_IMAGE_BYTES, checkedImage } from './images'

// The first prompt of a new project and the call that sends it. The window made the project (`project:create`),
// which opened it; this starts its session and tells Claude, in one prompt, all that the person gave and what to
// settle before it writes `board.py`. What the window sends is checked again here, a picture that is not what it
// says is left out, and a part's stock is the reading main gave.

/** The most pictures one prompt carries. */
export { MOST_IMAGES }
const MAX_DESCRIPTION = 20_000
const REFERENCE_FILE = /^reference\/(photo|doodle)-[1-9][0-9]*\.(png|jpg|jpeg|webp)$/
/** A PDF as `create` names it (`referenceFiles`). */
const PDF_FILE = /^reference\/[A-Za-z0-9][A-Za-z0-9._-]*\.pdf$/

export interface PromptInput {
  name: string
  description: string
  /** Photos, then doodles. `image` is none for a picture that cannot be attached. */
  items: Array<{ file: string; note: string; image?: ImageBytes; /** A doodle drawn over a photo: the flag the draft keeps, not read from the note. */ over?: true }>
  /** The PDFs copied into `reference/`. */
  pdfs: Array<{ file: string; note: string }>
  power: PowerRow[]
  connections: ConnectionRow[]
  /** What the person measured or wants, told in words (`saySize`). */
  sizes: SizeFact[]
  enclosure: string
  edges: string
  parts: Array<PartHad & { reading?: PartReading }>
  fab: FabAsk | null
  /** The rules for the board, as the person wrote them. */
  rules: string
  /** Links, told one to a line; pino opens none. */
  links: Array<{ url: string; note: string }>
}

const imageBlock = (image: ImageBytes): PromptBlock => ({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: Buffer.from(image.bytes).toString('base64') } })

/** A doodle the person drew over a photo (one they gave, or one they took away after): the draft says so (`over`), whatever its note says. */
const overPhoto = (item: { over?: true }): boolean => item.over === true

/** What would make the first board wrong, settled before `board.py` is written. */
export const SETTLE = [
  'what the board connects to and how each thing talks',
  'how it is powered and what it draws',
  'where it has to fit, its mounting holes and which edge each connector sits on',
  'which parts it uses and whether JLC has them',
  'how many layers it has and who assembles it'
] as const

/** The end of the first prompt: that what was given is kept, and what to settle before `board.py`, said once. */
function settleText(toolName: (tool: string) => string): string[] {
  return [
    `There is no board.py yet. All of the above is kept for later conversations: brief.md holds their words and each slot is a card of theirs (${toolName('brief')}); you need not read them now.`,
    '',
    `Before you write board.py, settle what would make the first board wrong: ${SETTLE.slice(0, -1).join(', ')}, and ${SETTLE[SETTLE.length - 1]}. Something has a source when the person gave it above, or a picture, a PDF or a link says it; what they gave is not asked again.`,
    'Ask the person in one round, before you write board.py, with AskUserQuestion, only what would change the board, and for a value one option a typical value labelled as typical ("3.3 V from an LDO, usual for an ESP32-C3"). The person may answer "build with assumptions". If nothing would change the board, ask nothing.',
    `Check every part you mean to use with ${toolName('parts')}, basic parts first. Then, before you write board.py, write what you settled as cards of yours with ${toolName('add_card')}, one per topic: a requirement, a decision with its reason, an open question with what waits on it, each part by LCSC number, and the power budget of each rail. With fab and assembly given, set layers in Board(...) of board.py to what they asked; pino picks the fab profile for that layer count. Your reply lists what you assumed.`
  ]
}

/** A part the person has, as the prompt tells it: its number or the module, their note, and what main read of its stock. */
function partLine(part: PromptInput['parts'][number]): string {
  if (!LCSC.test(part.what)) return part.note === '' ? part.what : `${part.what}: ${part.note}`
  const said = [part.note, part.reading ? readingLine(part.reading) : 'stock not checked'].filter((s) => s !== '').join(' · ')
  return `${part.what}: ${said}`
}

/**
 * The first prompt of a new project: the text, then the pictures it says are attached, at most 6 in all, each after a line of text that names it
 * ("Picture 2: reference/doodle-1.png (the person's doodle): <note>"): the CLI gives the model no file name for an image. `held` is
 * the same text for a prompt that is not sent with its pictures (kept for a later session): each picture is named by
 * its file and says it is not attached.
 */
export function onboardPrompt(input: PromptInput, toolName: (tool: string) => string = pinoTool): { text: string; held: string; blocks: PromptBlock[]; attached: Array<number | null> } {
  const images: Array<{ image: ImageBytes; caption: (n: number) => string }> = []
  const said = (note: string): string => oneLine(note, 'note')
  /** The number of the picture when it fits in the prompt (it is attached then), else none. */
  const attach = (image: ImageBytes | undefined, what: string, note: string): number | null => {
    if (!image || images.length >= MOST_IMAGES) return null
    const line = said(note)
    images.push({ image, caption: (n) => `Picture ${n}: ${what}${line === '' ? '' : `: ${line}`}` })
    return images.length
  }
  const attached = input.items.map((item) => attach(item.image, `${item.file} (the person's ${item.file.startsWith('reference/doodle') ? 'doodle' : 'photo'})`, item.note))
  const compose = (held: boolean): string => {
    const lines: string[] = []
    input.items.forEach((item, i) => {
      const tail = attached[i] !== null && !held ? ` (attached: picture ${attached[i]})` : ` (not attached: read ${item.file})`
      lines.push(`- ${item.file}${said(item.note) === '' ? '' : `: ${said(item.note)}`}${tail}`)
    })
    for (const pdf of input.pdfs) {
      const note = said(pdf.note)
      lines.push(`- ${said(pdf.file)}${note === '' ? '' : `: ${note}`}. A PDF; read it with your own tools if it helps.`)
    }
    const doodles = input.items.filter((item) => item.file.startsWith('reference/doodle'))
    /** A slot under its heading, when it holds something. */
    const slot = (heading: string, rows: string[]): string[] => (rows.length === 0 ? [] : [heading, ...rows.map((row) => `- ${row}`), ''])
    const shape = [...input.sizes.map(saySize), ...(input.enclosure === '' ? [] : [`Fits an enclosure: ${input.enclosure}`]), ...(input.edges === '' ? [] : [`Connector edges: ${input.edges}`])]
    return [
      `This is a new board, ${input.name}, made in pino just now. What it does, in the person's words:`,
      '',
      input.description.trim(),
      '',
      ...(lines.length > 0 ? ['What they gave (all of it is also in brief.md; files are in reference/):', ...lines, ''] : []),
      ...slot('Power:', input.power.map(powerText)),
      ...slot('Connections:', input.connections.map(connectionText)),
      ...slot('Size and shape:', shape),
      ...slot('Parts they have:', input.parts.map(partLine)),
      ...(input.fab ? [`Fab and assembly: ${fabText(input.fab)}.`, ''] : []),
      ...(input.rules.trim() !== '' ? ['Rules:', input.rules.trim(), ''] : []),
      ...slot('Links (pino does not open links; read one only if it helps):', input.links.map((link) => `${said(link.url)}${said(link.note) === '' ? '' : `: ${said(link.note)}`}`)),
      ...(doodles.some((item) => !overPhoto(item)) ? ['A doodle is drawn over a light grid: 1 square = 40 px, with no scale. Read proportions from it, not sizes.', ''] : []),
      ...(doodles.some(overPhoto) ? ["A doodle drawn over a photo is the person's ink over that photo: read it as what they point at in the photo, with no grid.", ''] : []),
      ...settleText(toolName)
    ].join('\n')
  }
  const text = compose(false)
  return { text, held: compose(true), blocks: [{ type: 'text', text }, ...images.flatMap((p, i): PromptBlock[] => [{ type: 'text', text: p.caption(i + 1) }, imageBlock(p.image)])], attached }
}

/** A stand-in for a picture the window holds and says is fit to attach: the preview shows which are attached, and carries none. */
const STAND_IN: ImageBytes = { bytes: new Uint8Array(0), mediaType: 'image/png', width: 1, height: 1 }

/** The values of a list that pass a check, those that do not left out. */
function passing<T>(list: readonly unknown[], check: (raw: unknown) => T | string): T[] {
  return list.flatMap((raw) => {
    const checked = check(raw)
    return typeof checked === 'string' ? [] : [checked as T]
  })
}

/** Each part with the reading main gave for its number; nothing else of a row's is taken. */
const withReadings = (parts: PartHad[], readings: Readings | undefined): PromptInput['parts'] =>
  parts.map((part) => {
    const reading = LCSC.test(part.what) ? readings?.get(part.what) : undefined
    return reading ? { ...part, reading } : part
  })

const MOST_PREVIEW = 40

/**
 * The first prompt of the draft being made, as `onboardPrompt` writes it for `project.onboard`, with nothing done: no
 * file read, no session. `attached` says which picture of the prompt each item has, or none. What the draft holds
 * that `onboard` would refuse is left out rather than refused: the page is still being filled.
 */
export function previewPrompt(name: string, draft: PromptPreviewDraft, toolName: (tool: string) => string = pinoTool, readings?: Readings): PromptPreview {
  if (typeof name !== 'string' || typeof draft !== 'object' || draft === null) throw new Error('No draft to preview.')
  if (typeof draft.description !== 'string' || draft.description.length > MAX_DESCRIPTION) throw new Error('The description is not text of at most 20,000 characters.')
  for (const kind of ['items', 'pdfs', 'power', 'connections', 'sizes', 'parts', 'links'] as const) {
    if (!Array.isArray(draft[kind]) || draft[kind].length > MOST_PREVIEW) throw new Error(`The ${kind} are not a short list.`)
  }
  const text = (v: unknown, most = 2000): string => (typeof v === 'string' ? v.slice(0, most) : '')
  const line = (v: unknown): string => text(v, MAX_SHAPE_NOTE).replace(/\s+/g, ' ').trim()
  const fab = draft.fab === null ? null : checkFab(draft.fab)
  const built = onboardPrompt(
    {
      name: name.trim() === '' ? 'new-board' : name.trim(),
      description: draft.description,
      items: draft.items.map((item) => ({ file: text(item?.file), note: text(item?.note), ...(item?.hasImage === true ? { image: STAND_IN } : {}), ...(item?.over === true ? { over: true as const } : {}) })),
      pdfs: draft.pdfs.map((pdf) => ({ file: text(pdf?.file), note: text(pdf?.note) })),
      power: passing(draft.power, checkPower),
      connections: passing(draft.connections, checkConnection),
      sizes: passing(draft.sizes, (raw) => checkSize(raw, 'person')),
      enclosure: line(draft.enclosure),
      edges: line(draft.edges),
      parts: withReadings(passing(draft.parts, checkPartHad), readings),
      fab: typeof fab === 'string' ? null : fab,
      rules: text(draft.rules, MAX_RULES),
      links: draft.links.flatMap((link) => {
        try {
          return [checkLink(link)]
        } catch {
          return []
        }
      })
    },
    toolName
  )
  return { text: built.text, attached: built.attached }
}

export interface OnboardDeps {
  /** The open project, when it is the one of this id. */
  project(id: string): ProjectInfo | undefined
  sessions: Pick<Sessions, 'start' | 'current' | 'sendBlocks'>
  cards: Pick<CardStore, 'read' | 'markTold'>
  /** The stock readings main gave this run. */
  readings: Readings
  toolName: (tool: string) => string
}

/** The projects being onboarded now: one call at a time per project, from the check to the end. */
const onboarding = new Set<string>()

const firstLine = (e: unknown): string => (e instanceof Error ? e.message : String(e)).split('\n')[0].slice(0, 300)

/** A list of the draft held to what it may be: a list, of at most `most`; each row through its check. */
function rows<T>(list: unknown, most: number, named: string, check: (raw: unknown) => T | string): T[] {
  if (!Array.isArray(list)) throw new Error(`The ${named} are not a list.`)
  if (list.length > most) throw new Error(`At most ${most} ${named}.`)
  return list.map((raw) => {
    const checked = check(raw)
    if (typeof checked === 'string') throw new Error(checked)
    return checked as T
  })
}

/** A field of Size and shape, folded to its line. */
function shapeText(value: unknown, as: string): string {
  if (typeof value !== 'string') throw new Error(`The ${as} is not text.`)
  const folded = value.replace(/\s+/g, ' ').trim()
  if (folded.length > MAX_SHAPE_NOTE) throw new Error(`The ${as} is at most ${MAX_SHAPE_NOTE} characters.`)
  return folded
}

/** A file of `reference/` the draft names: of the shape `create` gives it, a plain file that is there, with a note. */
async function reference(dir: string, raw: unknown, shape: RegExp, what: string): Promise<void> {
  const item = raw as { file?: unknown; note?: unknown } | null
  if (typeof item?.file !== 'string' || !shape.test(item.file)) throw new Error(`A ${what} is a file of reference/ that pino made.`)
  if (typeof item.note !== 'string') throw new Error(`The note of a ${what} is not text.`)
  oneLine(item.note, what)
  const stat = await lstat(join(dir, item.file)).catch(() => null)
  if (!stat?.isFile()) throw new Error(`${item.file} is not there.`)
}

/** The draft held to what it may be, as the prompt is written from it; throws a plain reason. */
async function checked(deps: OnboardDeps, project: ProjectInfo, draft: OnboardDraft): Promise<PromptInput> {
  if (typeof draft !== 'object' || draft === null) throw new Error('No draft to onboard.')
  if (typeof draft.description !== 'string' || draft.description.length > MAX_DESCRIPTION) throw new Error('The description is not text of at most 20,000 characters.')
  const items = rows(draft.items, MOST_REFERENCES.photos + MOST_REFERENCES.doodles, 'pictures', (raw) => raw as OnboardDraft['items'][number])
  const pdfs = rows(draft.pdfs, MOST_REFERENCES.pdfs, 'PDFs', (raw) => raw as OnboardDraft['pdfs'][number])
  for (const item of items) await reference(project.dir, item, REFERENCE_FILE, 'photo or doodle')
  for (const pdf of pdfs) await reference(project.dir, pdf, PDF_FILE, 'PDF')
  const files = [...items, ...pdfs].map((i) => i.file)
  if (new Set(files).size !== files.length) throw new Error('The same file is given twice.')
  if (typeof draft.rules !== 'string') throw new Error('The rules are not text.')
  if (draft.rules.length > MAX_RULES) throw new Error(`The rules are over ${MAX_RULES} characters.`)
  if (!Array.isArray(draft.links)) throw new Error('The links are not a list.')
  if (draft.links.length > MAX_LINKS) throw new Error(`At most ${MAX_LINKS} links.`)
  return {
    name: project.name,
    description: draft.description,
    items: items.map((item) => ({ file: item.file, note: item.note, image: checkedImage(item.image) ?? undefined, ...(item.over === true ? { over: true as const } : {}) })),
    pdfs: pdfs.map((pdf) => ({ file: pdf.file, note: pdf.note })),
    power: rows(draft.power, MAX_POWER, 'power rows', checkPower),
    connections: rows(draft.connections, MAX_CONNECTIONS, 'connections', checkConnection),
    sizes: rows(draft.sizes, MAX_SIZES, 'sizes', (raw) => checkSize(raw, 'person')),
    enclosure: shapeText(draft.enclosure, 'enclosure'),
    edges: shapeText(draft.edges, 'note on the connector edges'),
    parts: withReadings(rows(draft.parts, MAX_PARTS_HAD, 'parts', checkPartHad), deps.readings),
    fab: draft.fab === null ? null : rows([draft.fab], 1, 'fab', checkFab)[0],
    rules: draft.rules,
    links: draft.links.map(checkLink)
  }
}

/**
 * Onboards a new project: starts its session and sends the first prompt. Rejects, doing nothing, for a project that
 * is not the open one, one with a session already, and a draft that is not what it may be. A picture that cannot be
 * attached and a session that cannot be started do not reject: the text says of the first, and the answer has the
 * prompt to keep and the reason for the second.
 */
export async function onboardProject(deps: OnboardDeps, projectId: string, draft: OnboardDraft): Promise<Onboarded> {
  const project = deps.project(projectId)
  if (!project) throw new Error('That project is not open.')
  if (onboarding.has(project.id)) throw new Error(`${project.name} is being started already.`)
  if (deps.sessions.current(project.id)) throw new Error(`${project.name} has a session already.`)
  onboarding.add(project.id)
  try {
    return await onboarded(deps, project, draft)
  } finally {
    onboarding.delete(project.id)
  }
}

async function onboarded(deps: OnboardDeps, project: ProjectInfo, draft: OnboardDraft): Promise<Onboarded> {
  const { text, held, blocks } = onboardPrompt(await checked(deps, project, draft), deps.toolName)
  let sessionId: string
  try {
    // The model and effort the person chose on the page, for this session alone; what is not one is their default.
    const started = await deps.sessions.start(project, agentChoiceOf(draft.choice))
    if ('refused' in started) return { sessionId: null, prompt: text, held, problem: firstLine(started.refused) }
    sessionId = started.sessionId
  } catch (e) {
    return { sessionId: null, prompt: text, held, problem: firstLine(e) }
  }
  // The prompt says what is in the Brief in its own words, so its line counts all of it as told. Not worth stopping
  // the prompt for: when this fails the line only calls the cards new.
  try {
    const [file, words] = await Promise.all([deps.cards.read(project.id), readBrief(project.dir)])
    await deps.cards.markTold(project.id, cardsLine(file, {}, words, deps.toolName).told)
  } catch (e) {
    console.error(`cannot mark the Brief of ${project.id} as told: ${(e as Error).message}`)
  }
  try {
    await deps.sessions.sendBlocks(sessionId, blocks)
  } catch (e) {
    return { sessionId, prompt: text, held, problem: firstLine(e) }
  }
  return { sessionId, prompt: text, held }
}
